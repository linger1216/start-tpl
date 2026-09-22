/**
 * 给**达梦**建 Better Auth 需要的表(幂等,可重复跑)。
 *
 * 为什么单独一个脚本:`drizzle-kit` 的 dialect 是硬编码枚举、**没有达梦**,所以 `db:generate` /
 * `db:migrate` 对达梦无意义 —— 达梦的 DDL 只能手写维护。表定义的「形状」真源是 `src/db/data-base-schema.ts`,
 * **改那边之后要同步改这里**(与 `scripts/create-system-tables.ts` 同一口径)。
 *
 * 达梦与 MySQL 的几处差异(都实测过):
 *   · 没有 `boolean` 类型 → 用 `tinyint`(drizzle 的 `boolean` 在 MySQL 上本来也是 tinyint(1))
 *   · `timestamp` → 用 `datetime`(MySQL 的 timestamp 有 1970-2038 限制,达梦没这回事)
 *   · 反引号 → 双引号(达梦默认模式认双引号)
 *   · 表名 `user` 是达梦保留字 → **所有标识符一律加双引号**
 *   · `create table if not exists` / `create index if not exists` 达梦都支持 → 天然幂等
 *
 * 用法:`pnpm db:dm:create-ba`
 */
import "dotenv/config";

import dmdb from "dmdb";

type Conn = {
	execute: (sql: string, binds: unknown[], options: unknown, cb: (e: unknown, r: unknown) => void) => void;
	close: () => Promise<void>;
};

/** 表所在的模式 —— 与 DATABASE_URL 的 `?schema=` 一致 */
const SCHEMA = new URLSearchParams((process.env.DATABASE_URL ?? "").split("?")[1] ?? "").get("schema") ?? "eg";

const S = `"${SCHEMA}"`;

/**
 * Better Auth 内核四表 + 模板示例表 `todos`。
 * 列名 / 长度 / 约束全部对齐 `src/db/data-base-schema.ts`。
 * 表名带 `sys_` 前缀(认证是系统内部服务);better-auth 按 `src/lib/auth.ts` 里的**映射键名**找模型,表名随便。
 */
const STATEMENTS: string[] = [
	// ── user ──────────────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_user" (
		"id" varchar(36) not null,
		"name" varchar(128) not null,
		"email" varchar(255) not null,
		"email_verified" tinyint default 0 not null,
		"image" varchar(512),
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id")
	)`,
	`create unique index if not exists "uk_sys_user_email" on ${S}."sys_user" ("email")`,

	// ── session ───────────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_session" (
		"id" varchar(36) not null,
		"expires_at" datetime not null,
		"token" varchar(255) not null,
		"ip_address" text,
		"user_agent" text,
		"user_id" varchar(36) not null,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id"),
		constraint "fk_sys_session_user" foreign key ("user_id") references ${S}."sys_user" ("id") on delete cascade
	)`,
	`create unique index if not exists "uk_sys_session_token" on ${S}."sys_session" ("token")`,
	`create index if not exists "idx_sys_session_user" on ${S}."sys_session" ("user_id")`,

	// ── account ───────────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_account" (
		"id" varchar(36) not null,
		"account_id" varchar(255) not null,
		"provider_id" varchar(64) not null,
		"user_id" varchar(36) not null,
		"access_token" text,
		"refresh_token" text,
		"id_token" text,
		"access_token_expires_at" datetime,
		"refresh_token_expires_at" datetime,
		"scope" varchar(255),
		"password" text,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id"),
		constraint "fk_sys_account_user" foreign key ("user_id") references ${S}."sys_user" ("id") on delete cascade
	)`,
	`create unique index if not exists "uk_sys_account_provider" on ${S}."sys_account" ("provider_id", "account_id")`,
	`create index if not exists "idx_sys_account_user" on ${S}."sys_account" ("user_id")`,

	// ── verification ──────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_verification" (
		"id" varchar(36) not null,
		"identifier" varchar(255) not null,
		"value" text not null,
		"expires_at" datetime not null,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id")
	)`,
	`create index if not exists "idx_sys_verification_identifier" on ${S}."sys_verification" ("identifier")`,

	// ── todos(模板示例表,删 demo 时可一并删)──────────────────────────────
	`create table if not exists ${S}."todos" (
		"id" int identity(1,1) not null,
		"title" text not null,
		"created_at" datetime default current_timestamp,
		primary key ("id")
	)`,
];

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url?.startsWith("dm://")) {
		console.error("DATABASE_URL 不是 dm://,本脚本只服务达梦。跳过。");
		process.exit(0);
	}

	const pool = (await dmdb.createPool({ connectString: url, poolMax: 1, poolTimeout: 10 })) as unknown as {
		getConnection: (cb: (e: unknown, c: Conn) => void) => void;
		close: () => Promise<void>;
	};
	const conn = await new Promise<Conn>((res, rej) => pool.getConnection((e, c) => (e ? rej(e as Error) : res(c))));
	const run = (sql: string) =>
		new Promise<void>((res, rej) => conn.execute(sql, [], { outFormat: 4002 }, (e) => (e ? rej(e as Error) : res())));
	const q = (sql: string) =>
		new Promise<Array<Record<string, unknown>>>((res, rej) =>
			conn.execute(sql, [], { outFormat: 4002 }, (e, r) =>
				e ? rej(e as Error) : res((r as { rows: Array<Record<string, unknown>> }).rows ?? [])));

	const before = new Set(
		(await q(`select TABLE_NAME from SYS.ALL_TABLES where OWNER='${SCHEMA}'`)).map((r) => String(r.TABLE_NAME)),
	);

	let failed = 0;
	for (const sql of STATEMENTS) {
		const isCreateTable = /create table/i.test(sql);
		const tableName = isCreateTable ? sql.match(/"([a-z_]+)"\s*\(/)?.[1] : undefined;
		const existed = tableName ? before.has(tableName) : undefined;
		try {
			await run(sql);
			const action = isCreateTable ? (existed ? "· 已存在" : "✓ 新建") : "· 索引/约束";
			console.log(`${action} ${sql.replace(/\s+/g, " ").slice(0, 78)}`);
		} catch (e) {
			failed += 1;
			console.log(`✗ 失败:${sql.replace(/\s+/g, " ").slice(0, 60)}\n    ${(e as Error).message?.slice(0, 120).replace(/\n/g, " ")}`);
		}
	}

	const after = (await q(`select TABLE_NAME from SYS.ALL_TABLES where OWNER='${SCHEMA}' order by TABLE_NAME`)).map((r) => String(r.TABLE_NAME));
	console.log(`\n${SCHEMA} 模式现在的表:${after.join(", ")}`);
	console.log(failed === 0 ? "\n✓ 全部就绪(幂等,可重复跑)" : `\n⚠️ 有 ${failed} 条语句失败,见上`);
	console.log("提示:表注释 / 列注释用 `pnpm db:sync:meta` 对齐(达梦支持 comment on,和 MySQL 共用一份真源)。");
	await conn.close();
	await pool.close();
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error("fatal:", (e as Error).message);
	process.exit(1);
});
