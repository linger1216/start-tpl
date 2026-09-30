/**
 * 给达梦的表补上**默认值**(幂等,可重复跑)。
 *
 * 为什么需要:项目的表在 MySQL 上是靠 DDL 的 `DEFAULT` 兜底的 ——
 * `sort default 0` / `visible default 1` / `status default 1` / `create_time default current_timestamp` …
 * drizzle 的 `.default(...)` 表示"我不写这个列,交给数据库默认值填"。而达梦这边建表时**没带默认值**,
 * 于是任何"省略这些列"的 INSERT 都会撞 `违反列[X]非空约束`。
 *
 * 两种修法:
 *   A. 给达梦表补默认值(**本脚本**,推荐)—— 应用代码零改动,MySQL 那边也不用动
 *   B. 改 schema 让 drizzle 每次显式带上值 —— 要动 5 张表的声明,且把"DDL 负责默认值"的设计改掉
 * 选 A:保持两库语义一致,应用层不用知道方言。
 *
 * 跑法:`pnpm db:dm:defaults`
 */
import "dotenv/config";

import dmdb from "dmdb";

type Conn = {
	execute: (s: string, b: unknown[], o: unknown, cb: (e: unknown, r: unknown) => void) => void;
	close: () => Promise<void>;
};

/** 表 → 列 → 默认值表达式(与 MySQL DDL 对齐) */
const DEFAULTS: Record<string, Record<string, string>> = {
	sys_menu: {
		sort: "0",
		visible: "1",
		status: "1",
		create_time: "CURRENT_TIMESTAMP",
		update_time: "CURRENT_TIMESTAMP",
	},
	sys_dict: {
		status: "1",
		create_time: "CURRENT_TIMESTAMP",
		update_time: "CURRENT_TIMESTAMP",
	},
	sys_para: {
		status: "1",
		editable: "1",
		create_time: "CURRENT_TIMESTAMP",
		update_time: "CURRENT_TIMESTAMP",
	},
	sys_tag: {
		sort: "0",
		create_time: "CURRENT_TIMESTAMP",
		update_time: "CURRENT_TIMESTAMP",
	},
	sys_tag_relation: {
		create_time: "CURRENT_TIMESTAMP",
		update_time: "CURRENT_TIMESTAMP",
	},
};

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url?.startsWith("dm://")) {
		console.error("DATABASE_URL 不是 dm://,本脚本只服务达梦。跳过。");
		process.exit(0);
	}
	const schema = new URLSearchParams(url.split("?")[1] ?? "").get("schema") ?? "";

	const pool = (await dmdb.createPool({
		connectString: url,
		poolMax: 1,
		poolTimeout: 10,
	})) as unknown as { getConnection: (cb: (e: unknown, c: Conn) => void) => void; close: () => Promise<void> };

	const withConn = async <T>(fn: (conn: Conn) => Promise<T>): Promise<T> => {
		const conn = await new Promise<Conn>((res, rej) => pool.getConnection((e, c) => (e ? rej(e as Error) : res(c))));
		try {
			return await fn(conn);
		} finally {
			await conn.close().catch(() => {});
		}
	};

	// 先取回每列的当前类型(ALTER MODIFY 必须带类型),再对齐默认值
	const cols = await withConn(
		(conn) =>
			new Promise<Array<Record<string, unknown>>>((res, rej) =>
				conn.execute(
					`select TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_DEFAULT from SYS.ALL_TAB_COLUMNS where OWNER='${schema}'`,
					[],
					{ outFormat: 4002 },
					(e, r) => (e ? rej(e as Error) : res((r as { rows: Array<Record<string, unknown>> }).rows)),
				),
			),
	);

	/** 把 DM 的 DATA_TYPE 还原成 ALTER MODIFY 里要写的类型 */
	const typeOf = (r: Record<string, unknown>): string => {
		const t = String(r.DATA_TYPE).toUpperCase();
		const len = Number(r.DATA_LENGTH ?? 0);
		if (t === "VARCHAR" || t === "VARCHAR2" || t === "CHAR") return `${t}(${len})`;
		return t;
	};

	let applied = 0;
	let skipped = 0;
	for (const [table, wanted] of Object.entries(DEFAULTS)) {
		for (const [column, expr] of Object.entries(wanted)) {
			const row = cols.find((c) => c.TABLE_NAME === table && c.COLUMN_NAME === column);
			if (!row) {
				console.log(`⚠️  ${table}.${column} 不存在,跳过`);
				continue;
			}
			const current =
				row.DATA_DEFAULT === null || row.DATA_DEFAULT === undefined ? "" : String(row.DATA_DEFAULT).trim();
			// 已经等价(不同驱动回显格式略不同,做一次宽松比较)
			const same =
				current !== "" &&
				current.replace(/[()]/g, "").toUpperCase().replace(/\s+/g, "") ===
					expr.replace(/[()]/g, "").toUpperCase().replace(/\s+/g, "");
			if (same) {
				skipped += 1;
				continue;
			}
			const sql = `alter table "${schema}"."${table}" modify "${column}" ${typeOf(row)} default ${expr}`;
			try {
				await withConn(
					(conn) =>
						new Promise<void>((res, rej) =>
							conn.execute(sql, [], { outFormat: 4002 }, (e) => (e ? rej(e as Error) : res())),
						),
				);
				console.log(`✓ ${table}.${column} → default ${expr}`);
				applied += 1;
			} catch (e) {
				console.log(`✗ ${table}.${column} 失败:${(e as Error).message?.slice(0, 100)}`);
			}
		}
	}
	console.log(`\n完成:新加 ${applied} 个默认值,已存在 ${skipped} 个。`);
	await pool.close();
	process.exit(0);
}

main().catch((e) => {
	console.error("fatal:", e);
	process.exit(1);
});
