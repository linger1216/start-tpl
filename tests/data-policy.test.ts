import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";

import { casbinRule, sysDataPolicy, sysDemoGrid, sysDept, sysRole, sysUser, sysUserDept } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { clearCasbinCache } from "../src/lib/casbin.ts";
import {
	REGISTERED_RESOURCE_TYPES,
	clearDataPolicyCache,
	dataScopeWhere,
	ensureRule,
	grantOrg,
	grantRow,
	revokeRow,
} from "../src/lib/data-policy.ts";
import {
	POLICY_RESOURCES,
	type PolicyAction,
	type PolicyEffect,
	type PolicyExplain,
	type PolicyScopeKind,
	type PolicySubjectKind,
	compileScopePlan,
	parseAction,
	parseResource,
	parseSubject,
	policyRuleProblem,
	resourceUnder,
} from "../src/lib/data-policy-spec.ts";
import { collectAncestorIds, collectDescendantIds } from "../src/lib/tree.ts";
import { TEST_PREFIX, caller, closeDb, deleteTestPolicies, putPolicyRow, testId, uniqueSuffix } from "./helpers.ts";

/**
 * 行级数据权限(Casbin 策略行)。
 *
 * 口径一句话:**「谁能看哪个资源」只由 `sys_data_policy` 的规则说了算** —— 角色只管功能权限,
 * 数据范围不再挂在角色上(`sys_role.data_scope` 那一列已经删了)。
 *
 * 两半都测:① 纯逻辑(`data-policy-spec.ts`,不碰库);② 落到真实数据上真的筛出正确的行。
 */
const S = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];
const gridIds: string[] = [];
const policyIds: string[] = [];

const id = (kind: string, name: string) => testId(kind, name, S, kind === "u" ? 36 : 32);

async function makeDept(name: string, parentId: string | null): Promise<string> {
	const deptId = id("d", name);
	deptIds.push(deptId);
	await db.insert(sysDept).values({ id: deptId, parent_id: parentId, name: `${TEST_PREFIX}${name}`, sort: 0, status: 1, create_time: new Date(), update_time: new Date() });
	return deptId;
}
async function makeUser(name: string): Promise<string> {
	const userId = id("u", name);
	userIds.push(userId);
	await db.insert(sysUser).values({ id: userId, name: `${TEST_PREFIX}${name}`, email: `${userId}@example.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
	return userId;
}
/** 角色只带功能权限了 —— 返回 `code`(策略行认 code,不认 id)与 `roleId`(分配用) */
async function makeRole(code: string, status = 1): Promise<{ roleId: string; code: string }> {
	const roleId = id("r", code);
	roleIds.push(roleId);
	const value = `${TEST_PREFIX}${code}-${S}`;
	await db.insert(sysRole).values({ id: roleId, code: value, name: `${TEST_PREFIX}${code}`, sort: 0, status, create_time: new Date(), update_time: new Date() });
	return { roleId, code: value };
}
const put = async (userId: string, deptId: string) => {
	await db.insert(sysUserDept).values({ id: id("ud", `${userId}-${deptId}`), user_id: userId, department_id: deptId });
};
const assign = async (userId: string, roleId: string) => {
	// 成员关系在策略表里是 `g` 行,而且认的是角色 **code**(不是 id)—— 所以先查一下
	const [role] = await db.select({ code: sysRole.code }).from(sysRole).where(eq(sysRole.id, roleId));
	if (!role) return;
	await db.insert(casbinRule).values({
		id: id("g", `${userId}-${roleId}`),
		ptype: "g",
		v0: `user:${userId}`,
		v1: `role:${role.code}`,
		v2: "",
	});
	// 直接写表、绕过了领域函数 ⇒ 手动刷缓存(否则判定还停在旧策略上)
	clearCasbinCache();
};

/** 直接插一行策略 —— 迁移脚本 / 后台手工维护写的就是这种行(指派流程走 `grantRow`) */
const putPolicy = async (v0: string, v1: string, v2 = "*", v3 = "allow", status = 1) => {
	policyIds.push(await putPolicyRow(v0, v1, v2, v3, status));
};

/** 某人「读 / 写」网格时看得到的行;`mine` 只留 `tag` 这套用例造的行,`total` 是全部(过不过滤一眼看得出) */
async function gridsVisibleTo(userId: string | null, tag: string, action: "read" | "write" = "read") {
	const where = await dataScopeWhere(userId, "demo_grid", action);
	const rows = await db.select({ id: sysDemoGrid.id, name: sysDemoGrid.name }).from(sysDemoGrid).where(where);
	const prefix = `${TEST_PREFIX}${tag}`;
	return { mine: rows.filter((row) => row.name.startsWith(prefix)).map((row) => row.id).sort(), total: rows.length };
}

/** 某人「读 / 写」用户表时看得到的行(`sys_user` 没有组织列 ⇒ 引擎走多对多子查询那条分支) */
async function usersVisibleTo(userId: string | null, tag: string, action: "read" | "write" = "read") {
	const where = await dataScopeWhere(userId, "sys_user", action);
	const rows = await db.select({ id: sysUser.id, name: sysUser.name }).from(sysUser).where(where);
	const prefix = `${TEST_PREFIX}${tag}`;
	return { mine: rows.filter((row) => row.name.startsWith(prefix)).map((row) => row.id).sort(), total: rows.length };
}

async function makeGrid(tag: string, name: string, groupId: string): Promise<string> {
	const gridId = id("g", `${tag}-${name}`);
	gridIds.push(gridId);
	await db
		.insert(sysDemoGrid)
		.values({ id: gridId, name: `${TEST_PREFIX}${tag}-${name}`, town_name: "测试街镇", town_id: groupId, group_id: groupId, create_time: new Date(), update_time: new Date() });
	return gridId;
}

/**
 * 一套迷你组织:**区 → 甲镇 → 甲镇网格组**(人挂在这一层,正是真实环境的形状)。
 * 甲镇的网格归属在「甲镇网格组」,乙镇的另一套 —— 用来验证「按单元筛,不是按街镇筛」。
 */
async function fixture(tag: string) {
	const district = await makeDept(`${tag}-区`, null);
	const townA = await makeDept(`${tag}-甲镇`, district);
	const unitA = await makeDept(`${tag}-甲镇网格组`, townA);
	const townB = await makeDept(`${tag}-乙镇`, district);
	const unitB = await makeDept(`${tag}-乙镇网格组`, townB);
	return {
		district,
		townA,
		unitA,
		townB,
		unitB,
		gridA1: await makeGrid(tag, "甲-1", unitA),
		gridA2: await makeGrid(tag, "甲-2", unitA),
		gridB1: await makeGrid(tag, "乙-1", unitB),
	};
}

after(async () => {
	if (gridIds.length) await db.delete(sysDemoGrid).where(inArray(sysDemoGrid.id, gridIds));
	// 策略行三种写法都要清:按 id(自己插的)、按主体(测试账号)、按资源(测试网格)
	await deleteTestPolicies(policyIds, userIds, gridIds);
	if (userIds.length) {
		await db.delete(sysUserDept).where(inArray(sysUserDept.user_id, userIds));
		// 成员关系是策略表的 `g` 行,主体是 `user:<id>`
		await db
			.delete(casbinRule)
			.where(and(eq(casbinRule.ptype, "g"), inArray(casbinRule.v0, userIds.map((userId) => `user:${userId}`))));
		await db.delete(sysUser).where(inArray(sysUser.id, userIds));
	}
	if (roleIds.length) {
		await db.delete(sysRole).where(inArray(sysRole.id, roleIds));
	}
	if (deptIds.length) {
		await db.delete(sysUserDept).where(inArray(sysUserDept.department_id, deptIds));
		// 从深到浅删(子在前)
		for (const deptId of [...deptIds].reverse()) await db.delete(sysDept).where(eq(sysDept.id, deptId));
	}
	// 上面是直接删表,绕过了 `lib/casbin.ts` 的领域函数 → 判定缓存要手动刷
	clearCasbinCache();
	clearDataPolicyCache();
	await closeDb();
});

describe("策略行的纯逻辑", () => {
	it("资源注册表两边一致(少一边,写出来的策略行会被当非法静默忽略)", () => {
		assert.deepEqual(
			[...REGISTERED_RESOURCE_TYPES].sort(),
			Object.keys(POLICY_RESOURCES).sort(),
			"`lib/data-policy.ts` 的物理注册表与 `lib/data-policy-spec.ts` 的资源清单必须一一对应",
		);
	});

	it("parseSubject:全局 / 三种主体;写错的必须被拒", () => {
		assert.deepEqual(parseSubject("*"), { kind: "all" });
		assert.deepEqual(parseSubject("user:u1"), { kind: "user", id: "u1" });
		assert.deepEqual(parseSubject(" role:sys_admin "), { kind: "role", id: "sys_admin" }, "两端空白容忍");
		assert.deepEqual(parseSubject("dept:七宝镇网格组"), { kind: "dept", id: "七宝镇网格组" }, "中文 id 也认(角色 code 没限字符集)");
		for (const bad of ["", "张三", "user:", ":u1", "org:u1", "user:a b", "user:a:b", `user:${"x".repeat(65)}`]) {
			assert.equal(parseSubject(bad), null, `${bad} 应当被拒`);
		}
	});

	it("parseResource:全局 / 整个类型 / 某组织(含子树)/ 某一行", () => {
		assert.deepEqual(parseResource("*"), { kind: "all" });
		assert.deepEqual(parseResource("demo_grid"), { kind: "type", type: "demo_grid" });
		assert.deepEqual(parseResource("demo_grid@org:d-1"), { kind: "org", type: "demo_grid", id: "d-1" });
		assert.deepEqual(parseResource("sys_user@u-1"), { kind: "row", type: "sys_user", id: "u-1" });
		for (const bad of ["", "demo_grids", "demo_grid@", "demo_grid@org:", "没登记的类型", `demo_grid@${"x".repeat(65)}`]) {
			assert.equal(parseResource(bad), null, `${bad} 应当被拒`);
		}
	});

	it("parseAction / policyRuleProblem:合法行返回 null,非法行给出中文原因", () => {
		for (const ok of ["read", "write", "*"]) assert.equal(parseAction(ok), ok, `${ok} 应当合法`);
		for (const bad of ["", "READ", "delete", "read,write"]) assert.equal(parseAction(bad), null, `${bad} 应当被拒`);

		assert.equal(policyRuleProblem({ sub: "user:u1", obj: "demo_grid@org:d1", act: "read", eft: "allow" }), null);
		assert.match(policyRuleProblem({ sub: "张三", obj: "demo_grid", act: "read", eft: "allow" }) ?? "", /主体不合法/);
		assert.match(policyRuleProblem({ sub: "*", obj: "没登记的类型", act: "read", eft: "allow" }) ?? "", /资源不合法/);
		assert.match(policyRuleProblem({ sub: "*", obj: "demo_grid", act: "删", eft: "allow" }) ?? "", /动作不合法/);
		assert.match(policyRuleProblem({ sub: "*", obj: "demo_grid", act: "read", eft: "maybe" }) ?? "", /效果不合法/);
	});

	it("resourceUnder:策略更具体算命中;**解析不出来一律不算**(否则判定与编译两处口径打架)", () => {
		assert.equal(resourceUnder("demo_grid", "*"), true);
		assert.equal(resourceUnder("demo_grid", "demo_grid"), true);
		assert.equal(resourceUnder("demo_grid", "demo_grid@org:d1"), true);
		assert.equal(resourceUnder("demo_grid", "demo_grid@g1"), true);
		assert.equal(resourceUnder("demo_grid", "sys_user"), false, "别的资源类型不算命中");
		assert.equal(resourceUnder("demo_grid", "demo_grids"), false, "写错字 ⇒ 不算命中");
		// 请求方是**具体资源**时:盖得住它的策略命中,别的具体范围不命中(包含关系要查库,一律不猜)
		assert.equal(resourceUnder("demo_grid@org:d1", "*"), true, "策略是 `*` ⇒ 什么都覆盖");
		assert.equal(resourceUnder("demo_grid@g1", "demo_grid"), true, "整类型的策略覆盖得到这一行");
		assert.equal(resourceUnder("demo_grid@g1", "demo_grid@g1"), true, "同一条行重合");
		assert.equal(resourceUnder("demo_grid@g1", "demo_grid@g2"), false, "两条不同的行");
		assert.equal(resourceUnder("demo_grid@org:d1", "demo_grid@org:d2"), false, "两个不同的组织");
		assert.equal(resourceUnder("demo_grid@org:d1", "demo_grid@g1"), false, "组织与行之间要查 sys_dept ⇒ 不猜");
	});

	it("compileScopePlan:deny 盖住整个请求才一票否决;命中的多条 allow 取并集(借调 = 多一条)", () => {
		const rule = (obj: string, act = "*", eft = "allow") => ({ sub: "user:u1", obj, act, eft });
		const empty = { unrestricted: false, denied: false, orgs: [], rows: [], denyOrgs: [], denyRows: [] };
		const plan = (rules: Array<ReturnType<typeof rule>>) => compileScopePlan(rules, "demo_grid", "read");

		assert.deepEqual(plan([rule("*")]), { ...empty, unrestricted: true }, "`*` ⇒ 不限制");
		assert.deepEqual(
			plan([rule("demo_grid@org:d2"), rule("demo_grid@org:d1"), rule("demo_grid@g1")]),
			{ ...empty, orgs: ["d1", "d2"], rows: ["g1"] },
			"组织节点与具体行并集,并排序(结果稳定)",
		);
		// `deny` 盖住整个请求(`*` / 裸类型)⇒ 恒假(一票否决);只盖住一部分 ⇒ 减掉那一部分,不牵连别的行
		assert.deepEqual(plan([rule("demo_grid", "*", "deny"), rule("*")]), { ...empty, denied: true }, "裸类型 deny ⇒ 整个类型都看不见");
		assert.deepEqual(plan([rule("*", "*", "deny")]), { ...empty, denied: true }, "`*` deny 一票否决");
		assert.deepEqual(plan([rule("demo_grid@org:d1"), rule("demo_grid@g1", "*", "deny")]), { ...empty, orgs: ["d1"], denyRows: ["g1"] }, "只 deny 一行:别的行照常");
		assert.deepEqual(plan([rule("demo_grid@org:d1", "*", "deny")]), { ...empty, denyOrgs: ["d1"] }, "deny 一个组织:减掉它的子树");
		assert.deepEqual(plan([rule("demo_grid@org:d1", "write")]), empty, "动作对不上不算命中");
		assert.deepEqual(plan([rule("sys_user")]), empty, "别的资源不算命中");
	});

	it("collectDescendantIds / collectAncestorIds:子树含自己、祖先不含自己、环状脏数据不炸", () => {
		const rows = [
			{ id: "区", parentId: null },
			{ id: "甲镇", parentId: "区" },
			{ id: "甲-1", parentId: "甲镇" },
			{ id: "甲-2", parentId: "甲镇" },
			{ id: "乙镇", parentId: "区" },
		];
		assert.deepEqual(collectDescendantIds(rows, ["甲镇"]).sort(), ["甲-1", "甲-2", "甲镇"]);
		assert.deepEqual(collectAncestorIds(rows, ["甲-1"]).sort(), ["区", "甲镇"], "祖先链不含自己");
		assert.deepEqual(collectAncestorIds(rows, ["区"]), [], "根没有祖先");

		const cyclic = [
			{ id: "x", parentId: "y" },
			{ id: "y", parentId: "x" },
		];
		assert.deepEqual(collectDescendantIds(cyclic, ["x"]).sort(), ["x", "y"]);
		assert.deepEqual(collectAncestorIds(cyclic, ["x"]).sort(), ["y"]);
	});
});

describe("策略落到真实数据上", () => {
	it("没有用户上下文 / 资源没登记 / 策略表一条都没启用 ⇒ 不加条件", async () => {
		const user = await makeUser("没上下文");
		assert.equal(await dataScopeWhere(null, "demo_grid", "read"), undefined, "脚本 / 后台任务直调不误伤");
		assert.equal(await dataScopeWhere(user, "没登记的资源", "read"), undefined, "没登记的资源不设防");

		const counted = await db.select({ n: sql<number>`count(*)` }).from(sysDataPolicy).where(eq(sysDataPolicy.status, 1));
		if (Number(counted[0]?.n ?? 0) === 0) {
			assert.equal(await dataScopeWhere(user, "demo_grid", "read"), undefined, "策略表空 = 数据权限未启用 = 不收窄(与「菜单未授权」同口径)");
		} else {
			// 库里已经有启用中的策略(跑过迁移的真实环境,或并行跑的别的用例)⇒ 只能断言"一定会给条件"
			assert.ok(await dataScopeWhere(user, "demo_grid", "read"), "已启用 ⇒ 必须给出条件(哪怕恒假)");
		}
	});

	it("角色规则 `role:<code> → *` ⇒ 这个角色的人不受限制", async () => {
		const f = await fixture("角色规则");
		const role = await makeRole("区级");
		const user = await makeUser("区里的人");
		await assign(user, role.roleId);
		await putPolicy(`role:${role.code}`, "*");

		const seen = await gridsVisibleTo(user, "角色规则");
		assert.deepEqual(seen.mine, [f.gridA1, f.gridA2, f.gridB1].sort(), "自己的三条都在(没被过滤)");
		assert.ok(seen.total >= 3, "整表可见 ⇒ 只看得到我这套是过滤没生效的反面证据");
	});

	it("部门规则:写父节点,子树里的人照样命中 —— 也正因为这样,它区分不了同部门的两个人", async () => {
		const f = await fixture("部门规则");
		const role = await makeRole("占位角色");
		const alice = await makeUser("甲镇-A");
		const bob = await makeUser("甲镇-B");
		await put(alice, f.unitA);
		await put(bob, f.unitA);
		await assign(alice, role.roleId);
		await assign(bob, role.roleId);

		// 人挂在「甲镇网格组」,策略写的是它的父节点「甲镇」⇒ 靠**祖先匹配**命中
		await putPolicy(`dept:${f.townA}`, `demo_grid@org:${f.townA}`);

		const expected = [f.gridA1, f.gridA2].sort();
		assert.deepEqual((await gridsVisibleTo(alice, "部门规则")).mine, expected, "部门规则对子树里的人生效");
		assert.deepEqual((await gridsVisibleTo(bob, "部门规则")).mine, expected, "同部门的人看的一样 —— 所以迁移时没用部门主体(会把队员放大成整条街)");
	});

	it("按人授权:同部门的两个人各看各的(队长按组织、队员按行)", async () => {
		const f = await fixture("按人授权");
		const captain = await makeUser("队长");
		const member = await makeUser("队员");
		await put(captain, f.unitA);
		await put(member, f.unitA);

		await putPolicy(`user:${captain}`, `demo_grid@org:${f.unitA}`);
		await grantRow(member, "demo_grid", f.gridA1);

		assert.deepEqual((await gridsVisibleTo(captain, "按人授权")).mine, [f.gridA1, f.gridA2].sort(), "队长看本单元全部");
		assert.deepEqual((await gridsVisibleTo(member, "按人授权")).mine, [f.gridA1], "队员只看自己那条 —— 不因为同部门而沾光");
	});

	it("认不出人 / 有策略但一条都没命中 ⇒ 恒假条件(0 行),不是「不过滤」", async () => {
		const f = await fixture("failclosed");
		const stranger = await makeUser("没被授权的人");
		await put(stranger, f.unitB);
		// 表里确实有启用规则(否则走的是"未启用 ⇒ 不过滤"那条路,测不到失败关闭)
		await putPolicy(`role:${(await makeRole("别人的角色")).code}`, "*");

		const seen = await gridsVisibleTo(stranger, "failclosed");
		assert.equal(seen.total, 0, "有策略却没一条命中 ⇒ 一行都不给(fail-open 就是漏洞)");
	});

	it("deny 一行:角色放开了全部,单独对某一行 deny ⇒ 只有那行看不见", async () => {
		const f = await fixture("deny");
		const role = await makeRole("区级two");
		const user = await makeUser("区里的人two");
		await assign(user, role.roleId);
		await putPolicy(`role:${role.code}`, "*");
		assert.ok((await gridsVisibleTo(user, "deny")).total > 0, "先确认确实放开了");

		await putPolicy(`user:${user}`, `demo_grid@${f.gridB1}`, "*", "deny");
		const seen = await gridsVisibleTo(user, "deny");
		assert.equal(seen.mine.includes(f.gridB1), false, "被 deny 的那行看不见");
		assert.equal(seen.mine.includes(f.gridA1), true, "别的行照常");
	});

	it("同一个人的「允许这个组织 + 拒绝其中一行」也必须做减法,不许把自己的整类 allow 一起否决", async () => {
		// 踩过:`[policy_effect]` 的 `!some(deny)` 是在 matcher 筛出来的集合上算的,而行级 deny 与
		// 「这一类能不能读」的请求也算相交 ⇒ 一条行级 deny 会把同一个人的整类 allow 一起否掉,变成一条都看不见
		const f = await fixture("自减");
		const user = await makeUser("自减-甲");
		await put(user, f.unitA);
		await putPolicy(`user:${user}`, `demo_grid@org:${f.unitA}`, "*");
		const before = (await gridsVisibleTo(user, "自减")).mine;
		assert.equal(before.includes(f.gridA1), true, "先确认整片组织都看得见");

		await putPolicy(`user:${user}`, `demo_grid@${f.gridA1}`, "*", "deny");
		const after = (await gridsVisibleTo(user, "自减")).mine;
		assert.equal(after.includes(f.gridA1), false, "被 deny 的那一行看不见");
		assert.equal(after.length, before.length - 1, "只少这一行,别的照常");
	});

	it("同一个人的「允许这个组织 + 拒绝整个类型」仍然是一票否决(减法只在行/组织级)", async () => {
		const f = await fixture("自减类");
		const user = await makeUser("自减类-甲");
		await put(user, f.unitA);
		await putPolicy(`user:${user}`, `demo_grid@org:${f.unitA}`, "*");
		assert.ok((await gridsVisibleTo(user, "自减类")).mine.length > 0, "先确认有可见行");

		await putPolicy(`user:${user}`, "demo_grid", "*", "deny");
		assert.equal((await gridsVisibleTo(user, "自减类")).mine.length, 0, "整类 deny ⇒ 一条也看不见");
	});

	it("deny 一个组织:减掉它的子树,「还没归属」的行不许被顺手排掉(NULL 的三值逻辑)", async () => {
		const f = await fixture("denyorg");
		const role = await makeRole("区级three");
		const user = await makeUser("区里的人three");
		await assign(user, role.roleId);

		// 还没归属的网格(group_id 为空)—— 不受限的规则下它也该看得见,不能因为 `not in` 遇上 NULL 被排掉
		const orphanId = id("g", "denyorg-未归属");
		gridIds.push(orphanId);
		await db
			.insert(sysDemoGrid)
			.values({ id: orphanId, name: `${TEST_PREFIX}denyorg-未归属`, town_name: "测试街镇", town_id: f.unitA, group_id: null, create_time: new Date(), update_time: new Date() });

		await putPolicy(`role:${role.code}`, "*");
		const before = (await gridsVisibleTo(user, "denyorg")).mine;
		assert.deepEqual(before, [f.gridA1, f.gridA2, f.gridB1, orphanId].sort(), "先确认四行都看得到");

		await putPolicy(`user:${user}`, `demo_grid@org:${f.unitA}`, "*", "deny");
		const after = (await gridsVisibleTo(user, "denyorg")).mine;
		assert.deepEqual(after, [f.gridB1, orphanId].sort(), "甲镇网格组那两行被减掉;乙镇与未归属的照常");
	});

	it("动作:`write` 不放开 `read`,而 `*` 两个动作都算", async () => {
		const f = await fixture("动作");
		const user = await makeUser("只写不读");
		await putPolicy(`user:${user}`, `demo_grid@${f.gridA1}`, "write");
		assert.deepEqual((await gridsVisibleTo(user, "动作", "read")).mine, [], "write 规则不覆盖 read");
		assert.deepEqual((await gridsVisibleTo(user, "动作", "write")).mine, [f.gridA1], "write 只给写");

		await putPolicy(`user:${user}`, `demo_grid@${f.gridA2}`);
		assert.deepEqual((await gridsVisibleTo(user, "动作", "read")).mine, [f.gridA2], "`*` 覆盖 read");
	});

	it("grantRow / revokeRow 立即生效 —— 30 秒缓存必须被主动清掉", async () => {
		const f = await fixture("缓存");
		const user = await makeUser("被指派的人");
		// 先让表里存在启用中的规则,保证走的是"已启用"这条路
		await putPolicy(`role:${(await makeRole("先把表启用")).code}`, "sys_user");

		assert.deepEqual((await gridsVisibleTo(user, "缓存")).mine, [], "还没授权 ⇒ 空");
		await grantRow(user, "demo_grid", f.gridA1);
		assert.deepEqual((await gridsVisibleTo(user, "缓存")).mine, [f.gridA1], "指派后立刻看得见,不能等缓存过期");

		const again = await grantRow(user, "demo_grid", f.gridA1);
		assert.equal(again, undefined, "重复授权幂等(唯一键 v0,v1,v2 不该被撞)");
		assert.deepEqual((await gridsVisibleTo(user, "缓存")).mine, [f.gridA1], "重复授权后还是一行");

		await revokeRow(user, "demo_grid", f.gridA1);
		assert.deepEqual((await gridsVisibleTo(user, "缓存")).mine, [], "撤销后立刻看不见");
	});
});

/**
 * **场景矩阵**:主体 4 种写法 × 资源 4 种写法 × 动作 × 效果,以及"多个主体 / 多条规则同时命中"的合并口径。
 *
 * ⚠️ 写这些用例时的两条纪律(踩过才总结出来的):
 *  1. **主体宽(`*` / `dept:`)的行,资源必须窄**(窄到本文件自己的 tag);
 *     主体窄的行才可以给宽资源 —— 否则会给**并行跑的其它测试文件**的用户多授权,
 *     把别人"只看到这两条"的断言击穿(策略表是全库共享的,policies 没有隔离)。
 *  2. 主体是 `*` / `dept:` 的行必须走本文件的 `putPolicy`(带 id),否则 `after` 清不掉。
 */
describe("主体 × 资源 × 动作 × 效果:场景矩阵", () => {
	it("主体 `*`:谁都被它命中;但资源该多窄就多窄 —— `*` 主体不等于全都放开", async () => {
		const f = await fixture("全局主体");
		const 乙 = await makeUser("全局主体-乙");
		const 甲 = await makeUser("全局主体-甲");
		const 丙 = await makeUser("全局主体-丙");
		await put(甲, f.unitA);
		await put(乙, f.unitB);
		await put(丙, f.unitA);
		await putPolicy("*", `sys_user@${乙}`, "*", "allow");
		// 主体是 `*`(人人命中),资源只给了"乙这一个用户行" ⇒ 甲、丙也都只看到乙这一条
		assert.deepEqual((await usersVisibleTo(甲, "全局主体")).mine, [乙]);
		assert.deepEqual((await usersVisibleTo(丙, "全局主体")).mine, [乙]);
	});

	it("资源 `*`:给某个人的规则写 `*` ⇒ 注册表里**每个**资源类型都放开(网格 + 用户)", async () => {
		const f = await fixture("全局资源");
		const 我 = await makeUser("全局资源-我");
		const 别人 = await makeUser("全局资源-别人");
		await put(别人, f.unitB);
		await putPolicy(`user:${我}`, "*", "*", "allow");
		assert.deepEqual((await gridsVisibleTo(我, "全局资源")).mine, [f.gridA1, f.gridA2, f.gridB1].sort());
		assert.deepEqual((await usersVisibleTo(我, "全局资源")).mine, [我, 别人].sort());
	});

	it("主体 `role:<code>`:启用才生效;角色一停用,策略行还在也立刻不生效", async () => {
		const f = await fixture("角色主体");
		const 启用角色 = await makeRole("启用角色", 1);
		const 停用角色 = await makeRole("停用角色", 0);
		const 甲 = await makeUser("角色主体-甲");
		const 乙 = await makeUser("角色主体-乙");
		await assign(甲, 启用角色.roleId);
		await assign(乙, 停用角色.roleId);
		await putPolicy(`role:${启用角色.code}`, `demo_grid@org:${f.unitA}`, "*", "allow");
		await putPolicy(`role:${停用角色.code}`, `demo_grid@org:${f.unitB}`, "*", "allow");
		assert.deepEqual((await gridsVisibleTo(甲, "角色主体")).mine, [f.gridA1, f.gridA2].sort(), "启用角色的规则生效");
		assert.equal((await gridsVisibleTo(乙, "角色主体")).total, 0, "停用角色 ⇒ 认不出主体 ⇒ 恒假(引擎只装 status=1 的行)");
	});

	it("主体 `dept:<节点>`:规则打在上层节点,挂在子树里的人命中;不在那棵子树里的不命中", async () => {
		const f = await fixture("部门主体");
		const 甲 = await makeUser("部门主体-甲");
		const 乙 = await makeUser("部门主体-乙");
		await put(甲, f.unitA);
		await put(乙, f.townB);
		await putPolicy(`dept:${f.townA}`, `demo_grid@org:${f.unitA}`, "*", "allow");
		assert.deepEqual((await gridsVisibleTo(甲, "部门主体")).mine, [f.gridA1, f.gridA2].sort(), "他在甲镇网格组 ⇒ 祖先 `甲镇` 的规则命中他");
		assert.equal((await gridsVisibleTo(乙, "部门主体")).total, 0, "他在乙镇 ⇒ 一条规则都没命中 ⇒ 恒假");
	});

	it("资源 `sys_user`(没有组织列 ⇒ 多对多子查询那条分支):@行 只给一行、@org: 命中子树、deny 组织走子查询排除", async () => {
		const f = await fixture("用户表");
		const 我 = await makeUser("用户表-看的人");
		const 甲 = await makeUser("用户表-甲");
		const 乙 = await makeUser("用户表-乙");
		const 丙 = await makeUser("用户表-丙");
		await put(甲, f.unitA);
		await put(乙, f.unitB);
		await put(丙, f.unitA);
		await putPolicy(`user:${我}`, `sys_user@${乙}`, "*", "allow");
		assert.deepEqual((await usersVisibleTo(我, "用户表")).mine, [乙], "@行:只给那一行");
		await putPolicy(`user:${我}`, `sys_user@org:${f.townA}`, "*", "allow");
		assert.deepEqual((await usersVisibleTo(我, "用户表")).mine, [甲, 乙, 丙].sort(), "@org: 与 @行 取并集(甲单元两个 + 乙那一行)");
		await putPolicy(`user:${我}`, `sys_user@org:${f.unitA}`, "*", "deny");
		assert.deepEqual((await usersVisibleTo(我, "用户表")).mine, [乙], "deny 组织:减掉甲单元那两个人,单独给的那一行留着");
	});

	it("多主体取并集:角色规则 + 部门规则 + 按人规则同时命中 ⇒ 合起来(不是取交集)", async () => {
		const f = await fixture("并集");
		const role = await makeRole("并集角色");
		const 我 = await makeUser("并集-甲");
		await assign(我, role.roleId);
		await put(我, f.unitA);
		await putPolicy(`role:${role.code}`, `demo_grid@${f.gridB1}`, "*", "allow"); // 角色:乙镇那一条
		await putPolicy(`dept:${f.unitA}`, `demo_grid@org:${f.unitA}`, "*", "allow"); // 部门:本单元
		await putPolicy(`user:${我}`, `demo_grid@${f.gridA2}`, "*", "allow"); // 按人:其中一条
		assert.deepEqual((await gridsVisibleTo(我, "并集")).mine, [f.gridA1, f.gridA2, f.gridB1].sort());
	});

	it("借调 = 给他再加一条组织规则:多看一个单元,而 `sys_user_dept`(编制)一个字节都不动", async () => {
		const f = await fixture("借调");
		const 我 = await makeUser("借调-甲");
		await put(我, f.unitA);
		await grantOrg(我, "demo_grid", f.unitA);
		assert.deepEqual((await gridsVisibleTo(我, "借调")).mine, [f.gridA1, f.gridA2].sort(), "本体单元");
		await grantOrg(我, "demo_grid", f.unitB);
		assert.deepEqual((await gridsVisibleTo(我, "借调")).mine, [f.gridA1, f.gridA2, f.gridB1].sort(), "借调后两个单元都看得见");
		const memberships = await db.select({ id: sysUserDept.id }).from(sysUserDept).where(eq(sysUserDept.user_id, 我));
		assert.equal(memberships.length, 1, "借调只加策略行,不动编制");
	});

	it("脏数据只会少授权:非法主体 / 非法资源 / status=0 的行一律不装载(告警),一条都没命中就恒假", async () => {
		const f = await fixture("脏数据");
		const 我 = await makeUser("脏数据-甲");
		await putPolicy("没有冒号的主体", `demo_grid@org:${f.unitA}`, "*", "allow");
		await putPolicy(`user:${我}`, "demo_grid@org:", "*", "allow");
		await putPolicy(`user:${我}`, `demo_grid@org:${f.unitA}`, "*", "allow", 0);
		const visible = await gridsVisibleTo(我, "脏数据");
		assert.deepEqual(visible.mine, []);
		assert.equal(visible.total, 0);
	});

	it("`ensureRule`(基线种子的底座)只补不覆盖:第二次不写、被手工改成 deny 的行不许被改回 allow", async () => {
		const f = await fixture("只补不覆盖");
		const 我 = await makeUser("只补不覆盖-甲");
		const sub = `user:${我}`;
		const obj = `demo_grid@org:${f.unitA}`;
		const where = and(eq(sysDataPolicy.v0, sub), eq(sysDataPolicy.v1, obj));
		assert.equal(await ensureRule(sub, obj, "*", "基线测试"), true, "第一次:补进去");
		policyIds.push(...(await db.select({ id: sysDataPolicy.id }).from(sysDataPolicy).where(eq(sysDataPolicy.v0, sub))).map((row) => row.id));
		assert.equal(await ensureRule(sub, obj, "*", "基线测试"), false, "第二次:已经有了,不写");
		assert.equal((await db.select({ id: sysDataPolicy.id }).from(sysDataPolicy).where(where)).length, 1, "还是一条");
		await db.update(sysDataPolicy).set({ v3: "deny", remark: "手工改成拒绝" }).where(where);
		clearDataPolicyCache();
		assert.equal(await ensureRule(sub, obj, "*", "基线测试"), false, "已有(而且是 deny)⇒ 不覆盖");
		const [row] = await db.select({ v3: sysDataPolicy.v3, remark: sysDataPolicy.remark }).from(sysDataPolicy).where(where);
		assert.equal(row?.v3, "deny");
		assert.equal(row?.remark, "手工改成拒绝");
	});
});

/**
 * 「系统设置 ▸ 数据权限」页背后的三个接口。
 *
 * 与上面两组的分工:上面测的是**引擎**(判定与编译),这里测的是**管理入口** ——
 * 界面上能做的事(批量登记 / 改效果 / 删除 / 试算)必须与引擎一模一样,否则运维在界面上看到的,
 * 和列表页真实返回的会是两回事。解释器给的所有条数都是**实测**(与 `dataScopeWhere` 同一条编译路径)。
 */
describe("数据权限管理接口", () => {
	/** 取某个资源类型的结论(找不到直接断言失败,免得后面 `.xxx` 炸在 undefined 上) */
	function pick(explain: PolicyExplain, resourceType: string) {
		const found = explain.resources.find((item) => item.resourceType === resourceType);
		assert.ok(found, `解释器应给出 ${resourceType} 的结论`);
		return found;
	}

	/**
	 * 只落**一条**规则时的小工具。
	 *
	 * 新增接口的入参是"多张资源卡",而下面绝大多数用例只想落一条 —— 每处都手写
	 * `resources: [{ … }]` 这层包装只是把同一个形状抄十几遍,抄错了还难看出来。
	 */
	function createOne(block: {
		subKind: PolicySubjectKind;
		subjectIds: string[];
		resourceType: string | null;
		scopeKind: PolicyScopeKind;
		scopeIds?: string[];
		action?: PolicyAction;
		effect?: PolicyEffect;
		remark?: string;
	}) {
		return caller.policy.create({
			subKind: block.subKind,
			subjectIds: block.subjectIds,
			resources: [
				{
					resourceType: block.resourceType,
					scopeKind: block.scopeKind,
					scopeIds: block.scopeIds ?? [],
					action: block.action ?? "*",
					effect: block.effect ?? "allow",
				},
			],
			remark: block.remark ?? null,
		});
	}

	it("create:主体 × 范围 = 叉积批量;第二次只报已存在,手工改过的一律不许被改回", async () => {
		const f = await fixture("接口-批量");
		const 甲 = await makeUser("接口-批量-甲");
		const 乙 = await makeUser("接口-批量-乙");
		const input = {
			subKind: "user" as const,
			subjectIds: [甲, 乙],
			resourceType: "demo_grid",
			scopeKind: "org" as const,
			scopeIds: [f.unitA, f.unitB],
			action: "read" as const,
			effect: "allow" as const,
			remark: "测试:批量登记",
		};
		assert.deepEqual(await createOne(input), { created: 4, existed: 0 }, "2 人 × 2 组织 = 4 条");
		assert.deepEqual(await createOne(input), { created: 0, existed: 4 }, "再点一次不重复写");

		const where = and(eq(sysDataPolicy.v0, `user:${甲}`), eq(sysDataPolicy.v1, `demo_grid@org:${f.unitA}`));
		await db.update(sysDataPolicy).set({ v3: "deny", remark: "手工改成拒绝" }).where(where);
		clearDataPolicyCache();
		assert.deepEqual(await createOne(input), { created: 0, existed: 4 }, "已存在的一律不动");
		const [row] = await db.select({ v3: sysDataPolicy.v3, remark: sysDataPolicy.remark }).from(sysDataPolicy).where(where);
		assert.equal(row?.v3, "deny");
		assert.equal(row?.remark, "手工改成拒绝");
	});

	it("create:一次点出来的行数有上限(200),超过直接拒", async () => {
		await assert.rejects(
			createOne({
				subKind: "user",
				subjectIds: Array.from({ length: 5 }, (_, i) => `${TEST_PREFIX}批量-${i}`),
				resourceType: "demo_grid",
				scopeKind: "org",
				scopeIds: Array.from({ length: 50 }, (_, i) => `${TEST_PREFIX}组织-${i}`),
				action: "*",
			}),
			(error: { code?: string; message?: string }) => {
				assert.equal(error.code, "BAD_REQUEST");
				assert.match(String(error.message), /200/);
				return true;
			},
		);
	});

	it("create:未登记的资源类型挡在接口层(写进去只会被引擎当非法行跳过)", async () => {
		await assert.rejects(
			createOne({
				subKind: "user",
				subjectIds: [`${TEST_PREFIX}没人`],
				resourceType: "sys_log",
				scopeKind: "type",
				action: "*",
			}),
			(error: { code?: string }) => {
				assert.equal(error.code, "BAD_REQUEST");
				return true;
			},
		);
	});

	it("explain:先说清失败关闭,再算准「组织及以下 - 拒绝行」,数字与引擎查出来的一致", async () => {
		const f = await fixture("接口-试算");
		const 我 = await makeUser("接口-试算-甲");
		await put(我, f.unitA);

		const 空 = await caller.policy.explain({ userId: 我 });
		assert.equal(空.configured, true, "库里本来就有基线策略 ⇒ 数据权限是启用状态");
		assert.equal(
			空.rules.some((rule) => rule.sub === `user:${我}`),
			false,
			"没有任何一条规则是专门给这个人的",
		);

		assert.equal(pick(空, "demo_grid").allowed, false);
		assert.equal(pick(空, "demo_grid").visibleCount, 0, "一条都没命中 ⇒ 失败关闭(1 = 0)");
		assert.ok(
			空.subjects.some((subject) => subject.raw === `user:${我}`),
			"主体集合里有他自己",
		);

		await createOne({
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "org",
			scopeIds: [f.unitA],
			action: "*",
			remark: "测试:按组织",
		});
		const 有网格 = pick(await caller.policy.explain({ userId: 我 }), "demo_grid");
		assert.equal(有网格.allowed, true);
		assert.equal(有网格.unrestricted, false);
		assert.deepEqual(
			有网格.orgs.map((item) => item.id),
			[f.unitA],
		);
		assert.equal(有网格.visibleCount, 2, "甲镇网格组下的两条测试网格");
		assert.equal(有网格.visibleCount, (await gridsVisibleTo(我, "接口-试算")).total, "解释器与引擎同一条编译路径");

		await createOne({
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "row",
			scopeIds: [f.gridA1],
			action: "*",
			effect: "deny",
			remark: "测试:拒绝一行",
		});
		const 减网格 = pick(await caller.policy.explain({ userId: 我 }), "demo_grid");
		assert.deepEqual(
			减网格.denyRows.map((item) => item.id),
			[f.gridA1],
		);
		assert.equal(减网格.visibleCount, 1, "组织范围 2 条 - 拒绝 1 条");
		assert.equal(减网格.denied, false, "还有可见行 ⇒ 不是整表被拒");
		assert.equal(减网格.visibleCount, (await gridsVisibleTo(我, "接口-试算")).total);
	});

	it("list:每一行都翻成人话(主体名 / 资源类型名 / 范围名),原始串留在行上给排障用", async () => {
		const f = await fixture("接口-清单");
		const 我 = await makeUser("接口-清单-甲");
		await createOne({
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "org",
			scopeIds: [f.unitA],
			action: "read",
			remark: "测试:清单",
		});
		const mine = (await caller.policy.list()).filter((row) => row.subjectRaw === `user:${我}`);
		assert.equal(mine.length, 1);
		const 行 = mine[0];
		assert.ok(行);
		assert.equal(行.subjectKind, "user");
		assert.equal(行.subjectLabel, `${TEST_PREFIX}接口-清单-甲`, "主体名 = 用户姓名");
		assert.equal(行.resourceKind, "org");
		assert.equal(行.resourceType, "demo_grid");
		assert.equal(行.resourceTypeLabel, POLICY_RESOURCES.demo_grid.label);
		assert.equal(行.resourceDetail, `${TEST_PREFIX}接口-清单-甲镇网格组`, "范围名 = 部门名");
		assert.equal(行.resourceRaw, `demo_grid@org:${f.unitA}`, "原始串照留(拿去写 SQL / 发工单)");
		assert.equal(行.action, "read");
		assert.equal(行.effect, "allow");
		assert.equal(行.status, 1);
		assert.equal(行.remark, "测试:清单");
	});

	it("update / remove:改效果即时生效,删掉之后立刻回落到失败关闭", async () => {
		const f = await fixture("接口-改删");
		const 我 = await makeUser("接口-改删-甲");
		await createOne({
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "org",
			scopeIds: [f.unitA],
			action: "*",
			remark: "测试:改删",
		});
		const 行 = (await caller.policy.list()).find((row) => row.subjectRaw === `user:${我}`);
		assert.ok(行);
		assert.equal(pick(await caller.policy.explain({ userId: 我 }), "demo_grid").visibleCount, 2);

		await caller.policy.update({
			id: 行.id,
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "org",
			scopeIds: [f.unitA],
			action: "*",
			effect: "deny",
			status: 1,
			remark: "改成拒绝",
		});
		const 拒 = pick(await caller.policy.explain({ userId: 我 }), "demo_grid");
		assert.equal(拒.allowed, false, "只剩 deny ⇒ 没有任何允许,一条也看不到");
		assert.equal(拒.visibleCount, 0);

		assert.deepEqual(await caller.policy.remove({ ids: [行.id] }), { removed: 1 });
		assert.equal(
			(await caller.policy.list()).some((row) => row.id === 行.id),
			false,
			"清单里没有了",
		);
		assert.equal(pick(await caller.policy.explain({ userId: 我 }), "demo_grid").visibleCount, 0);
	});

	it("update:改唯一键 = 把这行规则搬到新键上,撞了已有键必须报冲突", async () => {
		const f = await fixture("接口-改键");
		const 甲 = await makeUser("接口-改键-甲");
		const 乙 = await makeUser("接口-改键-乙");
		const base = {
			subKind: "user" as const,
			resourceType: "demo_grid",
			scopeKind: "org" as const,
			scopeIds: [f.unitA],
			action: "*" as const,
			effect: "allow" as const,
			status: 1,
			remark: "测试:改键",
		};
		await createOne({ ...base, subjectIds: [甲] });
		await createOne({ ...base, subjectIds: [乙] });
		const 甲行 = (await caller.policy.list()).find((row) => row.subjectRaw === `user:${甲}`);
		assert.ok(甲行);
		assert.equal(pick(await caller.policy.explain({ userId: 甲 }), "demo_grid").visibleCount, 2);

		// 搬到"乙"(已存在同样的键)⇒ 明确报冲突,而不是静默合并成一条
		await assert.rejects(
			caller.policy.update({ ...base, id: 甲行.id, subjectIds: [乙] }),
			(error: { code?: string }) => {
				assert.equal(error.code, "CONFLICT");
				return true;
			},
		);
		assert.equal(
			(await caller.policy.list()).find((row) => row.id === 甲行.id)?.subjectRaw,
			`user:${甲}`,
			"冲突时原行一动不动",
		);

		// 搬到"还没人用"的新主体 ⇒ 成功:甲立刻看不到,新主体看得到
		const 丙 = await makeUser("接口-改键-丙");
		const moved = await caller.policy.update({ ...base, id: 甲行.id, subjectIds: [丙] });
		assert.equal(moved.moved, true);
		assert.equal(pick(await caller.policy.explain({ userId: 甲 }), "demo_grid").visibleCount, 0);
		assert.equal(pick(await caller.policy.explain({ userId: 丙 }), "demo_grid").visibleCount, 2);
	});

	it("explain:用户不存在时给 NOT_FOUND,不是一份空结论", async () => {
		await assert.rejects(
			caller.policy.explain({ userId: `${TEST_PREFIX}不存在的人` }),
			(error: { code?: string }) => {
				assert.equal(error.code, "NOT_FOUND");
				return true;
			},
		);
	});

	it("create:一个主体一次配多类资源(整类 / 某组织 / 某一行各一张卡)⇒ 一次调用全部落成", async () => {
		const f = await fixture("接口-多卡");
		const 我 = await makeUser("接口-多卡-甲");
		await put(我, f.unitA);
		const input = {
			subKind: "user" as const,
			subjectIds: [我],
			resources: [
				{ resourceType: "demo_grid", scopeKind: "type" as const, scopeIds: [], action: "read" as const, effect: "allow" as const },
				{ resourceType: "demo_grid", scopeKind: "org" as const, scopeIds: [f.unitB], action: "*" as const, effect: "allow" as const },
				{ resourceType: "sys_user", scopeKind: "row" as const, scopeIds: [我], action: "*" as const, effect: "allow" as const },
			],
			remark: "测试:多卡",
		};
		assert.deepEqual(await caller.policy.create(input), { created: 3, existed: 0 }, "三张卡 = 三条规则,一次调用落完");
		assert.deepEqual(await caller.policy.create(input), { created: 0, existed: 3 }, "同样的三张卡再存一次 = 空操作");

		const 我的 = (await caller.policy.list()).filter((row) => row.subjectRaw === `user:${我}`);
		assert.deepEqual(
			我的.map((row) => row.resourceRaw).sort(),
			["demo_grid", `demo_grid@org:${f.unitB}`, `sys_user@${我}`].sort(),
			"三条规则分别是:整类 / 按组织 / 按行",
		);
		const 结论 = pick(await caller.policy.explain({ userId: 我 }), "demo_grid");
		assert.equal(结论.unrestricted, true, "整类可读 ⇒ 网格这边不受限");
		assert.equal(结论.visibleCount, 结论.totalCount);
	});

	it("create:一批里有一行不合法 ⇒ 整批一条都不写(不是写一半再说)", async () => {
		const f = await fixture("接口-坏批");
		const 我 = await makeUser("接口-坏批-甲");
		await assert.rejects(
			caller.policy.create({
				subKind: "user",
				subjectIds: [我],
				resources: [
					{ resourceType: "demo_grid", scopeKind: "org", scopeIds: [f.unitA], action: "*", effect: "allow" },
					// 组织 id 里带冒号:解析器认不出来,写进去这份授权会静默失效 —— 必须在接口层拦住
					{ resourceType: "demo_grid", scopeKind: "org", scopeIds: [`${TEST_PREFIX}坏:组织`], action: "*", effect: "allow" },
				],
				remark: "测试:坏批",
			}),
			(error: { code?: string; message?: string }) => {
				assert.equal(error.code, "BAD_REQUEST");
				assert.match(String(error.message), /第 2 行资源不合法/);
				return true;
			},
		);
		assert.equal(
			(await caller.policy.list()).some((row) => row.subjectRaw === `user:${我}`),
			false,
			"第 1 行本来合法,但整批被拒 ⇒ 它也不许落库",
		);

		// 同一个主体 + 资源 + 动作要两个效果:引擎里它只有一个 eft 字段,所以也是整批拒
		await assert.rejects(
			caller.policy.create({
				subKind: "user",
				subjectIds: [我],
				resources: [
					{ resourceType: "demo_grid", scopeKind: "org", scopeIds: [f.unitA], action: "*", effect: "allow" },
					{ resourceType: "demo_grid", scopeKind: "org", scopeIds: [f.unitA], action: "*", effect: "deny" },
				],
			}),
			(error: { code?: string; message?: string }) => {
				assert.equal(error.code, "BAD_REQUEST");
				assert.match(String(error.message), /只能有一个效果/);
				return true;
			},
		);
		assert.equal(
			(await caller.policy.list()).some((row) => row.subjectRaw === `user:${我}`),
			false,
			"坏输入一个字节都没写库",
		);
	});

	it("create:多主体 × 多行资源是叉积,总数超上限整批拒", async () => {
		await assert.rejects(
			caller.policy.create({
				subKind: "user",
				subjectIds: [`${TEST_PREFIX}叉积-甲`, `${TEST_PREFIX}叉积-乙`, `${TEST_PREFIX}叉积-丙`],
				resources: [
					{ resourceType: "demo_grid", scopeKind: "type", scopeIds: [], action: "*", effect: "allow" },
					{
						resourceType: "demo_grid",
						scopeKind: "org",
						scopeIds: Array.from({ length: 50 }, (_, i) => `${TEST_PREFIX}叉积组织-${i}`),
						action: "*",
						effect: "allow",
					},
					{
						resourceType: "demo_grid",
						scopeKind: "row",
						scopeIds: Array.from({ length: 20 }, (_, i) => `${TEST_PREFIX}叉积行-${i}`),
						action: "*",
						effect: "allow",
					},
				],
				remark: "测试:叉积",
			}),
			(error: { code?: string; message?: string }) => {
				assert.equal(error.code, "BAD_REQUEST");
				assert.match(String(error.message), /3 主体 × 1 \+ 50 \+ 20 资源 = 213 条/);
				return true;
			},
		);
		for (const 名 of ["甲", "乙", "丙"]) {
			assert.equal(
				(await caller.policy.list()).some((row) => row.subjectRaw === `user:${TEST_PREFIX}叉积-${名}`),
				false,
				`${名} 一条都不许落库`,
			);
		}
	});

	it("updateMany:一批里改动作,撞上已有键的那几行跳过并回报名单,其余照改", async () => {
		const f = await fixture("接口-批量改");
		const 我 = await makeUser("接口-批量改-甲");
		await put(我, f.unitA);
		await createOne({
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "org",
			scopeIds: [f.unitA],
			action: "read",
			remark: "测试:批量改·读",
		});
		await createOne({
			subKind: "user",
			subjectIds: [我],
			resourceType: "demo_grid",
			scopeKind: "org",
			scopeIds: [f.unitA],
			action: "write",
			remark: "测试:批量改·写",
		});
		const 我的 = (await caller.policy.list()).filter((row) => row.subjectRaw === `user:${我}`);
		const 读行 = 我的.find((row) => row.action === "read");
		const 写行 = 我的.find((row) => row.action === "write");
		assert.ok(读行 && 写行, "两行都已落库");

		// 两行一起改成 `*`:第一行先占住新键,第二行就撞上了 —— 按传入顺序逐行判断
		const 结果 = await caller.policy.updateMany({
			ids: [读行.id, 写行.id, `${TEST_PREFIX}不存在的行`],
			action: "*",
		});
		assert.equal(结果.updated, 1, "第一行改成了 `*`");
		assert.deepEqual(结果.conflicts, [写行.id], "第二行的目标键已被第一行占住 ⇒ 跳过并回报");
		assert.equal(结果.skipped, 1, "不存在的 id 只算跳过");

		const 之后 = (await caller.policy.list()).filter((row) => row.subjectRaw === `user:${我}`);
		assert.deepEqual(
			之后.map((row) => [row.action, row.effect]).sort(),
			[
				["*", "allow"],
				["write", "allow"],
			].sort(),
			"冲突的那行原地不动(动作还是 write)",
		);
		assert.equal(之后.find((row) => row.action === "write")?.remark, "测试:批量改·写", "批量改标量不碰说明");
	});
});


