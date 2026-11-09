/** 旧库补充填报模板删除权限点；不创建角色、账号，也不更改任何授权。 */
import "dotenv/config";

import { and, eq, or } from "drizzle-orm";
import { sysMenu } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { MENU_TYPE } from "../src/lib/menu-spec.ts";
import { alive } from "../src/lib/soft-delete.ts";

const perm = "sys:tc_report_template:remove";
const path = `#perm/${perm}`;
const [parent] = await db
	.select({ id: sysMenu.id })
	.from(sysMenu)
	.where(and(eq(sysMenu.path, "/task-close"), alive(sysMenu)))
	.limit(1);
if (!parent) throw new Error("找不到任务闭环菜单；未修改任何数据");
const matches = await db
	.select()
	.from(sysMenu)
	.where(or(eq(sysMenu.path, path), eq(sysMenu.perm, perm)));
if (matches.length) {
	const existing = matches[0];
	if (
		matches.length !== 1 ||
		existing.deleted_at ||
		existing.path !== path ||
		existing.perm !== perm ||
		existing.type !== MENU_TYPE.BUTTON ||
		existing.parent_id !== parent.id ||
		existing.status !== 1
	) {
		throw new Error("填报模板权限点存在冲突或已删除，请在菜单管理中检查；未修改任何数据");
	}
	console.log("填报模板删除权限点已存在，未修改任何数据");
} else {
	await db.insert(sysMenu).values({
		id: newId(),
		parent_id: parent.id,
		name: "删除填报模板",
		path,
		icon: null,
		sort: 90,
		visible: 1,
		status: 1,
		type: MENU_TYPE.BUTTON,
		perm,
	});
	console.log("已新增填报模板删除权限点；未更改角色和授权");
}
process.exit(0);
