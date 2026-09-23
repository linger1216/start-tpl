import { createAuthClient } from "better-auth/react";

/**
 * 客户端认证入口。
 *
 * ⚠️ 服务端 `lib/auth.ts` 装了什么插件,这里就要配对应的客户端插件 —— 现在两边都**没有插件**
 * (organization 已撤掉:部门/角色是项目自己的 `sys_*` 表,不走 BA 的组织模型)。
 */
export const authClient = createAuthClient();
