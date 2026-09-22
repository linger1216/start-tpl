/**
 * DM(达梦)适配的可行性验证 —— 直连你的本地达梦,把"drizzle 生成的 MySQL 方言 SQL →
 * 翻译 → dmdb 执行"这条链路挨个打一遍。
 *
 * 跑法:`pnpm db:dm:poc`(默认连 `dm://SYSDBA:SYSDBA@127.0.0.1:5236`,也认 `DM_URL` 环境变量)。
 *
 * 测什么:
 *   1. 连接(走 dmdb,需要 NODE_OPTIONS=--openssl-legacy-provider)
 *   2. 反引号标识符 → 双引号(rewriteForDm)
 *   3. `?` 占位符 → `:n` 翻译(rewriteForDm)
 *   4. `LIMIT :n, :n`(分页)
 *   5. INSERT 自增 id 回拿
 *   6. `IN (:1, :2, …)`(drizzle 的 inArray 生成)
 *   7. drizzle 的 `db.execute(sql\`show tables\`)` 形态
 *
 * 每条独立 try/catch,失败立刻打错继续往下跑 —— 这样不管哪一步挂了,都能看到挂在哪。
 */
import dmdb from "dmdb";

import { rewriteForDm } from "./dm-rewrite";

/** dmdb 的连接串格式:`dm://user:password@host:port[?k=v]`(把账号塞在串里,不是分开的字段) */
const DM_URL = process.env.DM_URL ?? "dm://SYSDBA:SYSDBA@127.0.0.1:5236?loginEncrypt=false";
if (!DM_URL.startsWith("dm://")) {
	console.error(`DM_URL 必须以 dm:// 开头,实际:${DM_URL}`);
	process.exit(1);
}

/** 安全序列化:DM 把 NUMBER/BIGINT 列返回为 JS BigInt;dmdb 偶尔会塞个有循环引用的对象进 row。
 *  JSON.stringify 默认两种都会炸,我们都处理掉。 */
function json(v: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(
		v,
		(_, val) => {
			if (typeof val === "bigint") return val.toString();
			if (val instanceof Date) return val.toISOString();
			if (val && typeof val === "object") {
				if (seen.has(val as object)) return "<circular>";
				seen.add(val as object);
			}
			return val;
		},
	);
}

type Result = { name: string; ok: boolean; detail: string; ms?: number };
const results: Result[] = [];

async function probe(name: string, fn: () => Promise<string>): Promise<void> {
	const t0 = Date.now();
	try {
		const detail = await fn();
		results.push({ name, ok: true, detail, ms: Date.now() - t0 });
		console.log(`✅ ${name} (${Date.now() - t0}ms) — ${detail}`);
	} catch (e) {
		results.push({ name, ok: false, detail: (e as Error).message ?? String(e), ms: Date.now() - t0 });
		console.log(`❌ ${name} (${Date.now() - t0}ms) — ${(e as Error).message ?? e}`);
	}
}

/**
 * dmdb 的回调式 API 写起来很啰嗦;我们这里用一个最小包装把"取连接 → 跑 SQL → 还连接"包成 async/await。
 * 每次跑查询都借/还一条连接(PoC 规模够用;生产用应该建一个连接池 + 事务绑定到单连接)。
 */
type DmConn = {
	execute: (
		sql: string,
		binds: unknown[],
		options: unknown,
		cb: (err: unknown, result: unknown) => void,
	) => void;
	close: () => Promise<void>;
};

function bindRun(pool: { getConnection: (cb: (err: unknown, c: DmConn) => void) => void }) {
	return async (sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; insertId?: number; affectedRows?: number }> => {
		const conn = await new Promise<DmConn>((resolve, reject) => pool.getConnection((e, c) => (e ? reject(e as Error) : resolve(c))));
		try {
			// rewriteForDm:反引号→双引号 + ?→:n,让达梦默认模式接受 drizzle/mysql-core 的输出
			const sqlFinal = rewriteForDm(sql, params.length);
			return await new Promise((resolve, reject) => {
				conn.execute(
					sqlFinal,
					params.map((v) => {
						if (v === null || v === undefined) return { val: v, type: 2001 };
						if (typeof v === "bigint") return { val: v.toString(), type: 2001 };
						if (v instanceof Date) return { val: v, type: 2014 };
						if (typeof v === "number") return { val: v, type: 2010 };
						return { val: v, type: 2001 };
					}),
					{ outFormat: 4002 /* OBJECT */ },
					(err: unknown, result: unknown) => {
						if (err) return reject(err as Error);
						const r = result as { rows?: Record<string, unknown>[]; insertId?: number; affectedRows?: number };
						resolve({
							rows: (r.rows ?? []) as Record<string, unknown>[],
							insertId: typeof r.insertId === "number" ? r.insertId : undefined,
							affectedRows: typeof r.affectedRows === "number" ? r.affectedRows : undefined,
						});
					},
				);
			});
		} finally {
			await conn.close();
		}
	};
}

async function main() {
	console.log(`连接 → dmdb pool  ${DM_URL}`);
	// dmdb.createPool 异步打开池子,必须 await;Pool 的 connectString 格式 dm://user:pwd@host:port
	const poolRaw = await dmdb.createPool({
		connectString: DM_URL,
		poolMax: 2,
		poolTimeout: 10,
		outFormat: dmdb.OUT_FORMAT_OBJECT,
	} as unknown as Parameters<typeof dmdb.createPool>[0]);
	const pool = poolRaw as unknown as {
		getConnection: (cb: (err: unknown, c: DmConn) => void) => void;
		close: () => Promise<void>;
	};
	console.log("    [pool] 已建立");
	const run = bindRun(pool);

	await probe("1. select 1(纯 sanity)", async () => {
		const r = await run("select 1 as x", []);
		const v = r.rows[0]?.x;
		return `rows=${r.rows.length}, x=${v}`;
	});

	// ⚠️ 表实际在 schema `eg` 下(不是 SYSDBA)。这里用 schema 限定的写法,
	// 也顺带验证带点的反引号标识符(eg.sys_para)的翻译是对的。
	await probe("2. rewriteForDm 的翻译结果(纯打印,不打库)", async () => {
		const samples: Array<{ sql: string; n: number }> = [
			{ sql: "select `para_key`, `para_value` from `eg`.`sys_para` order by `para_key` limit ? offset ?", n: 2 },
			{ sql: "select `id` from `eg`.`sys_tag` where `label` = ?", n: 1 },
			{ sql: "select * from `eg`.`sys_tag_relation` where `tag_id` in (?,?)", n: 2 },
		];
		for (const { sql, n } of samples) {
			console.log(`    原: ${sql}`);
			console.log(`    译: ${rewriteForDm(sql, n)}`);
			console.log("");
		}
		return "ok(仅打印,未打库)";
	});

	await probe("3. 反引号 + LIMIT(eg.sys_para, drizzle/mysql-core 形态)", async () => {
		const r = await run("select `para_key`, `para_value` from `eg`.`sys_para` order by `para_key` limit ? offset ?", [3, 0]);
		// DM 把某些类型塞成对象(Lob / BigInt / Buffer),日志里只取人类能读的字段
		const preview = r.rows.map((row) => {
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(row)) {
				if (v === null || v === undefined) out[k] = String(v);
				else if (typeof v === "bigint") out[k] = v.toString();
				else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
					out[k] = String(v);
				else if (v && typeof v === "object" && "data" in v && (v as { data: unknown }).data instanceof Uint8Array)
					out[k] = `BLOB(${((v as { data: Uint8Array }).data).length}B)`;
				else out[k] = `<${typeof v}>`;
			}
			return out;
		});
		return `rows=${r.rows.length}, 第一行=${json(preview[0])}`;
	});

	await probe("4. INSERT 自增 id(eg.sys_tag,带 create_time/update_time)", async () => {
		const TEST_ID = `__dm_poc_${Date.now()}`;
		const NOW = new Date();
		const ins = await run(
			"insert into `eg`.`sys_tag` (`id`, `parent_id`, `label`, `value`, `sort`, `create_time`, `update_time`) values (?, ?, ?, ?, ?, ?, ?)",
			[TEST_ID, null, `__dm_poc__`, `__dm_poc__`, 0, NOW, NOW],
		);
		const got = await run("select `id`, `label` from `eg`.`sys_tag` where `id` = ?", [TEST_ID]);
		const del = await run("delete from `eg`.`sys_tag` where `id` = ?", [TEST_ID]);
		return `insertId=${ins.insertId} affectedRows=${ins.affectedRows} | 读回 ${json(got.rows[0])} | 删除 affectedRows=${del.affectedRows}`;
	});

	await probe("5. IN (?, ?, ?) — drizzle 的 inArray(eg.sys_para)", async () => {
		const r = await run("select `para_key`, `para_type` from `eg`.`sys_para` where `para_key` in (?, ?, ?) order by `para_key`", [
			"raw.retention.soft_days",
			"sync.enabled",
			"ui.sidebar.collapsed_mode",
		]);
		return `rows=${r.rows.length}, ${r.rows.map((x) => `${x.para_key}=${x.para_type}`).join(", ")}`;
	});

	await probe("6. drizzle 的 `db.execute(sql\`…\`)` 形态(DM 原生信息架构)", async () => {
		// drizzle 用 `information_schema` 是 MySQL/PG 习惯;DM 是 SYS.ALL_TABLES。
		// 这里证明我们的"无参 raw SQL"也能直接走,只是 SQL 本身要换方言。
		const r = await run("select TABLE_NAME from SYS.ALL_TABLES where OWNER = ? order by TABLE_NAME", ["eg"]);
		return `rows=${r.rows.length}, 表=${r.rows.map((x) => x.TABLE_NAME).join(", ")}`;
	});

	await probe("7. drizzle 的 insert 形态(`returningId` 不可用时回退 insertId)", async () => {
		const TEST_ID = `__dm_poc2_${Date.now()}`;
		const NOW = new Date();
		const ins = await run(
			"insert into `eg`.`sys_tag` (`id`, `parent_id`, `label`, `value`, `sort`, `create_time`, `update_time`) values (?, ?, ?, ?, ?, ?, ?)",
			[TEST_ID, null, "__dm_poc2__", null, 0, NOW, NOW],
		);
		const del = await run("delete from `eg`.`sys_tag` where `id` = ?", [TEST_ID]);
		return `insertId=${ins.insertId} (DM/MysqlCompat 下应为 0 或递增), delete affectedRows=${del.affectedRows}`;
	});

	// 总结
	console.log("\n── 汇总 ──");
	for (const r of results) console.log(`${r.ok ? "✅" : "❌"}  ${r.name}  (${r.ms}ms)`);
	const pass = results.filter((r) => r.ok).length;
	console.log(`\n通过 ${pass}/${results.length}`);
	await pool.close();
	process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
	console.error("fatal:", e);
	process.exit(2);
});
