/**
 * drizzle → DM(dmdb)整链路冒烟:
 *   db.select() / db.insert().values().returning() / db.update() / db.delete() / db.transaction()
 *
 * 早先那个直连 dmdb、逐条打方言翻译的验证脚本已随本轮收敛移除 —— 方言翻译本身留在
 * `src/db/dm/translate.ts`,不再单开验证脚本;这个是**走 drizzle 查询构造器**,
 * 证明 `db.select().from(sysPara)` 这种业务写法在 DM 上能跑。
 *
 * 跑法:`NODE_OPTIONS=--openssl-legacy-provider dotenv -e .env.local -- tsx scripts/dm-drizzle-smoke.ts`
 */
import { eq, inArray, sql } from "drizzle-orm";

import { sysPara, sysTag } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
async function probe(name: string, fn: () => Promise<string>): Promise<void> {
	try {
		const detail = await fn();
		results.push({ name, ok: true, detail });
		console.log(`✅ ${name} — ${detail}`);
	} catch (e) {
		const detail = (e as Error).message ?? String(e);
		results.push({ name, ok: false, detail });
		console.log(`❌ ${name} — ${detail}`);
	}
}

async function main() {
	console.log(`DATABASE_URL = ${(process.env.DATABASE_URL ?? "").replace(/:[^:@/]+@/, ":***@")}`);
	console.log(`驱动 = ${process.env.DATABASE_URL?.startsWith("dm://") ? "达梦(dmdb + rewriteForDm)" : "MySQL(mysql2)"}\n`);

	await probe("1. db.select().from(sysPara) —— 全表 + limit", async () => {
		const rows = await db.select().from(sysPara).limit(3);
		return `rows=${rows.length}, 首个 key=${rows[0]?.para_key}, type=${typeof rows[0]?.para_type}`;
	});

	await probe("2. select 投影 + where(eq) + orderBy", async () => {
		const rows = await db
			.select({ key: sysPara.para_key, value: sysPara.para_value })
			.from(sysPara)
			.where(eq(sysPara.para_key, "sync.enabled"))
			.orderBy(sysPara.para_key);
		return `rows=${rows.length}, ${JSON.stringify(rows[0])}`;
	});

	await probe("3. inArray 批量条件", async () => {
		const rows = await db
			.select({ key: sysPara.para_key })
			.from(sysPara)
			.where(inArray(sysPara.para_key, ["sync.enabled", "cleanup.enabled", "sync.overlap_seconds"]))
			.orderBy(sysPara.para_key);
		return `rows=${rows.length}, keys=${rows.map((r) => r.key).join(",")}`;
	});

	await probe("4. db.execute(sql`…`) —— 裸 SQL 通道", async () => {
		// 约定同 mysql2:结果是 [rows, fields]
		const [rows] = (await db.execute(sql`select count(*) as n from ${sysPara}`)) as unknown as [
			Array<Record<string, unknown>>,
			unknown,
		];
		return `rows=${rows.length}, n=${JSON.stringify(rows[0])}`;
	});

	const TEST_ID = `__dm_smoke_${Date.now()}`;
	await probe("5. insert → select 读回 → delete(写链路)", async () => {
		const NOW = new Date();
		await db.insert(sysTag).values({
			id: TEST_ID,
			parent_id: null,
			label: "__dm_smoke__",
			value: null,
			sort: 0,
			create_time: NOW,
			update_time: NOW,
		});
		const back = await db.select().from(sysTag).where(eq(sysTag.id, TEST_ID));
		const del = await db.delete(sysTag).where(eq(sysTag.id, TEST_ID));
		const after = await db.select().from(sysTag).where(eq(sysTag.id, TEST_ID));
		return `插入后读回=${back.length} 行(label=${back[0]?.label}), 删除 affected=${JSON.stringify(del)}, 删后=${after.length} 行`;
	});

	await probe("6. db.transaction() —— 真事务(BEGIN/COMMIT)", async () => {
		const id1 = `__dm_tx1_${Date.now()}`;
		const id2 = `__dm_tx2_${Date.now()}`;
		const NOW = new Date();
		const out = await db.transaction(async (tx) => {
			await tx.insert(sysTag).values({ id: id1, parent_id: null, label: "__dm_tx__", value: null, sort: 0, create_time: NOW, update_time: NOW });
			await tx.insert(sysTag).values({ id: id2, parent_id: null, label: "__dm_tx__", value: null, sort: 0, create_time: NOW, update_time: NOW });
			const inner = await tx.select().from(sysTag).where(inArray(sysTag.id, [id1, id2]));
			return inner.length;
		});
		// 收尾
		await db.delete(sysTag).where(inArray(sysTag.id, [id1, id2]));
		return `事务内可见 ${out} 行,已回滚清理`;
	});

	await probe("7. db.transaction() 出错要回滚", async () => {
		const id = `__dm_txrollback_${Date.now()}`;
		const NOW = new Date();
		try {
			await db.transaction(async (tx) => {
				await tx.insert(sysTag).values({ id, parent_id: null, label: "__dm_rb__", value: null, sort: 0, create_time: NOW, update_time: NOW });
				throw new Error("故意失败,验证回滚");
			});
		} catch {
			/* 预期 */
		}
		const left = await db.select().from(sysTag).where(eq(sysTag.id, id));
		await db.delete(sysTag).where(eq(sysTag.id, id));
		return `回滚后残留 ${left.length} 行(应为 0)`;
	});

	console.log("\n── 汇总 ──");
	for (const r of results) console.log(`${r.ok ? "✅" : "❌"}  ${r.name}`);
	const pass = results.filter((r) => r.ok).length;
	console.log(`\n通过 ${pass}/${results.length}`);
	if (dmPool) await dmPool.close();
	process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (e) => {
	console.error("fatal:", e);
	if (dmPool) await dmPool.close().catch(() => {});
	process.exit(2);
});
