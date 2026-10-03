import { createTRPCRouter } from "./init";
import { dataPluginRouter } from "./routers/data-plugin";
import { dataScopeRouter } from "./routers/data-scope";
import { demoGridRouter } from "./routers/demo-grid";
import { departmentRouter } from "./routers/department";
import { dictRouter } from "./routers/dict";
import { fileRouter } from "./routers/file";
import { logRouter } from "./routers/log";
import { menuRouter } from "./routers/menu";
import { noticeRouter } from "./routers/notice";
import { paraRouter } from "./routers/para";
import { roleRouter } from "./routers/role";
import { tagRouter } from "./routers/tag";
import { userRouter } from "./routers/user";

export const trpcRouter = createTRPCRouter({
	/** 审计日志(只读,见 doc/审计日志.md) */
	log: logRouter,
	/** 站内通知(只碰自己的,见 doc/通知中心.md) */
	notice: noticeRouter,
	/** Demo:综合网格履职(见 doc/测试数据/README.md) */
	demoGrid: demoGridRouter,
	/** 系统设置 ▸ 菜单管理 —— 读写 `sys_menu` */
	menu: menuRouter,
	/** 系统设置 ▸ 字典管理 —— 读写 `sys_dict` */
	dict: dictRouter,
	/** 系统设置 ▸ 参数管理 —— 读写 `sys_para`(旧名 sys_config) */
	para: paraRouter,
	/** 系统设置 ▸ 标签管理 —— 读写 `sys_tag`(自关联树) */
	tag: tagRouter,
	/** 系统设置 ▸ 部门管理 —— 读写 `sys_dept`(自关联树)+ 成员/角色分配 */
	department: departmentRouter,
	/** 系统设置 ▸ 角色管理 —— 读写 `sys_role` + `sys_casbin_rule`(`p` 行 = 菜单/按钮授权,`g` 行 = 成员) */
	role: roleRouter,
	/** 系统设置 ▸ 用户管理 —— 只读 `sys_user` + 读写部门/角色分配 */
	user: userRouter,
	/** 系统设置 ▸ 文件管理 —— 读写 `sys_file`(字节存 MinIO,见 doc/文件管理.md) */
	file: fileRouter,
	/** 系统设置 ▸ 数据权限 ▸ 数据范围 —— 读写 `sys_data_policy`(行级可见范围,见 doc/数据权限.md) */
	dataScope: dataScopeRouter,
	/** 系统设置 ▸ 数据权限 ▸ 值域插件 —— 读写 `sys_data_plugin`(写接口**只给超管**,见 doc/数据权限.md) */
	dataPlugin: dataPluginRouter,
});
export type TRPCRouter = typeof trpcRouter;
