import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysDept, sysRole, sysUser, sysUserDept, sysUserRole } from "../src/db/data-base-schema.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { scopeOf } from "../src/lib/data-scope.ts";
import { parseScope, widestScope } from "../src/lib/data-scope-spec.ts";
import { collectDescendantIds, findAncestorAtLevel } from "../src/lib/tree.ts";
import { TEST_PREFIX, closeDb, uniqueSuffix } from "./helpers.ts";

/**
 * 行级数据权限。
 *
 * 核心那条(用真实数据跑):**一条角色 `up:1`(往上到街镇)覆盖 3 个街镇** ——
 * 三个街镇的人共用同一条角色定义,各自只看到本街镇的人;
 * 这条直接证明"不用给 14 个街镇各建一个角色"。
 */
const S = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];

/** 造一个部门/用户:返回 id */
async function makeDept(name: string, parentId: string | null): Promise<string> {
	const id = `${TEST_PREFIX}${name}-${S}`;
	deptIds.push(id);
	await db.insert(sysDept).values({ id, parent_id: parentId, name, sort: 0, status: 1, create_time: new Date(), update_time: new Date() });
	return id;
}
async function makeUser(name: string): Promise<string> {
	const id = `${TEST_PREFIX}u-${name}-${S}`;
	userIds.push(id);
	await db.insert(sysUser).values({ id, name, email: `${id}@example.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
	return id;
}
async function makeRole(code: string, scope: string): Promise<string> {
	const id = `${TEST_PREFIX}r-${code}-${S}`;
	roleIds.push(id);
	await db.insert(sysRole).values({ id, code: `${TEST_PREFIX}${code}-${S}`, name: `${TEST_PREFIX}${code}`, sort: 0, status: 1, data_scope: scope, create_time: new Date(), update_time: new Date() });
	return id;
}
const put = async (userId: string, deptId: string) => {
	await db.insert(sysUserDept).values({ id: `${TEST_PREFIX}ud-${S}-${userId}-${deptId}`, user_id: userId, department_id: deptId });
};
const assign = async (userId: string, roleId: string) => {
	await db.insert(sysUserRole).values({ id: `${TEST_PREFIX}ur-${S}-${userId}-${roleId}`, user_id: userId, role_id: roleId });
};
const callerFor = (userId: string) => createCallerFactory(trpcRouter)({ user: { id: userId, name: "t", isSuper: true } });

after(async () => {
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
		// 从深到浅删(子在前)
		for (const id of [...deptIds].reverse()) await db.delete(sysDept).where(eq(sysDept.id, id));
	}
	await closeDb();
});

describe("数据范围的纯函数", () => {
	it("parseScope:只认五个形状,非法 ⇒ null(fail-closed 的入口)", () => {
		for (const ok of ["all", "self", "dept", "dept_below", "up:1", "up:12"]) {
			assert.equal(parseScope(ok), ok, `${ok} 应当合法`);
		}
		for (const bad of ["", "ALL", "up:", "up:abc", "dept_up", "custom", "up:1;drop"]) {
			assert.equal(parseScope(bad), null, `${bad} 应当被拒`);
		}
	});

	it("widestScope:多角色取最宽;一个都没配 ⇒ all(不收窄,与既有口径一致)", () => {
		assert.equal(widestScope(["self", "dept"]), "dept");
		assert.equal(widestScope(["dept", "up:1"]), "up:1");
		assert.equal(widestScope(["up:1", "dept_below"]), "dept_below");
		assert.equal(widestScope(["self", "all"]), "all");
		assert.equal(widestScope([]), "all", "没配角色 ⇒ 不收窄");
		assert.equal(widestScope(["乱写的东西"]), "all", "非法值 ⇒ 也不收窄");
	});

	it("collectDescendantIds / findAncestorAtLevel:子树与往上找层级", () => {
		const rows = [
			{ id: "区", parentId: null },
			{ id: "甲镇", parentId: "区" },
			{ id: "甲-1", parentId: "甲镇" },
			{ id: "甲-2", parentId: "甲镇" },
			{ id: "乙镇", parentId: "区" },
		];
		assert.deepEqual([...collectDescendantIds(rows, ["甲镇"])].sort(), ["甲-1", "甲-2", "甲镇"]);
		// 根是第 0 层:从"甲-1"往上找第 1 层 ⇒ 甲镇
		assert.equal(findAncestorAtLevel(rows, "甲-1", 1), "甲镇");
		assert.equal(findAncestorAtLevel(rows, "甲-1", 0), "区");
		// 自己在第 2 层,要到第 3 层 ⇒ 找不到(fail-closed)
		assert.equal(findAncestorAtLevel(rows, "甲-1", 3), null);
		// 环状脏数据不炸
		const cyc = [
			{ id: "x", parentId: "y" },
			{ id: "y", parentId: "x" },
		];
		assert.equal(findAncestorAtLevel(cyc, "x", 1), null);
		assert.deepEqual(collectDescendantIds(cyc, ["x"]).sort(), ["x", "y"]);
	});
});

describe("数据范围落到真实数据上", () => {
	it("一条「往上到街镇(up:1)」的角色,覆盖 3 个街镇且各看各的", async () => {
		const district = await makeDept("区", null);
		const towns = ["甲镇", "乙镇", "丙镇"];
		const townIds: string[] = [];
		const townUserIds: string[] = [];
		for (const town of towns) {
			const townId = await makeDept(town, district);
			const partId = await makeDept(`${town}-科室`, townId);
			const user = await makeUser(`${town}-的人`);
			await put(user, partId);
			townIds.push(townId);
			townUserIds.push(user);
		}
		// **同一条角色**发给三个人
		const role = await makeRole("网格长", "up:1");
		for (const user of townUserIds) await assign(user, role);

		// ① 每个人的范围 = 他自己的那个镇及以下(不是别人的)
		for (let i = 0; i < towns.length; i += 1) {
			const { departmentIds } = await scopeOf(townUserIds[i] as string);
			assert.ok(departmentIds.includes(townIds[i] as string), `${towns[i]} 的人应当能看到本镇`);
			for (let j = 0; j < towns.length; j += 1) {
				if (i === j) continue;
				assert.equal(departmentIds.includes(townIds[j] as string), false, `${towns[i]} 的人不该看到 ${towns[j]}`);
			}
		}

		// ② 落点也生效:user.list 只回本镇的人
		const visible = await callerFor(townUserIds[0] as string).user.list();
		const names = visible.map((row) => row.name);
		assert.ok(names.includes(`${towns[0]}-的人`), "应当看到本镇的人");
		assert.equal(names.includes(`${towns[1]}-的人`), false, "不该看到别的镇的人");
	});

	it("fail-closed:非法值 / 往上找不到层级 ⇒ 空集合", async () => {
		const district = await makeDept("区2", null);
		const part = await makeDept("区2-科室", district);
		const user = await makeUser("区里的人");
		await put(user, part);
		// 编制挂在第 1 层(科室),却要求"往上到第 1 层"?其实此处 part 是第 1 层 ⇒ 能找到;
		// 改用一个**比目标层更浅**的要求:往上到第 5 层 ⇒ 找不到
		const role = await makeRole("找不到", "up:5");
		await assign(user, role);
		const { departmentIds } = await scopeOf(user);
		assert.deepEqual(departmentIds, [], "往上找不到目标层级 ⇒ 什么都不给");

		// 非法值**单独被忽略**,不会污染同一用户的合法角色:
		// 这个用户同时有 up:5(合法)与 custom(非法)⇒ 生效的仍是 up:5
		const role2 = await makeRole("乱写", "custom");
		await assign(user, role2);
		const { scope } = await scopeOf(user);
		assert.equal(scope, "up:5", "非法的那条被忽略,合法的照常生效");
	});

	it("仅本人 / 本部门:两档的边界", async () => {
		const district = await makeDept("区3", null);
		const partA = await makeDept("区3-A", district);
		const partB = await makeDept("区3-B", district);
		const me = await makeUser("我");
		const mate = await makeUser("同部门");
		const other = await makeUser("别的部门");
		await put(me, partA);
		await put(mate, partA);
		await put(other, partB);

		const selfRole = await makeRole("仅本人", "self");
		await assign(me, selfRole);
		const selfVisible = await callerFor(me).user.list();
		assert.ok(selfVisible.some((row) => row.id === me), "自己要在里面");
		assert.equal(selfVisible.some((row) => row.id === mate), false, "仅本人不该看到同部门的人");

		// 再加一条"本部门"角色 ⇒ 取最宽 ⇒ 看到同部门,但仍看不到别的部门
		const deptRole = await makeRole("本部门", "dept");
		await assign(me, deptRole);
		const deptVisible = await callerFor(me).user.list();
		assert.ok(deptVisible.some((row) => row.id === mate), "本部门档应当看到同部门的人");
		assert.equal(deptVisible.some((row) => row.id === other), false, "但看不到别的部门");
	});

	it("scopeOf(null) ⇒ 不收窄(脚本 / 测试直调不误伤)", async () => {
		const resolved = await scopeOf(null);
		assert.equal(resolved.scope, "all");
		assert.deepEqual(resolved.departmentIds, []);
	});
});
