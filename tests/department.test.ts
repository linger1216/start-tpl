/**
 * 部门 API(`sys_department` + `sys_department_member`)—— 集成测试。
 *
 * 覆盖:建树 / 同级重名拦截 / **不能挂到自己的后代下**(成环)/ 有子部门或有成员时不让删 /
 * 一人在同一部门只有一条记录(改角色是 upsert)/ 同级重排的名单校验。
 *
 * ⚠️ 会读写真实库;数据全部用 `__test__` 前缀,`after` 里清干净。
 * ⚠️ 这个文件**不碰 `sys_role_menu`**(授权是 `role.test.ts` 的地盘)—— 因为
 * `node --test` 是**按文件并行**的,而"权限体系是否启用"看的就是那张表空不空。
 * 两个文件抢着写它,会让那边的"未启用"断言变得不确定。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysDepartment, sysDepartmentMember, sysRole, sysUser } from "../src/db/data-base-schema.ts";
import { newId } from "../src/lib/ids.ts";
import { assertNanoid, assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const deptIds: string[] = [];
const roleIds: string[] = [];
const userIds: string[] = [];

/** 造一个只在库里存在、用于挂成员的用户(直接插 `sys_user`:这里只需要一个合法的外键目标) */
async function makeUser(label: string): Promise<string> {
	const id = newId();
	await db.insert(sysUser).values({
		id,
		name: `${TEST_PREFIX}${label}`,
		email: `${TEST_PREFIX}${label}_${SUFFIX}@example.com`,
	});
	userIds.push(id);
	return id;
}

async function makeRole(label: string): Promise<string> {
	const row = await caller.role.create({ code: `${TEST_PREFIX}${label}_${SUFFIX}`, name: `${TEST_PREFIX}${label}` });
	roleIds.push(row.id);
	return row.id;
}

after(async () => {
	if (deptIds.length > 0) await db.delete(sysDepartmentMember).where(inArray(sysDepartmentMember.department_id, deptIds));
	if (roleIds.length > 0) await db.delete(sysRole).where(inArray(sysRole.id, roleIds));
	// 部门按"子 → 父"的顺序删(外键约束)
	for (const id of [...deptIds].reverse()) await db.delete(sysDepartment).where(eq(sysDepartment.id, id));
	if (userIds.length > 0) await db.delete(sysUser).where(inArray(sysUser.id, userIds));
});

test("部门:建树 —— 父下挂子,顶层与子层各自排序", async () => {
	const root = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}上海公司_${SUFFIX}` });
	const child = await caller.department.create({ parentId: root.id, name: `${TEST_PREFIX}上海研发_${SUFFIX}` });
	deptIds.push(root.id, child.id);

	assertNanoid(root.id, "部门 id");
	assert.equal(root.parentId, null, "顶级部门的 parentId 是 null");
	assert.equal(child.parentId, root.id, "子部门挂在父下");

	const tree = await caller.department.tree();
	const stored = tree.find((row) => row.id === child.id);
	assert.ok(stored, "tree 里应有刚建的子部门");
	assert.equal(stored.parentId, root.id);
});

test("部门:同级重名会被拒(顶级也拦 —— 唯一索引在 NULL 父级上不可靠)", async () => {
	const name = `${TEST_PREFIX}重名_${SUFFIX}`;
	const first = await caller.department.create({ parentId: null, name });
	deptIds.push(first.id);
	await assertRejects(() => caller.department.create({ parentId: null, name }), "已经有叫");
});

test("部门:不能把部门挂到自己的后代下(会成环)", async () => {
	const a = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}A_${SUFFIX}` });
	const b = await caller.department.create({ parentId: a.id, name: `${TEST_PREFIX}B_${SUFFIX}` });
	deptIds.push(a.id, b.id);
	await assertRejects(
		() => caller.department.update({ id: a.id, name: a.name, parentId: b.id, status: true }),
		"不能把部门挂到它自己的下级里",
	);
});

test("部门:有子部门时不让删", async () => {
	const parent = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}父_${SUFFIX}` });
	const child = await caller.department.create({ parentId: parent.id, name: `${TEST_PREFIX}子_${SUFFIX}` });
	deptIds.push(parent.id, child.id);
	await assertRejects(() => caller.department.remove({ id: parent.id }), "还有 1 个子部门");
});

test("部门成员:一人在同一部门只有一条记录,改角色是 upsert", async () => {
	const dept = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}成员部_${SUFFIX}` });
	deptIds.push(dept.id);
	const user = await makeUser("member");
	const roleA = await makeRole("角色A");
	const roleB = await makeRole("角色B");

	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: roleA });
	const first = await caller.department.members({ departmentId: dept.id });
	assert.equal(first.length, 1, "第一次加入 → 一条");
	assert.equal(first[0]?.roleId, roleA);
	assert.ok(first[0]?.userName, "应带出用户姓名");

	// 同一个部门换角色 → 仍然只有一条(靠 uk_sys_dm_unique 的 upsert 路径)
	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: roleB });
	const second = await caller.department.members({ departmentId: dept.id });
	assert.equal(second.length, 1, "换角色不该多出一条");
	assert.equal(second[0]?.roleId, roleB, "角色已换成 B");

	// 一人可跨部门 —— 在另一个部门再挂一条,互不影响
	const dept2 = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}成员部2_${SUFFIX}` });
	deptIds.push(dept2.id);
	await caller.department.setMemberRole({ departmentId: dept2.id, userId: user, roleId: roleA });
	assert.equal((await caller.department.members({ departmentId: dept2.id })).length, 1, "另一个部门里也能有一条");
	assert.equal((await caller.department.members({ departmentId: dept.id })).length, 1, "原部门那条还在");
});

test("部门:有成员时不让删;成员移出后可以删", async () => {
	const dept = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}待删_${SUFFIX}` });
	const user = await makeUser("todelete");
	const role = await makeRole("待删角色");
	await caller.department.setMemberRole({ departmentId: dept.id, userId: user, roleId: role });

	await assertRejects(() => caller.department.remove({ id: dept.id }), "还有 1 个成员");

	await caller.department.removeMember({ departmentId: dept.id, userId: user });
	const removed = await caller.department.remove({ id: dept.id });
	assert.equal(removed.success, true, "人移走之后就能删了");
});

test("部门:同级重排要求给全该级的名单(在自建父部门下做,不受并行文件的顶级部门干扰)", async () => {
	// ⚠️ 为什么要在自己的父部门下做:`node --test` **按文件并行**,`role.test.ts` 也在建顶级部门 ——
	// 用"顶级"当同级范围,兄弟集合会在两次调用之间被别的文件改掉,断言就会飘。
	const parent = await caller.department.create({ parentId: null, name: `${TEST_PREFIX}排序父_${SUFFIX}` });
	const first = await caller.department.create({ parentId: parent.id, name: `${TEST_PREFIX}排1_${SUFFIX}` });
	const second = await caller.department.create({ parentId: parent.id, name: `${TEST_PREFIX}排2_${SUFFIX}` });
	deptIds.push(parent.id, first.id, second.id);

	// 只给一个 → 拒(该级此刻有 2 个)
	await assertRejects(
		() => caller.department.reorder({ parentId: parent.id, orderedIds: [first.id] }),
		"必须包含该级下全部部门",
	);

	// 给全该级的名单 → 成功;确认 sort 真按传入顺序写(倒过来排,再读应也是倒序)
	await caller.department.reorder({ parentId: parent.id, orderedIds: [second.id, first.id] });
	const after = (await caller.department.tree()).filter((row) => row.parentId === parent.id).map((row) => row.id);
	assert.deepEqual(after, [second.id, first.id], "tree 的返回顺序应与传入的排序一致");

	// 名单里混进别的层级的部门 → 也拒
	await assertRejects(
		() => caller.department.reorder({ parentId: parent.id, orderedIds: [parent.id, second.id, first.id] }),
		"不属于同一上级",
	);
});

after(async () => {
	await closeDb();
});
