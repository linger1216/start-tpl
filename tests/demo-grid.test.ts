import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { sysDataPolicy, sysDemoGrid, sysDept, sysRole, sysUser, sysUserDept, sysUserRole } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { grantRow } from "../src/lib/data-policy.ts";
import { TEST_PREFIX, assertRejects, closeDb, deleteTestPolicies, purgeTestAuditRows, putPolicyRow, uniqueSuffix } from "./helpers.ts";

/**
 * Demo「网格履职」的行级数据权限 —— 用户要的那张矩阵。现在由 `sys_data_policy` 的**直白授权**承载:
 *
 * | 身份 | 策略 | 期望 |
 * | --- | --- | --- |
 * | 队员 A | `user:A → demo_grid@<行 id>`(每行一条) | 只看自己那几条 |
 * | 队员 B | 同上 | 只看 B 的 ⇒ **两人互不可见** |
 * | 队长 | `user:<队长> → demo_grid@org:<网格组>` | 看得到**本管理单元及以下**全部(含 A、B 的) |
 * | 区 | `role:<区级> → *` | 全部 |
 * | 越权 | —— | 队员拿别人的 id 改 / 删 / 指派 ⇒ **必须失败,且数据没变** |
 *
 * ⚠️ 为什么**不给队长写部门主体规则**(`dept:<网格组>`):队长与队员挂在**同一个**网格组上,
 * 部门规则对"这个部门的**所有人**"生效 —— 那样队员就会看到整条街(实测过的串号)。
 * 按人授权才分得开:队长给"单元",队员给"行"。
 *
 * 部门树按业务里的形状搭:`根(第0层) → 分组(第1层) → 街镇(第2层) → <街镇>网格组(第3层)`,
 * 且**人与数据的归属组织挂同一层**(都挂 `<街镇>网格组`)—— 真实环境就是这样,`@org:` 才一次对上。
 */
const S = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];
const gridIds: string[] = [];
const policyIds: string[] = [];

const id = (kind: string, name: string) => `${TEST_PREFIX}${kind}-${name}-${S}`;
async function makeDept(name: string, parentId: string | null): Promise<string> {
	const deptId = id("d", name);
	deptIds.push(deptId);
	await db
		.insert(sysDept)
		.values({ id: deptId, parent_id: parentId, name: `${TEST_PREFIX}${name}`, sort: 0, status: 1, create_time: new Date(), update_time: new Date() });
	return deptId;
}
/** 角色**只管功能权限**,不再带数据范围 —— 范围由策略行说(返回 code 是为了拼 `role:<code>` 规则) */
async function makeRole(name: string): Promise<{ roleId: string; code: string }> {
	const roleId = id("r", name);
	const code = `${TEST_PREFIX}${name}-${S}`;
	roleIds.push(roleId);
	await db.insert(sysRole).values({ id: roleId, code, name: `${TEST_PREFIX}${name}`, sort: 0, status: 1, create_time: new Date(), update_time: new Date() });
	return { roleId, code };
}
async function makeBareUser(name: string, roleId: string | null): Promise<string> {
	const userId = id("u", name);
	userIds.push(userId);
	await db
		.insert(sysUser)
		.values({ id: userId, name: `${TEST_PREFIX}${name}`, email: `${userId}@example.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
	if (roleId) await db.insert(sysUserRole).values({ id: id("ur", name), user_id: userId, role_id: roleId });
	return userId;
}
async function makeUser(name: string, deptId: string, roleId: string | null): Promise<string> {
	const userId = await makeBareUser(name, roleId);
	await db.insert(sysUserDept).values({ id: id("ud", name), user_id: userId, department_id: deptId });
	return userId;
}
/** `townId` 只管展示 / 筛选;`groupId` 才是行级过滤认的那个「归属组织」 */
async function makeGrid(name: string, townId: string, groupId: string, ownerId: string | null): Promise<string> {
	const gridId = id("g", name);
	gridIds.push(gridId);
	await db
		.insert(sysDemoGrid)
		.values({ id: gridId, name: `${TEST_PREFIX}${name}`, town_name: "测试街镇", town_id: townId, group_id: groupId, owner_id: ownerId, create_time: new Date(), update_time: new Date() });
	return gridId;
}
/** 直接插策略行 —— 迁移脚本 / 后台手工维护写的就是这种(指派流程走 `grantRow`,见下) */
const putPolicy = async (v0: string, v1: string, v2 = "*", v3 = "allow") => {
	policyIds.push(await putPolicyRow(v0, v1, v2, v3));
};

/**
 * ⚠️ 测试里用 `isSuper: true` **跳过权限点那一层**,专门测**行级范围** ——
 * 因为权限中间件**先于**范围生效:不给权限点的话,越权调用会先被 `没有权限:sys:grid:edit` 拦掉,
 * 那样就测不到"范围之外的 id 也改不动"这条了。权限点本身由 `tests/auth.test.ts` 覆盖。
 * (`isSuper` 只影响权限中间件,策略照样真的在生效 —— 见下面每条断言。)
 */
const callerFor = (userId: string) => createCallerFactory(trpcRouter)({ user: { id: userId, name: "t", isSuper: true } });
const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

after(async () => {
	if (gridIds.length) await db.delete(sysDemoGrid).where(inArray(sysDemoGrid.id, gridIds));
	await deleteTestPolicies(policyIds, userIds, gridIds);
	// 这个文件的写操作都是**测试身份**调的 ⇒ 审计行也归它清;先等 fire-and-forget 落地再删
	await purgeTestAuditRows(userIds);
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

		const roleSelf = await makeRole("队员");
		const roleLeader = await makeRole("队长");
		const roleAll = await makeRole("区级");

		const captain = await makeUser("甲镇队长", unitA, roleLeader.roleId);
		const memberA = await makeUser("队员A", unitA, roleSelf.roleId);
		const memberB = await makeUser("队员B", unitA, roleSelf.roleId);
		const region = await makeUser("区里的人", root, roleAll.roleId);

		// 甲镇 3 条(2 条 A 的、1 条 B 的)+ 乙镇 1 条(B 的)
		const a1 = await makeGrid("甲-A1", townA, unitA, memberA);
		const a2 = await makeGrid("甲-A2", townA, unitA, memberA);
		const b1 = await makeGrid("甲-B1", townA, unitA, memberB);
		const b2 = await makeGrid("乙-B2", townB, unitB, memberB);

		// 策略:区 = 角色级 `*`;队长 = 按人给"本单元及以下";两个队员 = 按行(就是指派会写的那种)
		await putPolicy(`role:${roleAll.code}`, "*");
		await putPolicy(`user:${captain}`, `demo_grid@org:${unitA}`);
		await grantRow(memberA, "demo_grid", a1);
		await grantRow(memberA, "demo_grid", a2);
		await grantRow(memberB, "demo_grid", b1);
		await grantRow(memberB, "demo_grid", b2);

		// ① 队员 A:只有自己负责的那两条
		assert.deepEqual(idsOf(await callerFor(memberA).demoGrid.list()), [a1, a2].sort(), "队员A 应只看到自己的两条");

		// ② 队员 B:只有 B 的 ⇒ 与 A **互不可见**
		assert.deepEqual(idsOf(await callerFor(memberB).demoGrid.list()), [b1, b2].sort(), "队员B 应只看到自己的两条");

		// ③ 队长(按人授权到「甲镇网格组」):本单元全部(含 A 与 B 的),但看不到乙镇
		assert.deepEqual(idsOf(await callerFor(captain).demoGrid.list()), [a1, a2, b1].sort(), "队长应看到本管理单元全部、且不含乙镇");

		// ④ 区(角色规则 `*`):不过滤 —— 是**整张表**(表里还有真实的 71 条,别的测试文件也在造网格,
		//     所以只断言「我这 4 条都在」,含乙镇那条 —— 写成"整表逐条相等"会被并行跑的文件冲掉)
		const regionRows = await callerFor(region).demoGrid.list();
		const regionIds = new Set(idsOf(regionRows));
		for (const gridId of [a1, a2, b1, b2]) assert.ok(regionIds.has(gridId), `区级应看到全部:${gridId} 也在里面(含乙镇那条)`);
		assert.ok(regionRows.length >= 4, "区级看到的总数应当不少于这 4 条");

		// ⑤ 越权:队员 A 拿队员 B 的网格 id 去改 —— 必须失败,且 B 的数据**没变**
		const b1Before = (await db.select().from(sysDemoGrid).where(eq(sysDemoGrid.id, b1)))[0];
		await assertRejects(() => callerFor(memberA).demoGrid.update({ id: b1, name: "被篡改了" }), "不在你的数据范围内");
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

		const roleSelf = await makeRole("队员two");
		const roleLeader = await makeRole("队长two");
		const captain = await makeUser("丙镇队长", unitA, roleLeader.roleId);
		const member = await makeUser("丙镇队员", unitA, roleSelf.roleId);
		await putPolicy(`user:${captain}`, `demo_grid@org:${unitA}`);

		// 这条**街镇是丙镇**(队长的街镇),但归属单元是丁镇的 —— 队长不该看到它
		const crossed = await makeGrid("丙镇街镇-丁镇单元", townA, unitB, member);
		await grantRow(member, "demo_grid", crossed);

		const captainIds = idsOf(await callerFor(captain).demoGrid.list());
		assert.equal(captainIds.includes(crossed), false, "行级过滤看 group_id:单元不在我的范围内就看不到");
		// 但"仅本人"那一档认的是**按行授权** ⇒ 队员自己仍然看得到
		assert.deepEqual(idsOf(await callerFor(member).demoGrid.list()), [crossed], "按行授权按行生效,与单元无关");
	});

	it("fail-closed:表里已有策略、但一条都命不中 ⇒ 恒假条件,不能退化成「不过滤」", async () => {
		// ⚠️ 先确保策略表处于「已启用」(否则引擎按"没配策略"处理,会退化成不过滤)
		const other = await makeRole("别人的角色");
		await putPolicy(`role:${other.code}`, "*");

		const role = await makeRole("没范围的角色");
		const orphan = await makeBareUser("没挂部门也没授权的人", role.roleId);
		assert.deepEqual(await callerFor(orphan).demoGrid.list(), [], "一条策略都没命中 ⇒ 0 行");
	});

	it("指派 = 授权写入口:指给谁谁就能看到;换人 / 删行时旧的授权一并撤掉", async () => {
		const root = await makeDept("区three", null);
		const unitA = await makeDept("戊镇网格组", root);
		const roleAll = await makeRole("区级three");
		const roleSelf = await makeRole("队员three");
		const region = await makeUser("区里的人three", root, roleAll.roleId);
		const memberA = await makeUser("队员three-A", unitA, roleSelf.roleId);
		const memberB = await makeUser("队员three-B", unitA, roleSelf.roleId);
		const grid = await makeGrid("戊-1", root, unitA, null);
		await putPolicy(`role:${roleAll.code}`, "*");

		// 指派之前:A 一条都看不到(没有任何指着他的策略行)
		assert.deepEqual(await callerFor(memberA).demoGrid.list(), [], "没被指派过的人看不到");

		// 区把它指派给 A ⇒ 策略表多一条"按行授权给 A",A 立刻看得到
		await callerFor(region).demoGrid.assign({ ids: [grid], ownerId: memberA });
		assert.deepEqual(idsOf(await callerFor(memberA).demoGrid.list()), [grid], "指给谁谁就能看到");

		// 再指给 B ⇒ A 立刻看不到(旧的行被撤),B 看得到
		await callerFor(region).demoGrid.assign({ ids: [grid], ownerId: memberB });
		assert.deepEqual(await callerFor(memberA).demoGrid.list(), [], "换负责人后旧负责人不能再看到");
		assert.deepEqual(idsOf(await callerFor(memberB).demoGrid.list()), [grid], "新负责人看得到");

		// 新建时直接指定负责人 = 一样要写授权(否则他看不见自己那条)
		const created = await callerFor(region).demoGrid.create({ name: `${TEST_PREFIX}新建给A`, groupId: unitA, ownerId: memberA });
		gridIds.push(created.id);
		assert.deepEqual(idsOf(await callerFor(memberA).demoGrid.list()), [created.id], "新建时指定负责人也要写授权");

		// 删行 ⇒ 指着它的策略行也要清掉(别在策略表里留指向不存在行的规则)
		await callerFor(memberB).demoGrid.remove({ ids: [grid] });
		const left = await db.select({ id: sysDataPolicy.id }).from(sysDataPolicy).where(eq(sysDataPolicy.v1, `demo_grid@${grid}`));
		assert.equal(left.length, 0, "行删了,授权也要一并清掉");
	});
});
