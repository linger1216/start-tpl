import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysDemoGrid, sysDept, sysRole, sysUser, sysUserDept, sysUserRole } from "../src/db/data-base-schema.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { TEST_PREFIX, assertRejects, closeDb, uniqueSuffix } from "./helpers.ts";

/**
 * Demo「网格履职」的行级数据权限 —— 就是用户要的那张矩阵:
 *
 * | 身份 | 期望 |
 * | --- | --- |
 * | 队员 A(`self`) | 只看 `owner_id = A` 的 |
 * | 队员 B(`self`) | 只看 B 的 ⇒ **两人互不可见** |
 * | 队长(`up:2`) | 看得到**本街镇及以下**的全部(含 A、B 的) |
 * | 区(`all`) | 全部 |
 * | 越权 | 队员拿别人的 id 改/删/指派 ⇒ **必须失败,且数据没变** |
 *
 * 部门树按业务里的形状搭:`根(第0层) → 分组(第1层) → 街镇(第2层) → 科室(第3层)`
 * —— 这样 `up:2` 才是"往上到街镇"。
 */
const S = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];
const gridIds: string[] = [];

const id = (kind: string, name: string) => `${TEST_PREFIX}${kind}-${name}-${S}`;
async function makeDept(name: string, parentId: string | null): Promise<string> {
	const deptId = id("d", name);
	deptIds.push(deptId);
	await db.insert(sysDept).values({ id: deptId, parent_id: parentId, name: `${TEST_PREFIX}${name}`, sort: 0, status: 1, create_time: new Date(), update_time: new Date() });
	return deptId;
}
async function makeRole(name: string, scope: string): Promise<string> {
	const roleId = id("r", name);
	roleIds.push(roleId);
	await db.insert(sysRole).values({ id: roleId, code: `${TEST_PREFIX}${name}-${S}`, name: `${TEST_PREFIX}${name}`, sort: 0, status: 1, data_scope: scope, create_time: new Date(), update_time: new Date() });
	return roleId;
}
async function makeUser(name: string, deptId: string, roleId: string): Promise<string> {
	const userId = id("u", name);
	userIds.push(userId);
	await db.insert(sysUser).values({ id: userId, name: `${TEST_PREFIX}${name}`, email: `${userId}@example.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
	await db.insert(sysUserDept).values({ id: id("ud", name), user_id: userId, department_id: deptId });
	await db.insert(sysUserRole).values({ id: id("ur", name), user_id: userId, role_id: roleId });
	return userId;
}
async function makeGrid(name: string, townId: string, ownerId: string | null): Promise<string> {
	const gridId = id("g", name);
	gridIds.push(gridId);
	await db.insert(sysDemoGrid).values({ id: gridId, name: `${TEST_PREFIX}${name}`, town_name: "测试街镇", town_id: townId, owner_id: ownerId, create_time: new Date(), update_time: new Date() });
	return gridId;
}
/**
 * ⚠️ 测试里用 `isSuper: true` **跳过权限点那一层**,专门测**行级范围** ——
 * 因为权限中间件**先于**范围生效:不给权限点的话,越权调用会先被 `没有权限:sys:grid:edit` 拦掉,
 * 那样就测不到"范围之外的 id 也改不动"这条了。权限点本身由 `tests/auth.test.ts` 覆盖。
 * (`isSuper` 只影响权限中间件,`scopeOf` 仍然照样查库 —— 所以范围还是真的在生效。)
 */
const callerFor = (userId: string) => createCallerFactory(trpcRouter)({ user: { id: userId, name: "t", isSuper: true } });
const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

after(async () => {
	if (gridIds.length) await db.delete(sysDemoGrid).where(inArray(sysDemoGrid.id, gridIds));
	if (userIds.length) {
		await db.delete(sysUserDept).where(inArray(sysUserDept.user_id, userIds));
		await db.delete(sysUserRole).where(inArray(sysUserRole.user_id, userIds));
		await db.delete(sysUser).where(inArray(sysUser.id, userIds));
	}
	if (roleIds.length) {
		await db.delete(sysUserRole).where(inArray(sysUserRole.role_id, roleIds));
		await db.delete(sysRole).where(inArray(sysRole.id, roleIds));
	}
	if (deptIds.length) {
		await db.delete(sysUserDept).where(inArray(sysUserDept.department_id, deptIds));
		for (const deptId of [...deptIds].reverse()) await db.delete(sysDept).where(eq(sysDept.id, deptId));
	}
	await closeDb();
});

describe("Demo 网格履职:行级数据权限", () => {
	it("队员只看自己的、队长看本街镇、区看全部、越权的改删被拒", async () => {
		// 部门树:根(0) → 分组(1) → 街镇(2) → 两个科室(3)
		const root = await makeDept("区", null);
		const group = await makeDept("分组", root);
		const townA = await makeDept("甲镇", group);
		const teamA1 = await makeDept("甲镇一队", townA);
		const teamA2 = await makeDept("甲镇二队", townA);
		const townB = await makeDept("乙镇", group);

		const roleSelf = await makeRole("队员", "self");
		const roleLeader = await makeRole("队长", "up:2");
		const roleAll = await makeRole("区级", "all");

		const captain = await makeUser("甲镇队长", teamA1, roleLeader);
		const memberA = await makeUser("队员A", teamA1, roleSelf);
		const memberB = await makeUser("队员B", teamA2, roleSelf);
		const region = await makeUser("区里的人", root, roleAll);

		// 甲镇 3 条(2 条 A 的、1 条 B 的)+ 乙镇 1 条(B 的)
		const a1 = await makeGrid("甲-A1", townA, memberA);
		const a2 = await makeGrid("甲-A2", townA, memberA);
		const b1 = await makeGrid("甲-B1", townA, memberB);
		const b2 = await makeGrid("乙-B2", townB, memberB);

		// ① 队员 A:只有自己负责的那两条
		assert.deepEqual(idsOf(await callerFor(memberA).demoGrid.list()), [a1, a2].sort(), "队员A 应只看到自己的两条");

		// ② 队员 B:只有 B 的 ⇒ 与 A **互不可见**
		assert.deepEqual(idsOf(await callerFor(memberB).demoGrid.list()), [b1, b2].sort(), "队员B 应只看到自己的两条");

		// ③ 队长(甲镇,up:2):甲镇**全部**(含 A 与 B 的),但看不到乙镇
		const captainRows = idsOf(await callerFor(captain).demoGrid.list());
		assert.deepEqual(captainRows, [a1, a2, b1].sort(), "队长应看到本街镇全部、且不含乙镇");

		// ④ 区:不过滤 —— 是**整张表**(表里还有真实的 71 条数据,所以只断言「我这 4 条都在」)
		const regionRows = await callerFor(region).demoGrid.list();
		const regionMine = regionRows.filter((row) => row.name.startsWith(TEST_PREFIX)).map((row) => row.id).sort();
		assert.deepEqual(regionMine, [a1, a2, b1, b2].sort(), "区级应看到全部(含我这 4 条)");
		assert.ok(regionRows.length >= 4, "区级看到的总数应当不少于这 4 条");

		// ⑤ 越权:队员 A 拿队员 B 的网格 id 去改 —— 必须失败,且 B 的数据**没变**
		const b1Before = (await db.select().from(sysDemoGrid).where(eq(sysDemoGrid.id, b1)))[0];
		await assertRejects(
			() => callerFor(memberA).demoGrid.update({ id: b1, name: "被篡改了" }),
			"不在你的数据范围内",
		);
		const b1After = (await db.select().from(sysDemoGrid).where(eq(sysDemoGrid.id, b1)))[0];
		assert.equal(b1After?.name, b1Before?.name, "越权改不能生效");

		// ⑥ 越权:删 / 指派同样要被拦
		await assertRejects(() => callerFor(memberA).demoGrid.remove({ ids: [b1] }), "不在你的数据范围内");
		await assertRejects(() => callerFor(memberA).demoGrid.assign({ ids: [b1], ownerId: memberA }), "不在你的数据范围内");
		const b1Still = (await db.select().from(sysDemoGrid).where(eq(sysDemoGrid.id, b1)))[0];
		assert.equal(b1Still?.owner_id, memberB, "越权指派不能生效");
	});
});
