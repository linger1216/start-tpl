/**
 * **行级数据权限的基线种子** —— `sys_data_policy` 的「基本访问数据策略」。
 *
 * 口径与其它种子一致:**幂等、只补不覆盖**。已经存在的策略行一个字节都不动(备注、乃至被手工
 * 改成 `deny` 的效果都留着),所以重复跑不会把迁移行上的「迁移:数据范围 all」这类出处冲掉。
 *
 * 造出来的三条基线(与那次一次性迁移(`sys_role.data_scope` → `sys_data_policy`;迁移已执行、脚本已随迁移移除)的口径**一一对应**,
 * 也就是说:老库迁移完再跑它 = 0 新增;新库从零跑它 = 拿到与迁移后等价的权限):
 *
 *   ① 区级 / 科室角色 ⇒ `role:<code> → *, *, allow`(不受限 —— 区里要看全部 68 个网格)
 *   ② 队长(duizhang) ⇒ 每人 × 每个资源类型 × 他所在的部门 ⇒ `user:<id> → <类型>@org:<部门>`
 *      (按组织授权 = 该节点及子树;**刻意不写 `dept:` 主体** —— 同一个部门里还有队员,
 *       部门规则会让队员也看到整块,见 doc/rbac-权限模型.md)
 *   ③ 队员(duiyuan) ⇒ 他 `owner_id` 的每一条网格 `demo_grid@<行 id>` + 一条 `sys_user@<他自己>`
 *
 * ⚠️ 派工角色(`ASSIGNED_ROLE_CODES`)是**业务口径**,换项目要改这里:这两个角色的人只拿到
 *   "被指派的活儿",不拿整块;其余启用角色一律不受限。
 *
 * 用法:pnpm db:seed:policies(可加 `--dry-run` 只看计划不动库)
 */
import "dotenv/config";

import { asc, eq, isNotNull } from "drizzle-orm";

import { db } from "../src/db/index.ts";
import { sysDataPolicy, sysDemoGrid, sysRole, sysUser, sysUserDept, sysUserRole } from "../src/db/data-base-schema.ts";
import { ensureRule, REGISTERED_RESOURCE_TYPES } from "../src/lib/data-policy.ts";

/** 只拿到"被指派的活儿"的角色;其余启用角色 = 不受限 */
const ASSIGNED_ROLE_CODES = new Set(["duizhang", "duiyuan"]);

const REMARK = {
	role: "基线:区级角色不受限",
	org: "基线:队长按组织",
	row: "基线:队员按行",
	self: "基线:队员看自己",
} as const;

type Planned = { sub: string; obj: string; act: string; remark: string; why: string };

const keyOf = (v0: string, v1: string, v2: string) => `${v0}\u0000${v1}\u0000${v2}`;

type Plan = {
	rules: Planned[];
	users: { id: string; name: string; email: string }[];
	coveredByRole: Set<string>;
	coveredByGrant: Set<string>;
	roleCount: number;
	assignmentCount: number;
};

async function build(): Promise<Plan> {
	const roles = await db
		.select({ id: sysRole.id, code: sysRole.code, name: sysRole.name })
		.from(sysRole)
		.where(eq(sysRole.status, 1))
		.orderBy(asc(sysRole.sort), asc(sysRole.code));
	const [assignments, memberships, ownedGrids, users] = await Promise.all([
		db.select({ userId: sysUserRole.user_id, roleId: sysUserRole.role_id }).from(sysUserRole),
		db.select({ userId: sysUserDept.user_id, deptId: sysUserDept.department_id }).from(sysUserDept),
		db
			.select({ id: sysDemoGrid.id, ownerId: sysDemoGrid.owner_id })
			.from(sysDemoGrid)
			.where(isNotNull(sysDemoGrid.owner_id)),
		db.select({ id: sysUser.id, name: sysUser.name, email: sysUser.email }).from(sysUser).orderBy(asc(sysUser.createdAt)),
	]);
	const roleById = new Map(roles.map((role) => [role.id, role]));
	const roleCodesOf = new Map<string, string[]>();
	for (const row of assignments) {
		// 停用的角色不算有效角色(与 rbac.ts 的 enabledRolesOf 同口径)
		const role = roleById.get(row.roleId);
		if (!role) continue;
		roleCodesOf.set(row.userId, [...(roleCodesOf.get(row.userId) ?? []), role.code]);
	}
	const deptIdsOf = new Map<string, string[]>();
	for (const row of memberships) {
		deptIdsOf.set(row.userId, [...(deptIdsOf.get(row.userId) ?? []), row.deptId]);
	}
	const gridIdsOf = new Map<string, string[]>();
	for (const row of ownedGrids) {
		if (!row.ownerId) continue;
		gridIdsOf.set(row.ownerId, [...(gridIdsOf.get(row.ownerId) ?? []), row.id]);
	}

	const rules = new Map<string, Planned>();
	const push = (rule: Planned) => rules.set(keyOf(rule.sub, rule.obj, rule.act), rule);
	const coveredByRole = new Set<string>();
	const coveredByGrant = new Set<string>();

	// ① 不受限的角色(区级科室角色)—— "谁有这个角色"由角色分配现算,所以这里只写角色规则
	for (const role of roles) {
		if (ASSIGNED_ROLE_CODES.has(role.code)) continue;
		push({ sub: `role:${role.code}`, obj: "*", act: "*", remark: REMARK.role, why: `角色 ${role.name}` });
		for (const row of assignments) {
			if (row.roleId === role.id) coveredByRole.add(row.userId);
		}
	}

	// ② / ③ 派工角色按人授权(为什么不写 `dept:<节点>` —— 见文件头第 ② 条)
	for (const user of users) {
		const codes = roleCodesOf.get(user.id) ?? [];
		const deptIds = deptIdsOf.get(user.id) ?? [];
		if (codes.includes("duizhang")) {
			for (const type of REGISTERED_RESOURCE_TYPES) {
				for (const deptId of deptIds) {
					push({
						sub: `user:${user.id}`,
						obj: `${type}@org:${deptId}`,
						act: "*",
						remark: REMARK.org,
						why: `队长 ${user.name}`,
					});
					coveredByGrant.add(user.id);
				}
			}
		}
		if (codes.includes("duiyuan")) {
			for (const gridId of gridIdsOf.get(user.id) ?? []) {
				push({
					sub: `user:${user.id}`,
					obj: `demo_grid@${gridId}`,
					act: "*",
					remark: REMARK.row,
					why: `队员 ${user.name}`,
				});
				coveredByGrant.add(user.id);
			}
			push({
				sub: `user:${user.id}`,
				obj: `sys_user@${user.id}`,
				act: "*",
				remark: REMARK.self,
				why: `队员 ${user.name}`,
			});
			coveredByGrant.add(user.id);
		}
	}

	return {
		rules: [...rules.values()],
		users,
		coveredByRole,
		coveredByGrant,
		roleCount: roles.length,
		assignmentCount: assignments.length,
	};
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes("--dry-run");
	const plan = await build();
	const count = (remark: string) => plan.rules.filter((rule) => rule.remark === remark).length;
	console.log(`  启用角色 ${plan.roleCount} 个 / 角色分配 ${plan.assignmentCount} 条 / 账号 ${plan.users.length} 个`);
	console.log(
		`  计划 ${plan.rules.length} 条:角色规则 ${count(REMARK.role)} · 队长的组织规则 ${count(REMARK.org)} · 队员的按行规则 ${count(REMARK.row) + count(REMARK.self)}`,
	);

	const current = await db.select({ v0: sysDataPolicy.v0, v1: sysDataPolicy.v1, v2: sysDataPolicy.v2 }).from(sysDataPolicy);
	const currentKeys = new Set(current.map((row) => keyOf(row.v0, row.v1, row.v2)));
	const missing = plan.rules.filter((rule) => !currentKeys.has(keyOf(rule.sub, rule.obj, rule.act)));
	const plannedKeys = new Set(plan.rules.map((rule) => keyOf(rule.sub, rule.obj, rule.act)));
	const extra = current.filter((row) => !plannedKeys.has(keyOf(row.v0, row.v1, row.v2)));
	console.log(`  库里已有 ${current.length} 条:计划内 ${current.length - extra.length} · 计划外(手工 / 迁移遗留)${extra.length}`);
	for (const row of extra.slice(0, 10)) console.log(`      · 计划外:${row.v0} → ${row.v1} (${row.v2})`);

	if (dryRun) {
		console.log(`\n--dry-run:会新增 ${missing.length} 条`);
		for (const rule of missing.slice(0, 20)) console.log(`      + ${rule.sub} → ${rule.obj} (${rule.act})   [${rule.why}]`);
		if (missing.length > 20) console.log(`      …另有 ${missing.length - 20} 条`);
		process.exit(0);
	}

	let inserted = 0;
	for (const rule of missing) {
		if (await ensureRule(rule.sub, rule.obj, rule.act, rule.remark)) inserted += 1;
	}

	const orphans = plan.users.filter((user) => !plan.coveredByRole.has(user.id) && !plan.coveredByGrant.has(user.id));
	console.log(`\n✓ 种子完成:策略 +${inserted}(计划 ${plan.rules.length} 条,已存在 ${plan.rules.length - missing.length} 条)`);
	if (orphans.length > 0) {
		console.log(`⚠️ ${orphans.length} 个账号既没有角色规则、也没有个人规则 ⇒ 登录后看不到任何数据(失败关闭):`);
		for (const user of orphans) console.log(`      · ${user.name} <${user.email}>`);
	}
	if (inserted > 0) {
		console.log("⚠️ 策略表非空 = 行级数据权限**已启用**:没被任何规则命中的账号看不到数据。");
	}
	process.exit(0);
}

main().catch((error) => {
	console.error("种子失败:", error);
	process.exit(1);
});
