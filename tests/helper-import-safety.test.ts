import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { sysPara, sysRateLimit } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";

const execFileAsync = promisify(execFile);

test("导入公共测试工具不会清除其他批次的数据或会话缓存", async () => {
	const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
	const key = `__test__foreign_${suffix}`;
	const cacheKey = `foreign_session_${suffix}`;
	try {
		await db.insert(sysPara).values({
			para_key: key,
			para_value: "保留",
			para_type: 3,
			created_at: new Date(Date.now() - 60 * 60 * 1000),
		});
		await db.insert(sysRateLimit).values({
			key: cacheKey,
			count: 0,
			value: JSON.stringify({ session: { token: cacheKey } }),
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		});
		await execFileAsync(process.execPath, [
			"--import",
			"tsx",
			"--input-type=module",
			"-e",
			"const h = await import('./tests/helpers.ts'); await h.closeDb();",
		]);
		assert.equal((await db.select().from(sysPara).where(eq(sysPara.para_key, key))).length, 1);
		assert.equal((await db.select().from(sysRateLimit).where(eq(sysRateLimit.key, cacheKey))).length, 1);
	} finally {
		await db.delete(sysRateLimit).where(eq(sysRateLimit.key, cacheKey));
		await db.delete(sysPara).where(eq(sysPara.para_key, key));
		if (dmPool) await dmPool.close();
		else await db.$client.end();
	}
});
