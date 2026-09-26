import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysDemoGrid, sysDept, sysRole, sysUser, sysUserDept, sysUserRole } from "../src/db/data-base-schema.ts";
import { createCallerFactory } from "../src/integrations/trpc/init.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { deptCondition, scopeOf } from "../src/lib/data-scope.ts";
import { parseScope, widestScope } from "../src/lib/data-scope-spec.ts";
import { collectDescendantIds } from "../src/lib/tree.ts";
import { TEST_PREFIX, closeDb, uniqueSuffix } from "./helpers.ts";

/**
 * 行级数据权限。
 *
 * 核心那条(用真实数据跑):**一条 `dept_below` 角色发发给 3 个「管理单元」的人** ——
 * 三个人共用同一条角色定义,各自只看到本单元的人(不用给每个街镇各建一个角色)。
 * 口径:人挂在哪个节点,就看那个节点及其子树 —— 所以**数据的「归属组织」列必须指向同一类节点**。
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
	it("parseScope:只认四档,非法(含已下线的 up:N)⇒ null(fail-closed 的入口)", () => {
		for (const ok of ["all", "self", "dept", "dept_below"]) {
			assert.equal(parseScope(ok), ok, `${ok} 应当合法`);
		}
		for (const bad of ["", "ALL", "up:1", "up:12", "up:", "up:abc", "dept_up", "custom", "up:1;drop"]) {
			assert.equal(parseScope(bad), null, `${bad} 应当被拒`);
		}
	});

	it("widestScope:多角色取最宽;一个都没配 ⇒ all(不收窄,与既有口径一致)", () => {
		assert.equal(widestScope(["self", "dept"]), "dept");
		assert.equal(widestScope(["dept", "dept_below"]), "dept_below");
		assert.equal(widestScope(["dept_below", "all"]), "all");
		assert.equal(widestScope([]), "all", "没配角色 ⇒ 不收窄");
		assert.equal(widestScope(["up:1"]), "all", "已下线的旧档位等同非法 ⇒ 不收窄");
		assert.equal(widestScope(["乱写的东西"]), "all", "非法值 ⇒ 也不收窄");
	});

	it("collectDescendantIds:子树含自己,环状脏数据不炸", () => {
		const rows = [
			{ id: "区", parentId: null },
			{ id: "甲镇", parentId: "区" },
			{ id: "甲-1", parentId: "甲镇" },
			{ id: "甲-2", parentId: "甲镇" },
			{ id: "乙镇", parentId: "区" },
		];
		assert.deepEqual(collectDescendantIds(rows, ["甲镇"]).sort(), ["甲-1", "甲-2", "甲镇"]);
		const cyc = [
			{ id: "x", parentId: "y" },
			{ id: "y", parentId: "x" },
		];
		assert.deepEqual(collectDescendantIds(cyc, ["x"]).sort(), ["x", "y"]);
	});
});

describe("数据范围落到真实数据上", () => {
	it("一条「本部门及以下(dept_below)」的角色发给 3 个单元的人,各看各的", async () => {
		const district = await makeDept("区", null);
		const towns = ["甲镇", "乙镇", "丙镇"];
		const unitIds: string[] = [];
		const unitUserIds: string[] = [];
		for (const town of towns) {
			const townId = await makeDept(town, district);
			const unitId = await makeDept(`${town}-网格组`, townId);
			const user = await makeUser(`${town}-队长`);
			await put(user, unitId);
			unitIds.push(unitId);
			unitUserIds.push(user);
		}
		// **同一条角色**发给三个人
		const role = await makeRole("网格长", "dept_below");
		for (const user of unitUserIds) await assign(user, role);

		// ① 每个人的范围 = 他自己那个单元及以下(不是别人的)
		for (let i = 0; i < towns.length; i += 1) {
			const { departmentIds } = await scopeOf(unitUserIds[i] as string);
			assert.ok(departmentIds.includes(unitIds[i] as string), `${towns[i]} 的人应当能看到本单元`);
			for (let j = 0; j < towns.length; j += 1) {
				if (i === j) continue;
				assert.equal(departmentIds.includes(unitIds[j] as string), false, `${towns[i]} 的人不该看到 ${towns[j]}`);
			}
		}

		// ② 落点也生效:user.list 只回同单元的人
		const mate = await makeUser("甲镇-队员");
		await put(mate, unitIds[0] as string);
		const visible = await callerFor(unitUserIds[0] as string).user.list();
		const names = visible.map((row) => row.name);
		assert.ok(names.includes(`${towns[0]}-队长`), "应当看到同单元的人(含自己)");
		assert.ok(names.includes("甲镇-队员"), "同单元的第二个人也在");
		assert.equal(names.includes(`${towns[1]}-队长`), false, "不该看到别的镇的人");
	});

	it("fail-closed:有 dept_below 角色却没有任何部门 ⇒ 空集合,条件**恒假**(不是不套条件)", async () => {
		const user = await makeUser("没部门的人");
		const role = await makeRole("没部门", "dept_below");
		await assign(user, role);
		const { scope, departmentIds } = await scopeOf(user);
		assert.equal(scope, "dept_below");
		assert.deepEqual(departmentIds, [], "没有部门 ⇒ 什么都不给");

		// 关键回归:空集合曾经返回 `undefined`(调用方不加条件 ⇒ 整表放行 = 越权),
		// 现在必须是恒假条件 —— 演示数据 71 行,这里必须一行都查不到。
		const leaked = await db.select().from(sysDemoGrid).where(deptCondition(sysDemoGrid.group_id, departmentIds));
		assert.equal(leaked.length, 0, "空集合必须查不到任何一行(fail-open 就是漏洞)");

		// 非法值**单独被忽略**,不会污染同一用户的合法角色
		const role2 = await makeRole("乱写", "custom");
		await assign(user, role2);
		assert.equal((await scopeOf(user)).scope, "dept_below", "非法的那条被忽略,合法的照常生效");
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
