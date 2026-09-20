import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { db } from "#/db";
import * as schema from "#/db/schema";

/**
 * Better Auth 服务端实例 —— 认证的唯一入口。
 *
 * 本文件**只跑在服务端**:
 *  - 被 `src/routes/api/auth/$.ts` 的 `server.handlers` 引用(GET/POST 都交给 `auth.handler`);
 *  - 客户端不要 import 它(客户端走 `src/lib/auth-client.ts` 的 `createAuthClient()`);
 *  - 它 import 了 `#/db`,`#/db` 在 `DATABASE_URL` 缺失时直接抛错,所以 env 必须齐(见 `.env.example`)。
 *
 * 适配器:`drizzleAdapter(db, { provider: "mysql", schema })` —— 表定义在 `src/db/schema.ts`,
 * 迁移在 `./drizzle`。better-auth 按**模型名**在 schema 里找表(`user` / `session` / `account` /
 * `verification`),所以这四个导出的名字不能改;DB 列名是 snake_case,drizzle 负责映射。
 *
 * 版本:实测 better-auth **1.7.4**(`package.json` 声明 `^1.5.3`)。1.7.x 的核心四表字段见
 * `doc/表结构设计.md` §11.1;升级版本后请重新核对,字段变了 better-auth 会在运行时报
 * 「Model xxx not found」/「field not found」,typecheck 抓不到。
 *
 * 未接的部分(本轮只做基础设施,不实现后端业务逻辑):
 *  - 业务字段(账号 / 手机号 / 所属部门 / 状态)与 RBAC 的绑定:TBD —— 走 better-auth 的
 *    `user.additionalFields` 或独立的用户资料表,**本轮未加**,见 doc/表结构设计.md §11.4;
 *  - 登录 / 注册等认证页面 UI:TBD(现有 `(main)/demo/better-auth` 只是客户端 API 示例页);
 *  - 权限点下发给前端:`session` 里目前不带权限,需要一个服务端 procedure 读
 *    `user_role → role_permission` 后返回权限码数组(接口未实现,前端已留好挂载点,见 §11.3);
 *  - 第三方登录(微信 / 统一身份认证等):TBD,加 `socialProviders` 即可,表结构无需改动。
 */
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "mysql",
		schema,
	}),
	emailAndPassword: {
		enabled: true,
	},
	plugins: [tanstackStartCookies()],
});
