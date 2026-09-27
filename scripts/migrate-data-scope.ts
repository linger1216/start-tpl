/**
 * **一次性迁移**:把旧的 `sys_role.data_scope`(「数据范围」档位)搬成 `sys_data_policy` 里的直白授权规则。
 *
 * 为什么要它:数据权限的载体从"角色的一个枚举列"换成了策略表,老库里那些档位得**逐条搬准**:
 *
 * | 旧档位 | 新规则 | 为什么这么写 |
 * | --- | --- | --- |
 * | `all` | `role:<code> → *, *, allow` | 角色级一条通配,以后新增的资源也自动放开 |
 * | `dept_below` | 每个持该角色的人 `user:<id> → <资源>@org:<他的部门>` | ⚠️ **不能写成部门主体**(`dept:<部门>`):队长与队员挂在同一个「××网格组」上,部门规则对**所有人**生效 ⇒ 队员会看到整条街;按人授权才分得开 |
 * | `self` | `demo_grid` 按 `owner_id` 每行一条 + `user:<id> → sys_user@<自己>` | 与旧的"仅本人"逐行等价 |
 * | `dept`(不含下级) | **不迁移,打印告警** | `@org:` 天然带子树,表达不了"不含下级"这一档;现网没有角色用这一档 |
 *
 * ⚠️ **删列写在本脚本里,不登记进建表脚本的删列注册表** —— 那两处(`create-system-tables.ts` 的
 * `COLUMN_DROPS` / 达梦脚本的 `columnDrops`)是**建表之后**跑的,登记进去第一次 `pnpm db:create`
 * 就把列删了,本脚本再也没得读。正确顺序:
 *
 *     pnpm db:create            # 建出 sys_data_policy(此时旧列还在)
 *     pnpm db:migrate:data-scope # 读旧列 → 写规则 → 自己把列删掉
 *
 * 幂等:列已经没了 ⇒ 打印一句直接退出(跑第二遍是安全的)。
 *
 * 用法:`pnpm db:migrate:data-scope`
 */
import "dotenv/config";

import { eq, sql } from "drizzle-orm";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";

import { sysDataPolicy, sysDemoGrid, sysUserDept, sysUserRole } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { grantRule, REGISTERED_RESOURCE_TYPES } from "../src/lib/data-policy.ts";

/**
 * 旧表的形状 —— 只为读出 `data_scope` 这一列。
 * 不能拿 `data-base-schema.ts` 的 `sysRole`,那一列**已经删了**;这里单独声明一份临时表。
 */
const legacyRole = mysqlTable("sys_role", {
	id: varchar("id", { length: 32 }).primaryKey(),
	code: varchar("code", { length: 64 }),
	name: varchar("name", { length: 64 }),
	data_scope: varchar("data_scope", { length: 32 }),
});

type LegacyRole = { id: string; code: string | null; name: string | null; dataScope: string | null };

/** 读出所有角色的旧档位;列不存在(迁移过了)返回 null */
async function readLegacyScopes(): Promise<LegacyRole[] | null> {
	try {
		const rows = await db
			.select({ id: legacyRole.id, code: legacyRole.code, name: legacyRole.name, dataScope: legacyRole.data_scope })
			.from(legacyRole);
		return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, dataScope: row.dataScope }));
	} catch (error) {
		// 只有"这一列没了吗"当成"已经迁过";其它错误照抛(别把真故障吞掉)
		const message = error instanceof Error ? error.message : String(error);
		const looksLikeMissingColumn = /data_scope|unknown column|无效的列名|invalid column/i.test(message);
		if (!looksLikeMissingColumn) throw error;
		console.log(`· 读不到旧列(data_scope),按"已经迁过"处理:${message}`);
		return null;
	}
}

/** 持某个角色的人 */
async function membersOf(roleId: string): Promise<string[]> {
	const rows = await db.select({ userId: sysUserRole.user_id }).from(sysUserRole).where(eq(sysUserRole.role_id, roleId));
	return rows.map((row) => row.userId);
}

/** 这个人挂在哪些部门(旧 `dept_below` 要按"他自己的部门"授权) */
async function deptsOf(userId: string): Promise<string[]> {
	const rows = await db.select({ deptId: sysUserDept.department_id }).from(sysUserDept).where(eq(sysUserDept.user_id, userId));
	return rows.map((row) => row.deptId);
}

/** `dept_below` ⇒ 按人授权到"他的每个部门"的每个登记资源 */
async function migrateDeptBelow(userId: string): Promise<number> {
	const deptIds = await deptsOf(userId);
	if (deptIds.length === 0) {
		console.warn(`  ⚠️ 这个人被授予了「本部门及以下」,却没挂任何部门 ⇒ 迁移后他看不到任何数据(失败关闭)`);
		return 0;
	}
	let written = 0;
	for (const deptId of deptIds) {
		for (const resourceType of REGISTERED_RESOURCE_TYPES) {
			await grantRule(`user:${userId}`, `${resourceType}@org:${deptId}`, "*", "迁移:数据范围 dept_below");
			written += 1;
		}
	}
	return written;
}

/** `self` ⇒ `demo_grid` 按 `owner_id` 每行一条 + `sys_user` 他自己那一行 */
async function migrateSelf(userId: string): Promise<number> {
	const owned = await db.select({ id: sysDemoGrid.id }).from(sysDemoGrid).where(eq(sysDemoGrid.owner_id, userId));
	for (const row of owned) await grantRule(`user:${userId}`, `demo_grid@${row.id}`, "*", "迁移:数据范围 self");
	await grantRule(`user:${userId}`, `sys_user@${userId}`, "*", "迁移:数据范围 self");
	return owned.length + 1;
}

/** 表里有没有启用中的策略(判断这次到底写没写东西) */
async function enabledPolicyCount(): Promise<number> {
	const rows = await db.select({ id: sysDataPolicy.id }).from(sysDataPolicy).where(eq(sysDataPolicy.status, 1));
	return rows.length;
}

const roles = await readLegacyScopes();
if (!roles) {
	console.log("✓ sys_role.data_scope 已经不存在 —— 没什么可迁的(第二次跑是安全的)。");
	process.exit(0);
}

console.log(`读旧列 sys_role.data_scope:共 ${roles.length} 个角色。`);
const before = await enabledPolicyCount();
let written = 0;
const warnings: string[] = [];

for (const role of roles) {
	const code = (role.code ?? "").trim();
	const label = `${code || role.id}(${role.name ?? ""})`;
	if (!code) {
		warnings.push(`${label}:角色没有 code,无法写角色规则,请手工处理`);
		continue;
	}
	const scope = (role.dataScope ?? "all").trim();
	if (scope === "" || scope === "all") {
		// 旧口径里"没配 / all"都是"不收窄" ⇒ 角色级一条通配(以后再新增资源也自动包含)
		if (scope === "") console.warn(`  ⚠️ 角色 ${code} 的档位是空的,按旧的"不收窄"处理 ⇒ 写成 all`);
		await grantRule(`role:${code}`, "*", "*", "迁移:数据范围 all");
		written += 1;
		continue;
	}

	const members = await membersOf(role.id);
	if (scope === "dept_below") {
		for (const userId of members) written += await migrateDeptBelow(userId);
		console.log(`· ${code}:dept_below → ${members.length} 人按组织授权(每条资源一条)`);
		continue;
	}
	if (scope === "self") {
		for (const userId of members) written += await migrateSelf(userId);
		console.log(`· ${code}:self → ${members.length} 人按行授权(各自负责的行 + 自己那一行)`);
		continue;
	}
	if (scope === "dept") {
		// `@org:` 是"该节点及其以下",表达不了"本部门(不含下级)" ⇒ 不猜,交给人决定
		warnings.push(`${label}:档位是 dept(本部门,不含下级),策略表表达不了这一档 —— 请手工按人写规则`);
		continue;
	}
	warnings.push(`${label}:档位 ${scope} 认不出来(up:N 那套已废弃)—— 未迁移`);
}

console.log(`\n写入策略行:${written} 条(迁移前启用中的策略行 ${before} 条)。`);
if (warnings.length > 0) {
	console.warn("\n⚠️ 有需要人看的告警:");
	for (const warning of warnings) console.warn(`  · ${warning}`);
}

// 迁完才删列 —— 顺序反了就再也读不到档位了
if (process.argv.includes("--keep-column")) {
	console.log("(--keep-column:按你的要求保留旧列,没有删)");
} else {
	await db.execute(sql.raw("alter table `sys_role` drop column `data_scope`"));
	console.log("✓ 已删列 sys_role.data_scope(删列写在本脚本里,不登记进建表脚本的删列注册表 —— 见文件头)");
}
process.exit(0);
