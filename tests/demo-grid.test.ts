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
 * | 队长(`dept_below`) | 看得到**本「管理单元」及以下**的全部(含 A、B 的) |
 * | 区(`all`) | 全部 |
 * | 越权 | 队员拿别人的 id 改/删/指派 ⇒ **必须失败,且数据没变** |
 *
 * 部门树按业务里的形状搭:`根(第0层) → 分组(第1层) → 街镇(第2层) → <街镇>网格组(第3层)`。
 * 关键是**人与数据的「归属组织」挂在同一层**(都挂 `<街镇>网格组`)—— 真实环境就是这样,
 * 于是 `dept_below` 恰好等于"本网格组",不需要去数"从根往下第几层"。
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
async function makeBareUser(name: string, roleId: string): Promise<string> {
	const userId = id("u", name);
	userIds.push(userId);
	await db.insert(sysUser).values({ id: userId, name: `${TEST_PREFIX}${name}`, email: `${userId}@example.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
	await db.insert(sysUserRole).values({ id: id("ur", name), user_id: userId, role_id: roleId });
	return userId;
}
async function makeUser(name: string, deptId: string, roleId: string): Promise<string> {
	const userId = await makeBareUser(name, roleId);
	await db.insert(sysUserDept).values({ id: id("ud", name), user_id: userId, department_id: deptId });
	return userId;
}
/** `townId` 只管展示 / 筛选;`groupId` 才是行级过滤认的那个「管理单元」 */
async function makeGrid(name: string, townId: string, groupId: string, ownerId: string | null): Promise<string> {
	const gridId = id("g", name);
	gridIds.push(gridId);
	await db
		.insert(sysDemoGrid)
		.values({ id: gridId, name: `${TEST_PREFIX}${name}`, town_name: "测试街镇", town_id: townId, group_id: groupId, owner_id: ownerId, create_time: new Date(), update_time: new Date() });
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
	it("队员只看自己的、队长看本管理单元、区看全部、越权的改删被拒", async () => {
		// 部门树:根(0) → 分组(1) → 街镇(2) → <街镇>网格组(3,就是"管理单元")
		const root = await makeDept("区", null);
		const group = await makeDept("分组", root);
		const townA = await makeDept("甲镇", group);
		const unitA = await makeDept("甲镇网格组", townA);
		const townB = await makeDept("乙镇", group);
		const unitB = await makeDept("乙镇网格组", townB);

		const roleSelf = await makeRole("队员", "self");
		const roleLeader = await makeRole("队长", "dept_below");
		const roleAll = await makeRole("区级", "all");

		const captain = await makeUser("甲镇队长", unitA, roleLeader);
		const memberA = await makeUser("队员A", unitA, roleSelf);
		const memberB = await makeUser("队员B", unitA, roleSelf);
		const region = await makeUser("区里的人", root, roleAll);

		// 甲镇 3 条(2 条 A 的、1 条 B 的)+ 乙镇 1 条(B 的)
		const a1 = await makeGrid("甲-A1", townA, unitA, memberA);
		const a2 = await makeGrid("甲-A2", townA, unitA, memberA);
		const b1 = await makeGrid("甲-B1", townA, unitA, memberB);
		const b2 = await makeGrid("乙-B2", townB, unitB, memberB);

		// ① 队员 A:只有自己负责的那两条
		assert.deepEqual(idsOf(await callerFor(memberA).demoGrid.list()), [a1, a2].sort(), "队员A 应只看到自己的两条");

		// ② 队员 B:只有 B 的 ⇒ 与 A **互不可见**
		assert.deepEqual(idsOf(await callerFor(memberB).demoGrid.list()), [b1, b2].sort(), "队员B 应只看到自己的两条");

		// ③ 队长(甲镇网格组,dept_below):本单元全部(含 A 与 B 的),但看不到乙镇
		assert.deepEqual(idsOf(await callerFor(captain).demoGrid.list()), [a1, a2, b1].sort(), "队长应看到本管理单元全部、且不含乙镇");

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

	it("过滤认「归属组织(group_id)」而不是街镇:街镇对得上、单元对不上也看不到", async () => {
		const root = await makeDept("区two", null);
		const townA = await makeDept("丙镇", root);
		const unitA = await makeDept("丙镇网格组", townA);
		const townB = await makeDept("丁镇", root);
		const unitB = await makeDept("丁镇网格组", townB);

		const roleSelf = await makeRole("队员two", "self");
		const roleLeader = await makeRole("队长two", "dept_below");
		const captain = await makeUser("丙镇队长", unitA, roleLeader);
		const member = await makeUser("丙镇队员", unitA, roleSelf);

		// 这条**街镇是丙镇**(队长的街镇),但归属单元是丁镇的 —— 队长不该看到它
		const crossed = await makeGrid("丙镇街镇-丁镇单元", townA, unitB, member);

		const captainIds = idsOf(await callerFor(captain).demoGrid.list());
		assert.equal(captainIds.includes(crossed), false, "行级过滤看 group_id:单元不在我的范围内就看不到");
		// 但"仅本人"那一档认的是负责人 ⇒ 队员自己仍然看得到
		assert.deepEqual(idsOf(await callerFor(member).demoGrid.list()), [crossed], "self 档按 owner_id 过滤,与单元无关");
	});

	it("fail-closed:有 dept_below 角色却没有任何部门 ⇒ 一条都看不到", async () => {
		const role = await makeRole("没部门two", "dept_below");
		const orphan = await makeBareUser("没挂部门的人", role);
		assert.deepEqual(await callerFor(orphan).demoGrid.list(), [], "空集合 ⇒ 恒假条件,不能退化成「不过滤」");
	});
});
