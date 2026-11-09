# start-tpl —— TanStack Start 后台模板

一个人自用的**后台管理系统模板**:React 19 + TanStack Start,自带后台外壳、44 个 UI 原语、17 个跨域展示件、台账页面骨架,以及 tRPC + Drizzle + Better Auth + RBAC(页面级拦截 + 菜单/按钮授权)的完整接线。

模板包含系统设置、任务闭环样本和框架能力示例；系统设置提供可直接派生的后台基础能力，任务闭环展示任务流转，可按需裁剪。所有组件都有**活文档**:工作台 `/` 的 UI 示例逐个给出真实渲染的例子(受控的都给好了 useState),改了组件页面立刻反映,文档不会过期。

技术栈:React 19 · TanStack Start / Router / Query / Form / Table **v9** · tRPC **v11** · Drizzle ORM + MySQL / 达梦 · Better Auth · Tailwind CSS **v4** · Biome · Vite 8 · TypeScript 6

环境要求:Node ≥ 20.19,pnpm 11(`packageManager` 已固定为 `pnpm@11.23.0`)。

---

## 快速开始

```bash
pnpm install
cp .env.example .env.local     # 填写 DATABASE_URL 和 INITIAL_ADMIN_PASSWORD 等
pnpm db:create                 # 建系统表、通知与调度表(幂等)
pnpm db:seed:menus && pnpm db:seed:rbac && pnpm db:seed:paras && pnpm db:seed:dicts
pnpm db:seed:demo              # 可选:71 条网格数据(那批演示账号是本机手工准备的,种子不建)
pnpm dev                       # http://localhost:3000
pnpm worker                    # 另一个终端:调度与外部渠道投递
```

`pnpm dev` 固定监听 **3000** 端口。 通知投递和定时检查需要同时运行 `pnpm worker`；生产部署使用独立 Worker 进程。短信 Provider 和 SMTP 配置见 [通知中心](doc/通知中心.md)。旧通知表不迁移，开发库需删除旧表后重新建表。

> **组件示例都在工作台 `/`**。它自己也读菜单表,所以要先把 `.env.local` 的 `DATABASE_URL` 配好再 `pnpm dev`。
> `/settings` 十二页全部读真库,没配 `DATABASE_URL` 会落到错误边界。首次初始化的管理员是 `admin@example.com`,密码由 `INITIAL_ADMIN_PASSWORD` 指定;派生脚本会为每个新项目生成独立密码。首次登录后请修改密码并从环境配置中移除初始密码。
> 不想在本机装 MySQL / MinIO:`docker compose` 一套起齐,见下文「Docker / 容器化」。

---

## 打开后先看这五块

| 入口 | 内容 |
| --- | --- |
| **工作台** `/` | 模板入口页:上手四件事、目录职责速查、派生时删什么的清单 |
| **任务闭环** `/task-close/*` | ★ 状态机驱动的业务闭环示范:我的任务 / 流程模板 / 任务详情(审批流 + 待办流转 + 活动日志) |
| **系统设置** `/settings/*` | ★ 核心后台模块,**十二个页面**,全部读写真库(用户/角色/部门/权限/数据范围/文件/日志…) |
| **框架能力** `/demo/*` | 6 个基础能力样例(数据请求 / 表单 / 表格 / 数据库 / 登录认证 / 状态)+ 2 个演示页 |
| **UI 组件示例** | 就在工作台 `/` 页内:44 个原语的最小可用例子 + 台账表格实战示例 |

菜单树是**库 + 兜底**双源:`sys_menu` 表有数据时以表为准,为空则退回 `src/components/layout/nav-config.ts` 的 `NAV_NODES`。改 `NAV_NODES` 后侧边栏、面包屑、模块概览、工作台四处会一起变。

---

## 目录结构

```
src/
├── routes/                       # 文件路由,文件名即 URL
│   ├── __root.tsx                # 根布局:HTML 骨架、主题引导脚本、404 / 没权限页、devtools
│   ├── login.tsx                 # 登录页(在后台外壳之外)
│   ├── (main)/                   # 无路径布局组(URL 中不出现 "(main)")
│   │   ├── route.tsx             # 后台外壳 + 页面级权限守卫(beforeLoad 读会话 / 判页面权限)
│   │   ├── index.tsx             # 工作台(入口页 + UI 示例)
│   │   ├── notices.tsx           # 通知中心
│   │   ├── task-close/           # 任务闭环(3 个路由:我的任务 / 流程模板 / 任务详情)
│   │   ├── demo/                 # 框架能力样例(8 个路由文件)
│   │   └── settings/             # 系统设置(13 个路由文件 = 索引 + 12 页)
│   ├── api.trpc.$.tsx            # tRPC 请求入口 /api/trpc/*
│   └── api/auth/$.ts             # Better Auth 请求入口 /api/auth/*
├── components/
│   ├── ui/                       # 44 个叶子原语(shadcn 风格 + 自研组合控件)
│   ├── layout/                   # 后台外壳:sidebar / topbar / 面包屑 / 页头 / 空态 / 占位页 + nav-config / nav-menu / nav-data
│   ├── modules/shared/           # 17 个领域无关展示件(表格套件 / 工具栏 / 详情 / 树 / 标签 / 权限树 / Excel…)
│   ├── modules/workbench/        # 工作台 + UI 示例(ui-gallery)
│   ├── modules/task-close/       # 任务闭环的三页与配套件
│   ├── modules/settings/         # 系统设置十二页的页面 / 表格 / 表单 / 详情件(52 个文件)
│   ├── modules/demo/             # 框架能力样例的页面件
│   └── modules/notice/           # 通知中心件
├── lib/
│   ├── api/error.ts              # ApiError / toApiError / toastApiError (统一错误吐司)
│   ├── tag-color.ts              # 6 色相点缀色板 + 稳定哈希算法
│   ├── table.ts                  # TanStack Table v9 的 app hook(useAppTable + useRowSelection)
│   ├── excel.ts                  # Excel 列类型 + 唯一写盘点 writeSheet / cellText
│   ├── rbac.ts                   # 权限码判定 + PERM_BY_PATH(接口 → 权限点的唯一字典)
│   ├── casbin.ts                 # casbin enforcer + 策略装载(仅服务端)
│   ├── auth.ts / auth-client.ts / auth-debug.ts / current-user.ts
│   ├── sys-para.ts / para-spec.ts / menu-spec.ts / notice.ts / sidebar-mode.ts
│   ├── audit.ts / logger.ts / ids.ts / time.ts / format.ts / multi-value.ts / tree.ts / constants.ts
│   ├── storage.ts / storage-minio.ts / menu-detail-path.ts / demo-store.ts / utils.ts
│   ├── task-close-spec.ts / task-close-log.ts / task-content.ts # 任务闭环的规格 / 词表 / 内容块(客户端可引)
│   ├── data-scope*.ts / soft-delete.ts / reorder.ts / file-preview.ts …(完整清单见 doc/后端代码导读.md §7)
├── db/
│   ├── index.ts                  # drizzle 实例(按 env 选 mysql2 / 达梦),导出 db
│   ├── data-base-schema.ts       # 39 张表(25 张 sys_* + demo_grid + 13 张 tc_*:设置 / 认证 / 权限 / 数据权限 / 日志 / 任务闭环…)
│   ├── schema.ts                 # 走 drizzle 迁移的表(当前只剩 demo 的 todos)
│   └── dm/                       # 达梦方言适配(连接 + SQL 翻译)
├── integrations/
│   ├── trpc/                     # init.ts / router.ts / react.ts + routers/(14 个域)
│   └── tanstack-query/           # root-provider.tsx(getContext + TRPCProvider)
├── hooks/                        # use-para-prefs / use-perms / use-file-upload / use-ledger-table / use-ledger-write / use-stable-keys / demo.form*
├── router.tsx                    # ★ createRouter + SSR Query 集成(按约定路径被插件加载,别删)
├── routeTree.gen.ts              # 生成物,不要手改
└── styles.css                    # Tailwind v4 入口 + 设计 token
```

UI 组件与跨域展示件通过真实页面或工作台示例展示；Excel 导入和导出按需加载，避免进入首屏包。

---

## 组件层:三层分工

| 层 | 位置 | 放什么 | 判断标准 |
| --- | --- | --- | --- |
| **叶子原语** | `components/ui/` | Button / Card / Table / SearchSelect / TagList… | 接口里**不含任何业务概念**,能直接搬进任何新项目 |
| **跨域展示件** | `components/modules/shared/` | DataTable / LedgerToolbar / FilterChipBar / StatCards / PaginationControl / ColumnToggle / DetailDialog / SortableTree / PermissionTree / MultiSelect / MemberZone / IconPicker / ExcelImportDialog… | 有**版式或行为约定**,但字段声明与数据订阅仍由调用方给 |
| **组合块与业务** | `components/modules/<域>/` | 详情页组装、导入向导、页面专属件 | 离开这个业务就没有意义 |

`shared/` 里的东西**共享版式、不共享字段** —— 列定义、行类型、增删改写操作逐页手写。这是刻意的:**不做声明式驱动的通用 CRUD**,因为那类抽象在字段一多、校验一复杂时就开始打架。

每个展示件的用途、props 与真实例子都在工作台 `/` 的 UI 示例里,不用翻源码。

---

## 设计系统

视觉规范以 [DESIGN.md](DESIGN.md) 为准，`src/styles.css` 是颜色、字体和动效 token 的实现。界面采用暖纸白画布、墨色文字和低饱和黛蓝主题色；印泥红用于章和批注。组件使用 `bg-background`、`text-foreground`、`border-border` 等语义类，视觉调整优先修改 token。

`success`、`warn`、`danger` 表达状态语义；`hue-*` 用于分类和数据编码，不能替代告警色。色相类名必须以字面量出现，新增色相时同步浅色、深色和 `@theme inline` 映射。具体字距、圆角、阴影、动效及暗色模式规则见 `DESIGN.md` 和 [界面约定](doc/界面约定.md)。

---

## 可用脚本

**日常三条**(`typecheck` + `check` + `generate-routes`),`check` 带 `--write`:

| 命令 | 实际执行 | 说明 |
| --- | --- | --- |
| `pnpm dev` | `dotenv -e .env.local -- vite dev --port 3000` | 开发服务器,固定 3000 端口 |
| `pnpm worker` | `dotenv -e .env.local -- tsx scripts/worker.ts` | 独立调度与通知投递进程 |
| `pnpm build` | `vite build` | 产出 Nitro Node 服务到 `.output/` |
| `pnpm start` | `node .output/server/index.mjs` | 运行生产产物,需先 `pnpm build`,**不读 env 文件**(见下文) |
| `pnpm preview` | `vite preview` | Vite 自带预览。产物是 Nitro 服务,验证生产请用 `build && start` |
| `pnpm typecheck` | `tsc --noEmit` | 类型检查,只报告不写文件 |
| `pnpm check` | `biome check --write .` | 格式化 + lint + 整理 import,**会写回文件** |
| `pnpm generate-routes` | `tsr generate` | 扫描 `src/routes/` 重新生成 `routeTree.gen.ts` |
| `pnpm test` | `LOG_SILENT=1 dotenv -e .env.local -- node --import tsx --test --test-reporter=spec tests/*.test.ts` | 直连测试库和 MinIO;权限测试要求先运行菜单与 RBAC 种子;跑完清理自身创建的 `__test__*` 数据 |
| `pnpm test:cov` | 同上 + `--experimental-test-coverage` | Node 内置覆盖率，只统计运行时加载的文件，不能代表未加载的 UI 和路由 |
| `pnpm check:legacy` | `node scripts/check-legacy.mjs` | 验证当前 Node 进程里 DES-CFB 算法是否可用(达梦老密码需要) |

**数据库**(都读 `.env.local`):

| 命令 | 说明 |
| --- | --- |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:pull` / `db:studio` | drizzle-kit;只管 `src/db/schema.ts`(当前是 `todos`) |
| `pnpm db:create` | 建系统表、通知投递表、调度表和任务闭环表(幂等,建完对齐列注释 / 索引名) |
| `pnpm db:sync:meta` | 只对齐列注释与索引名(老库升级用,**幂等**;第二次必须打印「无需改动」) |
| `pnpm db:migrate:ids` | 把自增 id 迁成 nanoid(一次性) |
| `pnpm db:dm:smoke` / `db:dm:defaults` | 达梦专项:drizzle 冒烟 / 默认值对齐 |
| `pnpm db:dm:create-ba` | 在达梦上建系统、通知、调度和任务表(目标环境需实库验证) |

**种子**(都幂等、只补不覆盖):

| 命令 | 说明 |
| --- | --- |
| `pnpm db:seed:menus` | 把 `NAV_NODES` 写进 `sys_menu`(按 path 去重) |
| `pnpm db:seed:dicts` / `db:seed:paras` | 字典种子 / `PARA_DEFAULTS` → `sys_para` |
| `pnpm db:seed:tags` | 标签种子(`scripts/tag-seed-data.ts`:17 维度 / 120 标签) |
| `pnpm db:seed:rbac` | 角色 / 菜单权限点 / 按钮级权限点 |
| `pnpm db:minio:init` | 建 MinIO 桶 |
| `pnpm db:seed:demo` | 演示数据:71 条网格(README 里提到的 26 个演示账号是**本机手工准备**的,种子脚本不建) |

---

## Docker / 容器化

本机不装 MySQL / MinIO 也能起全栈:`docker-compose.yml` 是唯一环境定义,devcontainer 只是它的叠加层。

```bash
cp .env.example .env.local                            # 至少填 BETTER_AUTH_SECRET
docker compose --profile setup run --rm bootstrap     # 建表 + 四个种子 + 建 MinIO 桶(幂等,可重跑)
docker compose up -d                                  # http://localhost:3000
```

| 服务 | 宿主端口 | 说明 |
| --- | --- | --- |
| `app` | `3000` | 生产产物(`Dockerfile` target `runtime`),healthcheck 打 `/api/auth/ok` |
| `mysql` | `3307` | 默认 `mysql:8.4`;本机开发用的 9.1 用 `MYSQL_IMAGE=mysql:9.1` 对齐 |
| `minio` | `9000` / `9001` | 对象存储 + 控制台 |
| `bootstrap` | — | profile `setup` 的一次性任务:建 39 张表 + 四个种子 + `db:minio:init` |

端口只绑 `127.0.0.1`;换 `APP_PORT` 要同步放行 `BETTER_AUTH_TRUSTED_ORIGINS`。VS Code 用户可以直接
「Reopen in Container」(`.devcontainer/`),仓库挂进容器、依赖放命名卷。

> 一个反直觉但必须知道的事实:**Nitro 的 `.output` 不是自包含的** —— `.output` 里的
> bundle 是按包名 import 的,所以运行镜像里必须 `pnpm install --prod`。完整口径、可覆盖变量表与踩过的坑见
> [`doc/容器化.md`](doc/容器化.md)。

---

## 环境变量

`.env.example` 是**唯一**随模板分发的 env 文件,不含真实凭据。

```bash
cp .env.example .env.local
```

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | **是** | `mysql://user:pass@host:3306/db` 或 `dm://user:pass@host:5236?schema=eg`(协议决定用哪个驱动)。`src/db/index.ts` 与 `drizzle.config.ts` 在缺失时**直接抛错** |
| `BETTER_AUTH_TRUSTED_ORIGINS` | 否 | **额外**放行的 origin,逗号分隔。代码内置 `http://localhost:3000`、`http://localhost:4811`;portless 用 `https://*.localhost`,自建域名写全量 origin。通配符只匹配单段主机名(见 `src/lib/auth.ts` 的注释) |
| `BETTER_AUTH_SECRET` | 否 | 用 `pnpm dlx @better-auth/cli secret` 生成 |
| `CAPTCHAKIT_SECRET` | 否 | **人机验证无条件开启,这是密钥不是开关**:填了(≥32 字符,`openssl rand -hex 32` 生成)就用你这把;留空则首次访问 `/api/captcha` 时自动生成 32 字节随机值并写回 `.env.local`(见 `src/lib/captcha-secret.ts`)。登录页永远显示验证码栏,提交必须带 proof token。CaptchaKit 自托管,不对接任何第三方验证码服务。口径见 `doc/后端代码导读.md` §3.1.1 |
| `MAIL_DRIVER` | 否 | **留空 = 开发态驱动**:邮箱验证链接只打到 `pnpm dev` 的终端窗口,不真发。**生产必须换成 `smtp`** |
| `SMTP_*` / `MAIL_FROM` | 否 | `smtp` 驱动才读:`SMTP_HOST` / `PORT` / `SECURE` / `USER` / `PASS` / `ALLOW_SELF_SIGNED` + `MAIL_FROM`。企业邮、Exchange、自建 Postfix 都走这条路。实现见 `src/lib/mailer.ts` |
| `MINIO_*` | 否 | 文件管理用:`MINIO_ENDPOINT` / `PORT` / `USE_SSL` / `ACCESS_KEY` / `SECRET_KEY` / `BUCKET_PUBLIC` / `BUCKET_PRIVATE` / `PUBLIC_URL`,见 `doc/文件管理.md` |
| `LOG_LEVEL` / `LOG_SILENT` / `LOG_SLOW_MS` | 否 | 默认 `info`;`LOG_SILENT=1` 全关(测试用);单个 procedure 超过 `LOG_SLOW_MS`(默认 1500)会打慢日志 |

加载优先级:`.env.local` 优先于 `.env`(dotenv 不覆盖已存在的键)。`drizzle.config.ts` 显式按 `[".env.local", ".env"]` 读取。

### `pnpm start` 不加载 `.env.local`

`pnpm dev` 用 `dotenv -e .env.local` 显式加载;`pnpm start` **不加载任何 env 文件** —— 生产的环境变量必须由平台 / 容器注入。本地验证生产产物要先 `export`:

```bash
export DATABASE_URL='mysql://user:pass@host:3306/db' BETTER_AUTH_TRUSTED_ORIGINS='https://your.domain' BETTER_AUTH_SECRET='...'
pnpm build && pnpm start
```

两种缺配置的表现(都实测过):

- **缺 `DATABASE_URL`** —— `src/db/index.ts` 在**模块导入时**就抛错,依赖库的页面(如 `/settings/menus`)会落到路由错误边界,而不是页面内那个"数据库不可用"的降级面板。
- **缺 `BETTER_AUTH_TRUSTED_ORIGINS`** —— 不算错:代码内置了两条 localhost,线上把自建域名漏进白名单时,表现是登录 POST 被拦成 `403` 并在服务端打 `Invalid origin: <origin>`(这条日志就是排查入口)。

---

## 数据库

两张 schema 文件口径不同,**不要混**:

| 文件 | 管辖 | 迁移 |
| --- | --- | --- |
| `src/db/data-base-schema.ts` | **39 张表**(25 张 `sys_*` + `demo_grid` + 13 张 `tc_*`):菜单 / 字典 / 参数 / 标签 / 标签关系 / 用户 / 会话 / 账号 / 验证 / 账号锁定 / 限流 / 部门 / 角色 / 用户-部门 / casbin 策略 / 通知 / 调度 / 日志 / 演示网格 / 文件 / 数据策略 / 数据插件 / 访客令牌 / 任务闭环 | **不进 drizzle 迁移**:只在这里声明"读写的形状",DDL 由 `scripts/create-system-tables.ts`(`pnpm db:create`)维护,列级对账靠 `pnpm db:sync:meta` |
| `src/db/schema.ts` | 走迁移的表 —— 当前只剩 demo 用的 `todos` | 由 drizzle 迁移管理(`pnpm db:generate` → `db:migrate`) |

为什么不合成一个文件:若把系统表并进 `schema.ts`,下次 `db:generate` 会生成 `CREATE TABLE`,而库里已存在 → `db:migrate` 直接 1050 报错。

库可以是 **MySQL 或达梦**:`src/db/index.ts` 按 `DATABASE_URL` 的协议(`mysql://` / `dm://`)选驱动,方言适配在 `src/db/dm/`;两者的差异与坑见 `doc/达梦支持.md`(例如达梦下 datetime 默认值必须写 `.$defaultFn(() => new Date())`,用 `defaultNow()` 会差 8 小时)。

改系统表的结构:`pnpm db:sync:meta` —— **幂等**,第二次跑必须打印「无需改动」。

加一张走迁移的表:

```ts
// src/db/schema.ts
import { int, mysqlTable, text, timestamp } from "drizzle-orm/mysql-core";

export const posts = mysqlTable("posts", {
	id: int().primaryKey().autoincrement(),
	title: text().notNull(),
	createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});
```

```bash
pnpm db:generate && pnpm db:migrate     # 或开发期直接 pnpm db:push
```

服务端用法:

```ts
import { db } from "#/db";
import { posts } from "#/db/schema";

export async function listPosts() {
	return db.select().from(posts);
}
```

`db` 是**仅服务端**模块。在 tRPC procedure 或 server function 里 import,不要从客户端组件直接引用。

---

## 关于 Better Auth

- 服务端实例:`src/lib/auth.ts`
- 客户端实例:`src/lib/auth-client.ts`(导出 `authClient`)
- 路由挂载:`src/routes/api/auth/$.ts`(GET / POST 都转发给 `auth.handler`)
- 表定义:`src/db/data-base-schema.ts` 的 `sys_user` / `sys_session` / `sys_account` / `sys_verification`

**当前是接好真库的状态**:

```ts
// src/lib/auth.ts(实际配置的骨架)
database: drizzleAdapter(db, {
	provider: "mysql",
	// better-auth 按**这里的键名**找模型(它不看 DB 表名),所以键必须写死是 user / session / account / verification
	schema: { user: sysUser, session: sysSession, account: sysAccount, verification: sysVerification },
}),
emailAndPassword: { enabled: true },
plugins: [tanstackStartCookies(), userSwitchPlugin()], // 后者是运维用的「切换用户」端点
```

已经接好的部分:

- 登录页 `/login`(在后台外壳之外):邮箱 + 密码,成功后回 `?redirect=` 的原地址;
- **整个后台都必须登录**:`routes/(main)/route.tsx` 的 `beforeLoad` 在**服务端**读会话(`auth.api.getSession` + `getRequestHeaders()`),没有就 307 到登录页并带上原地址;
- 顶栏用户菜单(姓名 / 邮箱 / 退出登录),退出后由守卫自动回登录页;
- 回归测试:`tests/better-auth.test.ts`(注册 / 登录 / 取会话 / 错密码 / 登出)。

没接的部分(**不开放自注册**,账号要先在库里建 —— 见 `AGENTS.md` 的「认证」):注册页 / 忘记密码、第三方登录(加 `socialProviders` 即可,表结构不用改)。

登录安全:人机验证**默认就是开的**(CaptchaKit 自托管,密钥没配会自动生成,见 `src/lib/captcha-secret.ts`);
开关在「系统设置 ▸ 参数管理」的参数 `login.captcha_enabled`(默认 `true`;关掉后登录接口不再要求验证码,
只剩限流 + 账号锁定兜底 —— 生产不建议关)。邮件则默认只打到终端,要真发配 `MAIL_DRIVER=smtp`(见 `src/lib/mailer.ts` 与 `.env.example`)。异常监控不在模板内置 —— 想接 Sentry 或自建告警,自己在 `lib/` 里加。

改动 adapter 时注意:better-auth 升级后字段若变了,会在**运行时**报「Model xxx not found」/「field not found」,`typecheck` 抓不到 —— 升级后请重新核对四张表的字段。具体选项以 [Better Auth 文档](https://www.better-auth.com)为准。

---

## 新增一个页面

`(main)` 是一个**无路径布局组**:它的 `route.tsx` 负责渲染侧边栏外壳,而 `(main)` 本身不出现在 URL 里。所以文件放在 `src/routes/(main)/` 下就自动带后台外壳。

```tsx
// src/routes/(main)/users.tsx  →  URL: /users
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "#/components/layout/page-header";

export const Route = createFileRoute("/(main)/users")({ component: UsersPage });

function UsersPage() {
	return (
		<div className="space-y-6">
			<PageHeader title="用户管理" description="在这里管理用户。" descriptionInline />
		</div>
	);
}
```

步骤:

1. 新建 `src/routes/(main)/<name>.tsx`
2. 跑 `pnpm generate-routes`
3. 在 `src/components/layout/nav-config.ts` 的 `NAV_NODES` 里注册菜单(支持子菜单,`icon` 用 `NAV_ICON_MAP` 里登记的 kebab-case 名)

页面骨架未定时用 `PageHeader` + `EmptyState` 拼一个占位页(模板里不再有现成的空白页)。想脱离后台外壳(如独立登录页)就放到 `src/routes/` 根下。

**改完必跑** `pnpm generate-routes && pnpm typecheck`。

---

## 新增一个 CRUD 模块

**没有通用 CRUD 套件** —— 原先的 `lib/crud/*`(mutation 套件 / Excel 套件 / 查询失效 / 列宽持久化)、`lib/validators/common.ts`、`store/use-query-params.ts` 都已在收敛重构里删掉。原因是它们把字段声明、校验与"成功后失效谁"藏进配置对象:两个字段还好,一到十几个字段、两种数据源、按页不同的失效范围,配置就开始打架,读代码的人还得在两处之间跳。

现在的做法是**照抄一个真实页面**:`src/components/modules/settings/settings-parameters-page.tsx` 是本仓最完整的一条链路,工作台 `/` 的「台账表格(完整业务页骨架)」是同一条链路的可运行示例。照它拼装:

1. **表定义** —— 系统表加在 `src/db/data-base-schema.ts`(不进迁移,DDL 走 `pnpm db:create` + `pnpm db:sync:meta`);要交给 drizzle 迁移就加在 `src/db/schema.ts`
2. **接口** —— 在 `src/integrations/trpc/routers/` 加一个域,再在 `router.ts` 注册;列表页**不需要**再写一套 keyword/status store:查询参数即组件状态
3. **权限点** —— 每个写接口都要在 `src/lib/rbac.ts` 的 `PERM_BY_PATH` 里登记 `域:资源:动作`,否则 `tests/auth.test.ts` 直接拦(读接口三选一,见 `doc/后端接口约定.md`)
4. **页面骨架** —— 复制 `settings-parameters-page.tsx` 的结构:`PageFrame` → `PageHeader`(actions 放 `RefreshButton` + 新增 `Button`)→ `StatCards` → `LedgerToolbar` + `ColumnToggle` → `Card` → `TableLoadingShell` → `DataTable` → `PaginationControl`;分页大小统一读 `usePageSize()`(`sys_para` 的 `page.size`),列偏好用 `useColumnPrefs("<页面键>", table)`
5. **表格** —— `src/lib/table.ts` 的 `useAppTable` + `createAppColumnHelper`(排序 / 筛选 / 分页 / 分组 / 列宽 / 列固定 / 行选择都内置),配 `shared/table-kit` 的 `DataTable` / `selectColumn` / `actionsColumn` / `TextCell`
6. **mutation** —— 每个动作单独一个 `useMutation(mutationOptions())`,成功后按需 `invalidateQueries`;删除走 `ConfirmDialog`;错误提示统一调 `lib/api/error.ts` 的 `toastApiError(error)`(一行完成错误归一与弹窗)
7. **详情 / Excel(可选)** —— 详情用 `shared/detail-dialog.tsx`(`DetailRow` 的 label 只给纯描述;时间放 `meta` 不放 fields);导入用 `shared/excel-import.tsx` 的 `ExcelImportDialog`,导出用 `shared/ledger-excel.ts`,写盘点只有 `lib/excel.ts` 一处

可复用的展示件都在 `src/components/modules/shared/`:表格套件 / 工具栏 / 筛选 chip / 分页 / 指标卡 / 详情弹窗 / 可拖拽树 / 权限树 / 多选 / 成员区 / 图标选择 / 列切换 / Excel 导入导出。**先看工作台**,它就是拼装说明书。

---

## 刻意留着、但业务页还没接的件

UI 原语与跨域展示件保留真实调用或工作台示例，供派生项目参考；非 UI 工具按实际调用清理。

刻意保留、业务页尚未接的是下面一组(其余件都有调用方):

| 件 | 位置 | 说明 |
| --- | --- | --- |
| 列类型 + 写盘点 | `src/lib/excel.ts` | 导出列类型与 `writeSheet` / `cellText`(全仓唯一写盘点) |
| 台账导出 | `src/components/modules/shared/ledger-excel.ts` | 拉全量 → 行映射 → XLSX → 下载(已经 `shared/excel-actions` 接到四个台账页) |
| 导入弹窗 | `src/components/modules/shared/excel-import.tsx` | 解析 → 校验 → 提交 mutation 的对话框(xlsx 重依赖,按需动态加载) |
| 运行示例 | 工作台 `/` 页 | 三者的最小可用示例 |

> 曾经同列表的 `hooks/use-dict.ts`(字典读取器)已在收敛轮删除:它的过程级真源 `dict.byCode` 仍在(服务端按编码取值 + 软删语义的测试依赖),客户端 hook 却没有任何页面在读 —— 派生项目要做字典下拉时,从 `trpc.dict.byCode.queryOptions({ code })` 起步即可。

**约定**:新增可复用件时,**要么给它一个真实调用方,要么在工作台 UI 示例里展示,要么登记进本节** —— 三者都不做,它会被下一轮清理当成死代码删掉。

---

## 系统设置模块

`/settings/*` **十二个页面,全部读写真实数据库**,没有占位页、没有 mock:

| 页面 | 路由 | 数据来源 | 演示的骨架 |
| --- | --- | --- | --- |
| 用户管理 | `/settings/users` | `sys_user` + `sys_user_dept` + `sys_casbin_rule`(`g` 行) | 台账 CRUD + 角色 / 部门分配 |
| 访客管理(用户管理页的 Tab) | `/settings/users` | `sys_share_token` | 外链免登令牌:签发 / 改范围 / 启停 / 删除,见 `doc/外链分享.md` |
| 角色管理 | `/settings/roles` | `sys_role` + `sys_casbin_rule`(`p` / `g` 行) | 台账 CRUD + 权限树勾选(`PermissionTree`) |
| 部门管理 | `/settings/departments` | `sys_dept` + `sys_user_dept` | 可拖拽树 + 成员管理 |
| 菜单管理 | `/settings/menus` | `sys_menu` | 可排序树 + 右侧编辑表单(改完即时生效) |
| 字典管理 | `/settings/dictionary` | `sys_dict` | 字典 CRUD + 条目编辑 |
| 参数管理 | `/settings/parameters` | `sys_para` | 按类型码(整数 / 开关 / 文本 / JSON)校验的参数表单;详情 / 编辑 / 删除 |
| 标签管理 | `/settings/tags` | `sys_tag` + `sys_tag_relation` | 主表 + 子表条目弹窗 + 拖拽树 |
| 审计日志 | `/settings/logs` | `sys_log` | 只读台账 + 详情(带筛选与导出) |
| 文件管理 | `/settings/files` | `sys_file` + MinIO | 上传 / 重命名 / 删除 / 预览(预签名地址;图片内联、PDF / 文本走 `react-pdf` 懒加载) |
| 数据范围 | `/settings/data-scope` | `sys_data_policy` + `sys_data_plugin` | 行级规则 CRUD + 三态状态流(启用 → 上线 → 停用)+ 行内「预览」试算 |
| 值域插件 | `/settings/data-plugins` | `sys_data_plugin` | 插件 CRUD + 内联编辑输出值 + 试跑(看当前用户解析出什么) |
| 个人资料 | `/settings/profile` | `sys_user` + `sys_user_dept` + `sys_role`(自限一行) | 只读自己 + 改姓名 / 改密码 / 邮箱验证与换邮箱(入口在顶栏) |

权限点目录(角色授权要勾的那棵树)来自 `sys_menu` 的真实数据(`menu.list` 回 `{ rows, perms }`),**不再由前端 `NAV_NODES` 派生**;菜单表为空时权限体系整体不启用(空表 = 这项能力没开)。页面级权限(哪些 URL 可见)与接口级权限(哪些 procedure 可调)是两层,见 `doc/rbac-权限模型.md`。

---

## 任务闭环模块 (业务状态机示范)

`/task-close/*` 是模板内置的**复杂流程与状态机示范模块**,全闭环读写真库(13 张 `tc_*` 表):

| 页面 | 路由 | 数据来源 | 说明 |
| --- | --- | --- | --- |
| 我的任务 | `/task-close` | `tc_task` + `tc_member` | 服务端分页卡片列表 + 状态/优先级多维筛选 + 新建任务向导 |
| 任务详情 | `/task-close/$taskId` | `tc_task` + `tc_action` + `tc_log` + `tc_comment` | 核心闭环页:流程状态脊骨架 + 轮到你了待办条 + 评论讨论 + 活动日志时间轴 + 动态动作矩阵 |
| 流程模板 | `/task-close/workflows` | `tc_workflow` | 流程状态机可视化编辑器:状态节点 + 转移边(直接改/审批动作)+ who 角色权限协议 |

> 结构化填报、批次与汇总见 [`doc/task-forms.md`](doc/task-forms.md)；通知、调度与 Worker 见 [`doc/通知中心.md`](doc/通知中心.md)。
> `doc/任务插件化设计.md` 是**已废止的历史草案**（就地作答写 payload），不要照此实现。

---

## 派生新项目

模板自带 `new-project.sh`(在仓库根目录),按下面的方式派生一个干净的新项目:

```bash
./new-project.sh                             # 全交互引导:自动询问项目名称并分组勾选所需模块
./new-project.sh my-app                      # 派生到 ../my-app(交互选择模块)
./new-project.sh my-app --into ~/src         # 指定父目录
./new-project.sh my-app --title '巡检系统'    # 中文标题 + ASCII 包名
./new-project.sh my-app --port 3001          # 自定义本地开发端口(避免多项目冲突)
./new-project.sh my-app --minimal            # 只要核心(登录 / 外壳 / 数据库 / 权限判定 / UI 原语)
./new-project.sh my-app --all                # 全要(包含所有业务与演示模块)
./new-project.sh my-app --modules task-close,notice  # 按模块定制(仅按需拷贝对应文件)
```

脚本会尝试安装依赖、生成路由、创建独立 MySQL 数据库并运行种子；初始化失败会保留已生成的工程并返回非零状态。现有 `-i` / `--install` 参数只是兼容旧命令，不改变这一行为。

**项目标题**(网页标题 + 侧边栏品牌)的唯一真源是 `package.json` 的 `app` 字段:

```json
"app": { "title": "管理后台", "subtitle": "TanStack Start 模板" }
```

`--title` 会写进 `app.title`(不给就用你输入的项目名);包名 `name` 仍是清洗后的小写 ASCII,
两者互不影响 —— 读法只有一处(`src/lib/app-meta.ts`),消费方是 `routes/__root.tsx` 的
`head()`(标签页标题)与 `layout/sidebar.tsx` 的品牌标题区。改标题只改这一个字段。

### 模块化按需拷贝与交互式勾选

**不是每个项目都要所有功能模块**。派生脚本采用按需勾选与按需文件拷贝：
1. **交互式分组与建议**：终端按「业务流程」、「系统增强」、「演示示例」分组展示模块，附带明确的业务场景与选配建议（如明确提示何时不需要添加特定模块，保持新工程轻量纯净）；
2. **复制阶段跳过未选文件**：仅拷贝所需模块的专属文件，不必要的文件物理排除；
3. **共享注册点联动清理**：菜单、路由注册、权限点、建表语句、package.json 脚本同步清理，不留死代码；
4. **端口与数据库**：可用 `--port` 指定端口；只有 MySQL 地址能安全改为独立库名时才继承，否则需要手动配置独立数据库。

- 清单在仓库根 **`features.json`**:每个功能的 `paths`(删哪些文件)/`rules`(注册点怎么改)/
  `requires`(依赖)都写在那里;
- **依赖自动补齐**:选了 A 而 A 依赖 B,会一起带上并打印「自动补齐依赖:…」;
- **规则必须命中**:模板重构后规则失配 ⇒ 派生**当场中止**(而不是产出一个跑不起来的项目);
  裁完还会扫一遍**悬空引用**(代码里不该再出现被删域的 import / 标识符);
- 裁剪由 `scripts/prune-features.mjs` 执行(纯 node,零依赖),它也随派生一起被删掉 ——
  新项目里不留"模板怎么裁"的机器;
- **裁完必跑** `pnpm install && pnpm generate-routes && pnpm typecheck`:
  `routeTree.gen.ts` 是生成物,删过路由文件必须重建(脚本的收尾提示里也写了)。

**已接线的功能**:任务闭环 / 框架能力 + 演示页 / 工作台 + UI 示例 / 通知中心 / 测试套件。
不选工作台时，`/` 仍保留基础欢迎页，登录后可以从侧边栏进入功能页面。
其余能力(文件管理 / 审计日志 / 数据权限 / 系统设置的十二页 / 达梦 / 容器化 / Excel)
当前**一律保留** —— `features.json` 的 `pending` 里列了它们与各自的接线要点(共用表、
跨切面中间件、页面族),要接的时候照着前面的功能加一段清单即可。

它做的事(都是纯文件操作,没有代码生成):

| 步骤 | 行为 |
| --- | --- |
| 名称规范化 | `My Cool APP!!` → `my-cool-app`(会提示已规范化) |
| 目标已存在 | 报 `Error: 目标已存在: <path>` 并 exit 1,**绝不覆盖** |
| 同名校验 | 只在**同一父目录**下才拦你(比较的是绝对路径,换个 `--into` 就能同名) |
| 复制 | rsync 主路径,失败回落到 `find`;排除 `node_modules` / `.git` / `.output` / `dist` / `.vite` / `.tanstack` / `.turbo` / `coverage` / `new-project.sh` / 真实 `.env*` |
| 带走的东西 | `.env.example`(**唯一的 env 文件**)、`pnpm-lock.yaml`(让 `pnpm install` 命中锁) |
| 改写 | `package.json` 的 `name`(包名,小写 ASCII)与 `app.title`(展示标题,**你输入的原样**,中文也行)、`.cta.json` 的 `projectName` |
| 生成 env | 优先继承模板 `.env.local` 的本地配置并更换密钥;仅在 MySQL 库名可安全隔离时继承数据库连接,否则清空 `DATABASE_URL` 待手动配置;没有本地配置时使用 `.env.example`。文件权限 600 |
| 初始化 | 安装依赖、生成路由并尝试初始化独立 MySQL 库;失败时保留工程文件并返回非零状态。达梦需手动配置独立 schema,按 `doc/达梦支持.md` 初始化 |
| 修权限 | 模板里 600 的文件归一成 644(否则新项目里 Git 会不认识) |

`--strict` 的两种边界:模板有未提交改动 → 列出脏文件并中止;模板**不是 git 仓库** → 打印「无从判断'未提交改动',本次已跳过该检查」而不是静默跳过。

不想用脚本也行:`cp -r` 整个目录 → 改 `package.json` 的 `name` → 删掉 `.env.local`。模板没有任何"必须由脚本生成"的东西。

### 派生时删什么

模板自带的三个"展示用"入口,新业务上线前可整块删掉:

```text
src/components/modules/workbench/    # 工作台:入口页 + UI 示例(ui-gallery / ui-gallery-table / workbench-tagging)
src/routes/(main)/demo/              # 框架能力样例页
src/hooks/demo.form-context.ts  +  src/hooks/demo.form.tsx
src/lib/demo-store.ts
```

**顺序很重要**,删完记得处理连带:

1. `src/routes/__root.tsx`:去掉 devtools `plugins` 数组里与 demo 相关的项(本模板当前只有 Router 与 Query 两项,无需改动)
2. **`@tanstack/react-start` 的类型增强不用管** —— `(main)/route.tsx` 与 `integrations/tanstack-query/root-provider.tsx` 都引用了它,删掉整个 demo 目录也不会让 `server: { handlers }` 报 `'server' does not exist in type ...`
3. `src/components/layout/nav-config.ts`:把 `NAV_NODES` 里「组件展示 / 框架能力」两枝删掉
4. **品牌名与页面标题**:改 `package.json` 的 `app.title` / `app.subtitle` 一处即可 ——
   浏览器标签页标题(`__root.tsx` 的 `head()`)与侧边栏顶部品牌区(`sidebar.tsx` 的 `<SidebarHeader>`)都读它
   (读法见 `src/lib/app-meta.ts`;收起态只剩图标,名字走原生 `title`);`topbar.tsx` 不用动,它接的是真实会话用户
5. `src/lib/constants.ts`:把 `THEME_STORAGE_KEY` 改成自己的名字 —— 多个项目都用 `localhost:3000` 时同源共用 localStorage,主题会互相串
6. `src/routes/__root.tsx`:改 `head()` 里的 `description` 等元信息(`title` 已由 `app.title` 驱动,不用改)

然后:

```bash
pnpm generate-routes
pnpm typecheck
pnpm check
```

`src/components/modules/settings/` 与 `src/routes/(main)/settings/` **建议保留** —— 它们是可直接改造成新业务的完整 CRUD 骨架。

---

## 后续设计

任务闭环插件化已废止（作答写进 `tc_task.payload` 与独立结构化填报冲突）；现行口径见
[任务填报设计](doc/task-forms.md)。旧草案保留在 [任务插件化设计](doc/任务插件化设计.md) 供追溯。

---

## 延伸阅读

项目内文档:

- `doc/后端代码导读.md` —— **后端代码怎么读**:目录结构 → 设计理念 → 公共路由与对外入口 → tRPC 中间件链 → 数据层 → lib 模块地图 + 三条阅读路线(要通读后端就从这份开始)
- `doc/界面约定.md` —— **版式骨架 + 目录与文件角色约定、公共复用件与封装边界(必读)**
- `doc/后端接口约定.md` —— 接口口径:一件只允许一个实现、批与单、列表四种形状、权限与审计、自检清单
- `doc/rbac-权限模型.md` —— 菜单可见 → 页面级拦截 → 接口级权限码两层,含 casbin 策略表口径与排查 SQL
- `doc/数据库与认证.md` —— 系统表 / 迁移口径 / Better Auth 接线
- `doc/达梦支持.md` —— 达梦与 MySQL 的差异、坑与验证命令
- `doc/审计日志.md` —— 日志覆盖率、事件字典、30 分钟清理
- `doc/通知中心.md` · `doc/文件管理.md` —— 通知与 MinIO 文件的能力边界
- `doc/已知陷阱.md` —— 踩过的坑(前端 bundle 混入服务端模块、`not in` 的 NULL 三值逻辑、错误终态写死 500…)
- `doc/数据权限.md` —— 行级数据范围 + 值域插件:表结构、三态状态流、内置插件清单与试算口径
- `doc/task-close.md` —— 任务闭环业务示例:三页、`tc_*` 表与 `who` 协议、状态机与活动日志
- `doc/task-forms.md` —— 结构化填报:模板版本、草稿 / 提交 / 退回、批次与汇总、受限 Excel
- `doc/任务闭环设计详解.md` —— 按 13 张 `tc_*` 表展开的设计架构与实现细节(给要改这个模块的人)
- `doc/任务插件化设计.md` —— **已废止的历史草案**(就地作答写 `tc_task.payload`),仅供追溯,不要照此实现
- `doc/容器化.md` —— Dockerfile 四个目标、compose 变量表、Dev Container,以及「`.output` 不自包含」这类容器专坑
- `doc/测试数据/README.md` —— 六个种子脚本与演示账号
- `AGENTS.md` —— 面向 AI 编码代理的**规矩摘要 + 文档索引**(精简版,约 7KB)
- `DESIGN.md` —— 视觉规范(品牌 7 色 + 点缀 6 色相 + 间距 / 圆角 / 阴影 / 动效原语清单)

外部资料:

- [TanStack Start](https://tanstack.com/start) · [TanStack Router](https://tanstack.com/router) · [TanStack Table v9](https://tanstack.com/table)
- [tRPC](https://trpc.io/) · [Drizzle ORM](https://orm.drizzle.team/) · [Better Auth](https://www.better-auth.com)
- [Tailwind CSS v4](https://tailwindcss.com/) · [Biome](https://biomejs.dev/) · [Nitro 部署](https://v3.nitro.build/deploy)
