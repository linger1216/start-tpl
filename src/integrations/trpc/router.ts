import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "./init";
import { departmentRouter } from "./routers/department";
import { dictRouter } from "./routers/dict";
import { menuRouter } from "./routers/menu";
import { paraRouter } from "./routers/para";
import { roleRouter } from "./routers/role";
import { tagRouter } from "./routers/tag";
import { userRouter } from "./routers/user";

const todos = [
	{ id: 1, name: "Get groceries" },
	{ id: 2, name: "Buy a new phone" },
	{ id: 3, name: "Finish the project" },
];

const todosRouter = {
	list: publicProcedure.query(() => todos),
	add: publicProcedure.input(z.object({ name: z.string() })).mutation(({ input }) => {
		const newTodo = { id: todos.length + 1, name: input.name };
		todos.push(newTodo);
		return newTodo;
	}),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	todos: todosRouter,
	/** 系统设置 ▸ 菜单管理 —— 读写 `sys_menu` */
	menu: menuRouter,
	/** 系统设置 ▸ 字典管理 —— 读写 `sys_dict` */
	dict: dictRouter,
	/** 系统设置 ▸ 参数管理 —— 读写 `sys_para`(旧名 sys_config) */
	para: paraRouter,
	/** 系统设置 ▸ 标签管理 —— 读写 `sys_tag`(自关联树) */
	tag: tagRouter,
	/** 系统设置 ▸ 部门管理 —— 读写 `sys_department`(自关联树)+ 成员/角色分配 */
	department: departmentRouter,
	/** 系统设置 ▸ 角色管理 —— 读写 `sys_role` + `sys_role_menu`(菜单/按钮授权) */
	role: roleRouter,
	/** 系统设置 ▸ 用户管理 —— 只读 `sys_user` + 读写部门/角色分配 */
	user: userRouter,
});
export type TRPCRouter = typeof trpcRouter;
