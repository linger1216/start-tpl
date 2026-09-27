/**
 * 一次性探针:复刻 tests/user-crud.test.ts 的收尾路径(建号 → 登录 → 清理 → closeDb),
 * 每一步打时间戳,定位到底卡在哪一段。用完即删。
 */
import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { sysAccount, sysSession, sysUser } from "#/db/data-base-schema.ts";
import { auth } from "#/lib/auth.ts";
import { caller, closeDb, TEST_PREFIX, uniqueSuffix } from "../tests/helpers.ts";

const t0 = Date.now();
const step = (msg: string) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms] ${msg}`);

function activeHandles(label: string) {
	const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
	const names = handles.map((h) => (h as { constructor?: { name?: string } })?.constructor?.name ?? "?");
	const counts = new Map<string, number>();
	for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
	console.log(`[${label}] 活跃句柄:`, JSON.stringify(Object.fromEntries(counts)));
}

const PASSWORD = "Passw0rd!123";

async function main() {
	step("start");
	activeHandles("start");

	const email = `${TEST_PREFIX}probe_${uniqueSuffix()}@example.com`;
	const created = await caller.user.create({ name: "探针用户", email, password: PASSWORD });
	step(`caller.user.create ok id=${created.id}`);
	activeHandles("after-create");

	const res = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
	step(`auth.api.signInEmail ok user=${res.user?.id ?? "?"}`);
	activeHandles("after-signin");

	await db.delete(sysSession).where(eq(sysSession.userId, created.id));
	step("delete sys_session ok");
	await db.delete(sysAccount).where(eq(sysAccount.userId, created.id));
	step("delete sys_account ok");
	await db.delete(sysUser).where(eq(sysUser.id, created.id));
	step("delete sys_user ok");
	activeHandles("before-closeDb");

	await closeDb();
	step("closeDb ok");
	activeHandles("after-closeDb");
	step("done(若此处无输出而进程不退,说明是残留句柄)");
}

main().catch((err) => {
	console.error("[x] 探针报错:", err);
	process.exit(1);
});
