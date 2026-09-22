# start-tpl —— TanStack Start 后台模板

一个人自用的**后台管理系统模板**:React 19 + TanStack Start,自带后台外壳、47 个 UI 原语、23 个跨域展示件、CRUD 套件,以及 tRPC + Drizzle + Better Auth 的完整接线。

模板里**只保留一个真实业务模块**(系统设置),其余业务代码已清空 —— 剩下的每一块都是"可以直接搬进新项目"的能力。所有组件都有**活文档**:工作台 `/` 的 UI 示例逐个给出真实渲染的例子(受控的都给好了 useState),改了组件页面立刻反映,文档不会过期。

技术栈:React 19 · TanStack Start / Router / Query / Form / Table **v9** · tRPC **v11** · Drizzle ORM + MySQL · Better Auth · Tailwind CSS **v4** · Biome · Vite 8 · TypeScript 6

环境要求:Node ≥ 20.19,pnpm 11(`packageManager` 已固定为 `pnpm@11.23.0`)。

---

## 快速开始

```bash
pnpm install
cp .env.example .env.local     # 然后按需填写 DATABASE_URL 等
pnpm dev                       # http://localhost:3000
```

`pnpm dev` 固定监听 **3000** 端口,并通过 `NODE_OPTIONS=--import ./instrument.server.mjs` 预加载服务端 Sentry 初始化。未配置 `VITE_SENTRY_DSN` 时会打印一条 `VITE_SENTRY_DSN is not defined. Sentry is not running.`,属于正常提示。

> **组件示例都在工作台 `/`**。它自己也读菜单表,所以要先把 `.env.local` 的 `DATABASE_URL` 配好再 `pnpm dev`。
> `/settings` 的菜单 / 字段 / 参数三页是**真读库**的,没配 `DATABASE_URL` 会落到错误边界。

---

## 打开后先看这四块

| 入口 | 内容 |
| --- | --- |
| **工作台** `/` | 模板入口页:上手四件事、目录职责速查、派生时删什么的清单 |
| **UI 组件示例** | ★ 就在工作台 `/` 页里:43 个原语的最小可用例子 + 台账表格实战示例 |
| **框架能力** `/demo/*` | 9 个可运行样例:tRPC、Query、表单、表格、Drizzle、Auth、Store、Sentry |
| **系统设置** `/settings/*` | ★ 唯一保留的真实业务模块,7 个页面:4 页真实数据 + 3 页待实现占位 |

菜单树是**库 + 兜底**双源:`sys_menu` 表有数据时以表为准,为空则退回 `src/components/layout/nav-config.ts` 的 `NAV_NODES`。改 `NAV_NODES` 后侧边栏、面包屑、模块概览、工作台四处会一起变。

---

## 目录结构

```
src/
├── routes/                       # 文件路由,文件名即 URL
│   ├── __root.tsx                # 根布局:HTML 骨架、主题引导脚本、404、devtools
│   ├── (main)/                   # 无路径布局组(URL 中不出现 "(main)")
│   │   ├── route.tsx             # 后台外壳:NavPermissionsProvider + SidebarProvider + 菜单预取
│   │   ├── index.tsx             # 工作台
│   │   ├── blank.tsx             # 空白页占位(StubPage)
│   │   ├── demo/                 # 框架能力样例(9 页;同上)
│   │   └── settings/             # 系统设置(7 页;真实业务,派生时从这里改)
│   ├── api.trpc.$.tsx            # tRPC 请求入口 /api/trpc/*
│   └── api/auth/$.ts             # Better Auth 请求入口 /api/auth/*
├── components/
│   ├── ui/                       # 44 个叶子原语(shadcn 风格 + 自研组合控件)
│   ├── layout/                   # 后台外壳:sidebar / sidebar-header / topbar / 面包屑 / 页头 / 空态 / 占位页 + nav-config / nav-menu / nav-data
│   ├── modules/shared/           # 23 个领域无关展示件(表格套件 / 工具栏 / 图表 / 导入 / 树 / 标签…)
│   ├── modules/workbench/        # 工作台
│   └── modules/settings/         # 系统设置 7 个页面
├── lib/
│   ├── crud/                     # CRUD 套件:mutation / Excel / 查询失效 / 表格辅助 hook
│   ├── api/error.ts              # ApiError / toApiError / toErrorMessage
│   ├── validators/common.ts      # 复用的 zod 片段
│   ├── table.ts                  # TanStack Table v9 的 app hook(useAppTable + useRowSelection)
│   ├── excel.ts                  # Excel 列类型 + 唯一写盘点 writeSheet / cellText
│   ├── mock-table.ts             # 内存表(增删改 + 批量替换),演示期的"假后端"
│   ├── menu-detail-path.ts       # 参数化菜单路径约定(path 里嵌记录 id)
│   ├── sys-para.ts               # 系统参数读写 + 默认值
│   ├── para-spec.ts              # 参数类型码 / 校验(客户端可 import)
│   ├── ids.ts / time.ts / format.ts / multi-value.ts / logger.ts
│   └── utils.ts                  # cn()
├── store/use-query-params.ts     # createQueryParamsStore —— 列表页查询参数状态工厂
├── db/
│   ├── index.ts                  # drizzle(mysql2) 实例,导出 db
│   ├── schema.ts                 # 迁移管辖的表:Better Auth 四表 + todos 示例
│   └── data-base-schema.ts       # 不走迁移的五张系统表(sys_menu / sys_dict / sys_para / sys_tag / sys_tag_relation)
├── integrations/
│   ├── trpc/                     # init.ts / router.ts / react.ts + routers/{menu,dict,config}
│   └── tanstack-query/           # root-provider.tsx(getContext + TRPCProvider)
├── hooks/                        # use-dict / use-stable-keys / demo.form*
├── mocks/                        # 演示期数据:settings(用户/组/角色/权限树)、tags、shared、dicts
├── router.tsx                    # ★ createRouter + SSR Query 集成(按约定路径被插件加载,别删)
├── routeTree.gen.ts              # 生成物,不要手改
└── styles.css                    # Tailwind v4 入口 + 设计 token
```

`src/lib/crud/`、`src/lib/validators/`、`src/store/` 目前**只有定义没有调用方**(系统设置模块的前四个页面走 `mocks/` 而不是真后端)。文件头的注释是它们最准确的用法文档 —— 接第一个真实 CRUD 模块时先读那些注释,见下文「新增一个 CRUD 模块」。

---

## 组件层:三层分工

| 层 | 位置 | 放什么 | 判断标准 |
| --- | --- | --- | --- |
| **叶子原语** | `components/ui/` | Button / Card / Table / SearchSelect / BadgeList… | 接口里**不含任何业务概念**,能直接搬进任何新项目 |
| **跨域展示件** | `components/modules/shared/` | DataTable / ReadonlyTable / LedgerToolbar / FilterChipBar / MiniChart / ExcelImportDialog / SortableTree / DetailProfile… | 有**版式或行为约定**,但字段声明与数据订阅仍由调用方给 |
| **组合块与业务** | `components/modules/<域>/` | 详情页组装、导入向导、页面专属件 | 离开这个业务就没有意义 |

`shared/` 里的东西**共享版式、不共享字段** —— 列定义、行类型、增删改写操作逐页手写。这是刻意的:**不做声明式驱动的通用 CRUD**,因为那类抽象在字段一多、校验一复杂时就开始打架。

每个展示件的用途、props 与真实例子都在工作台 `/` 的 UI 示例里,不用翻源码。

---

## 设计系统

设计规范见 **`DESIGN.md`**(Inspired by Airtable:白底画布 + 深海军蓝文字 + Airtable Blue 强调色)。`src/styles.css` 的 token 层是它的实现 —— **改视觉先改 token,不要逐个组件改色值**。

品牌色 → 语义 token 的映射(`DESIGN.md` §2 的 7 个角色):

| `DESIGN.md` 角色 | 值 | 本模板的语义 token |
| --- | --- | --- |
| background | `#ffffff` | `--background` / `--popover` / `--sidebar` |
| foreground | `#181d26` | `--foreground` / `--card-foreground` |
| accent(Airtable Blue) | `#1b61c9` | `--primary` / `--ring` / `--sidebar-primary` |
| surface | `#f8fafc` | `--card` / `--muted` / `--secondary` / `--accent` |
| muted(次要文字) | `#333333` | `--muted-foreground` |
| border | `#e0e2e6` | `--border` / `--input` / `--sidebar-border` |
| accent-secondary(Success) | `#006400` | `--success` / `--success-fg` |

组件侧继续用工具类(`bg-primary` / `text-foreground` / `border-border`),不要写死 hex。

**规范未覆盖、但功能上必需的色**(不是品牌色):`--warn-*` / `--danger-*`(规范没有警示色与危险色,但状态徽章、表单校验需要)、`--destructive`、`--chart-1..5`。改这些之前先读 `DESIGN.md` §10。

### 点缀色谱 —— 6 个低饱和色相

只有一条蓝强调色的后台在长列表里"能看但不鲜活"。所以补了一组点缀色,但**不是**加高饱和色:
全部压在 oklch chroma 0.086–0.135(约 9%–13% 彩度,比 Material 鲜艳档低一半以上)。

| 色相 | 用途 |
| --- | --- |
| `blue` | 主 CTA、工作台 |
| `violet` | 组件展示 / 分类标签 |
| `teal` | 框架能力 / 次级指标 |
| `amber` | 系统设置 / 提醒类计数 |
| `rose` | 停用类、需留意但不告警的计数 |
| `emerald` | 在线状态、可用性 |

**颜色在这里是导航线索,不是装饰**:一级模块各认一色 —— 侧边栏图标块 → 面包屑胶囊 →
页头强调条 → 工作台入口卡,**四处同色**;同一张表里不同口径的指标卡用不同色相区分。

每个色相五个角色,定义在 `src/styles.css` 的「点缀色谱」段:

| 角色 | token | 用在哪 |
| --- | --- | --- |
| 实体 | `--hue-X` | 图标实心块 / 小圆点 / 标记条 / 进度条 |
| 文字 | `--hue-X-fg` | 浅底上的文字与图标(保证 4.5:1) |
| 软底 | `--hue-X-soft` | 选中行底色 / 胶囊 / 图标浅块 |
| 描边 | `--hue-X-line` | 细边框 / 分隔 |
| 反白前景 | `--hue-X-on` | 压在实体块上的文字(深色模式自动翻转) |

> **色相 → 类名的映射只有一份**:`src/styles.css` 的 `@theme inline`(`--color-hue-X` 一族)。
> 加色相改三处(`:root` / `.dark` / `@theme inline`)—— 漏了第三步工具类不会生成,且不会报错。
> **Tailwind 只扫描字面量类名**,不能写 `bg-hue-${tone}-soft` —— 所有按色相取类名的地方必须查那张表。

`BadgeList`(表格多值单元格与标签的统一渲染件)的配色同理:默认 `color="brand"`,色板全部取自语义 token;
`rainbow` / `ocean` / `forest` / `sunset` / `lavender` / `stone` 是**分类色板**,
定义在 `ui/badge-list.tsx` 的 `BADGE_THEMES` —— 已换成上面的点缀色 token(原先用 Tailwind 默认的
`*-100 / *-700`,彩度 25%–40%,铺一屏标签会显得"亮、吵")。**改那一处 = 全站标签 / 筛选 / 徽章配色一次性统一。**
另有 `color="stable"`:按值稳定哈希选色,同一份数据永远同一套颜色(也避免了 `Math.random()` 造成的 SSR 水合不一致)。

几处实现要点:

- **字体**(§3):`--font-sans` / `--font-heading` 在 `styles.css` 的 `@theme inline` 里,加载不到时落到系统栈 —— **fallback 必须保留**。换字体只改那两行。
- **字距**(§4):`body` 正向 `0.08px`;标题负向;按钮与 label `0.02em`;全大写 `0.08em`。写在 `@layer base`,组件里的 `tracking-*` 会覆盖它。
- **阴影**(§6):`--shadow-card` / `--shadow-soft` / `--shadow-glow`。不要写厚重纯黑阴影。
  抬升用 **`--af-raise-1|2|3`**(静置 / 悬停 / 浮起),`shadow-(--af-raise-1)`;hover 只换档位 + 边框加深,**不做位移**。
- **动效**(§7):统一 `--ease-brand`,时长三档 `--t-fast|base|slow`(120 / 180 / 260ms);`prefers-reduced-motion` 下全部复位。
  **新增动效前先查 `DESIGN.md` §7.1 的「现成动效原语」表** —— 页面进场 / 交错入场 / 脉冲 / 呼吸 / 图标换位 / 折叠展开都已经有了,不要每次现搓 keyframes。
- **圆角**(§5):**刻意不覆盖 Tailwind 的 `--radius-*`** —— 它的默认阶恰好就是规范要的档位(`rounded-lg` 8px / `rounded-xl` 12px / `rounded-2xl` 16px / `rounded-3xl` 24px)。覆盖会让全部组件圆角一起漂移。
- **深色模式**:`DESIGN.md` 只规定浅色。`.dark` 是用品牌色经 `color-mix` 推导出的对偶值,不新增色字面量。加新 token 时**记得同时补 `.dark`**(点缀色的实体色在深色下要提亮,否则深底上看不见)。

---

## 可用脚本

| 命令 | 实际执行 | 说明 |
| --- | --- | --- |
| `pnpm dev` | `dotenv -e .env.local -- sh -c "NODE_OPTIONS='--import ./instrument.server.mjs' vite dev --port 3000"` | 开发服务器,固定 3000 端口 |
| `pnpm build` | `vite build && cp instrument.server.mjs .output/server` | 产出 Nitro Node 服务到 `.output/` |
| `pnpm start` | `node --import ./.output/server/instrument.server.mjs .output/server/index.mjs` | 运行生产产物,需先 `pnpm build` |
| `pnpm preview` | `vite preview` | Vite 自带预览。产物是 Nitro 服务,验证生产请用 `build && start` |
| `pnpm typecheck` | `tsc --noEmit` | 类型检查,只报告不写文件 |
| `pnpm check` | `biome check --write .` | 格式化 + lint + 整理 import,**会写回文件** |
| `pnpm lint` / `pnpm format` | `biome lint/format --write .` | 只跑其中一项 |
| `pnpm generate-routes` | `tsr generate` | 扫描 `src/routes/` 重新生成 `routeTree.gen.ts` |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:pull` / `db:studio` | drizzle-kit | 迁移与可视化 |
| `pnpm db:seed:menus` | `tsx scripts/seed-menus.ts` | 把 `NAV_NODES` 写进 `sys_menu`(只补不覆盖) |
| `pnpm db:seed:dicts` | `tsx scripts/seed-dicts.ts` | 示例字典种子(只补不覆盖) |
| `pnpm db:create` | `tsx scripts/create-system-tables.ts` | 建五张系统设置表(幂等 `create table if not exists`,建完顺带对齐列注释 / 索引名) |
| `pnpm db:sync:meta` | `tsx scripts/sync-table-meta.ts` | 只对齐列注释与索引名(老库升级用,幂等) |
| `pnpm db:seed:paras` | `tsx scripts/seed-paras.ts` | 把 `PARA_DEFAULTS` 写进 `sys_para`(只补不覆盖) |

`typecheck` + `check` + `generate-routes` 是最重要的三条自检命令。注意 `check` / `lint` / `format` 都带 `--write`。

---

## 环境变量

`.env.example` 是**唯一**随模板分发的 env 文件,不含真实凭据。

```bash
cp .env.example .env.local
```

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | **是** | MySQL 连接串。`src/db/index.ts` 与 `drizzle.config.ts` 在缺失时**直接抛错** |
| `BETTER_AUTH_URL` | 否 | 默认 `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | 否 | 用 `pnpm dlx @better-auth/cli secret` 生成 |
| `VITE_SENTRY_DSN` | 否 | 留空则不启用 Sentry |

加载优先级:`.env.local` 优先于 `.env`(dotenv 不覆盖已存在的键)。`drizzle.config.ts` 显式按 `[".env.local", ".env"]` 读取。

### `pnpm start` 不加载 `.env.local`

`pnpm dev` 用 `dotenv -e .env.local` 显式加载;`pnpm start` **不加载任何 env 文件** —— 生产的环境变量必须由平台 / 容器注入。本地验证生产产物要先 `export`:

```bash
export DATABASE_URL='mysql://user:pass@host:3306/db' BETTER_AUTH_URL='https://your.domain' BETTER_AUTH_SECRET='...'
pnpm build && pnpm start
```

两种缺配置的表现(都实测过):

- **缺 `DATABASE_URL`** —— `src/db/index.ts` 在**模块导入时**就抛错,依赖库的页面(如 `/settings/menus`)会落到路由错误边界,而不是页面内那个"数据库不可用"的降级面板。
- **缺 `BETTER_AUTH_URL`** —— Better Auth 首次请求时打印 `Base URL is not set` 警告;baseURL 会改为从请求头推导,回调和重定向可能不正确。生产务必显式设置。

---

## 数据库

两张 schema 文件口径不同,**不要混**:

| 文件 | 管辖 | 迁移 |
| --- | --- | --- |
| `src/db/schema.ts` | Better Auth 四表(`user` / `session` / `account` / `verification`)+ `todos` 示例表 | 由 drizzle 迁移管理(`pnpm db:generate` → `db:migrate`) |
| `src/db/data-base-schema.ts` | `sys_menu` / `sys_dict` / `sys_para` / `sys_tag` / `sys_tag_relation` | **不进迁移**:只在这里声明"读写的形状",DDL 由 `scripts/create-system-tables.ts`(`pnpm db:create`)维护 |

为什么不合成一个文件:若把系统三表并进 `schema.ts`,下次 `db:generate` 会生成 `CREATE TABLE`,而库里已存在 → `db:migrate` 直接 1050 报错。

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

**当前 `src/lib/auth.ts` 没有配置数据库**,处于无状态模式,只启用了邮箱密码登录和 `tanstackStartCookies` 插件。顶栏用户区(`src/components/layout/topbar.tsx`)里 `username` 是占位常量,`handleSignOut` 只打了一条 `console.warn`,登录态尚未接通。

要持久化用户,接上 MySQL(本模板是 drizzle + mysql2,不是 `pg`):

```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";

export const auth = betterAuth({
	database: drizzleAdapter(db, { provider: "mysql" }),
	emailAndPassword: { enabled: true },
	plugins: [tanstackStartCookies()],
});
```

Better Auth 需要 `user` / `session` / `account` / `verification` 四张表 —— **本模板已把它们定义在 `src/db/schema.ts`**,直接 `pnpm db:push` 即可。具体选项以 [Better Auth 文档](https://www.better-auth.com)为准。

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

页面骨架未定时用 `StubPage` 占位(`src/routes/(main)/blank.tsx` 是范例);多个 tab 的占位用 `TabbedStubPage`。想脱离后台外壳(如独立登录页)就放到 `src/routes/` 根下。

**改完必跑** `pnpm generate-routes && pnpm typecheck`。

---

## 新增一个 CRUD 模块

`src/lib/crud/` 提供四个文件:

| 文件 | 导出 | 作用 |
| --- | --- | --- |
| `use-crud-mutations.ts` | `useCrudMutations`、`toastApiError` | 一次拿到 create / update / delete / deleteMany 四个 mutation,成功后按命名空间前缀失效查询 |
| `use-crud-excel.ts` | `useCrudExcel` | 封装导出(拉全量 → 行映射 → XLSX → 下载)与导入(解析 → 校验 → 调 import mutation),自带 toast |
| `invalidate.ts` | `invalidateAll` | 按 tRPC 命名空间前缀失效该命名空间下所有 query |
| `table-helpers.ts` | `useDebouncedValue`、`usePersistentColumnSizing`、`useRefresh` | 搜索防抖、列宽拖拽并持久化、刷新按钮跳过缓存 |

配套展示件在 `src/components/modules/shared/`:`DataTable` / `selectColumn` / `actionsColumn` / `TableLoadingShell` / `TextCell` / `SortableTree`(菜单与标签两页共用的可拖拽树) / `LedgerToolbar` / `FilterChipBar` / `PaginationControl` / `StatCards` / `TagBadges` / `FormKit` / `IconPicker` / `ExcelImportDialog`。**先看工作台里那张「台账表格(完整业务页骨架)」**,它就是拼装说明书。

典型组装顺序:

1. **数据层** —— 在 `src/integrations/trpc/router.ts` 加一个命名空间,含 `list` / `stats` / `getById` / `create` / `update` / `delete` / `deleteMany`
2. **表定义** —— `src/db/schema.ts` 加表,`pnpm db:push`
3. **查询参数 store** —— 用 `createQueryParamsStore` 建模块自己的实例:

   ```ts
   import { createQueryParamsStore } from "#/store/use-query-params";
   export const useUserParams = createQueryParamsStore({ keyword: "", status: "" });
   ```

   交互约定:输入框改 `setDraft` / `patchDraft`,点"搜索"调 `commit`,`reset` 清空。只有 `committed` 才用来发请求。

4. **mutation** —— 接上套件(四个 procedure **全部必填** —— 内部为满足 Rules of Hooks 在顶层无条件展开四个 `useMutation`):

   ```tsx
   const trpc = useTRPC();
   const mut = useCrudMutations({
     trpc,
     procedures: { create: trpc.user.create, update: trpc.user.update, delete: trpc.user.delete, deleteMany: trpc.user.deleteMany },
     invalidateKeys: ["user"],
     messages: { createSuccess: "用户已创建" },
     hooks: { onAfterCreate: () => setOpen(false) },
   });
   ```

5. **表格** —— 用 `src/lib/table.ts` 的 v9 app hook(排序 / 筛选 / 分页 / 分组 / 列宽 / 列固定 / 行选择都内置):

   ```ts
   import { useAppTable, createAppColumnHelper } from "#/lib/table";
   import { DataTable, selectColumn, actionsColumn } from "#/components/modules/shared/table-kit";
   ```

   工作台的「台账表格(完整业务页骨架)」就是可直接照抄的骨架。

6. **Excel**(可选)—— 用 `useCrudExcel`,传 `fetchAll` / `exportRow` / `importFields` / `coerceRow` / `importMutation`,拿 `handleExport` 与 `importDialogProps`。

**诚实提示**:`useAppTable` 已被 `/demo/table`、工作台台账示例与系统设置各页真实使用;`lib/ids.ts` 的 `formatCode` / `nextIdByTime` 与 `hooks/use-dict.ts` 目前只有定义、没有调用方 —— 文件头注释是它们最准确的用法文档。完整清单见下节。

---

## 随模板分发、当前没有调用方的件

这些不是遗留,是刻意留的**备选件**:派生新项目时会马上用到,所以留着比删掉划算。改它们之前先确认没有别的实现替代。

| 件 | 位置 | 说明 |
| --- | --- | --- |
| CRUD 套件 | `lib/crud/*` | mutation / Excel / 查询失效 / 列宽持久化 |
| zod 片段 | `lib/validators/common.ts` | 复用校验片段 |
| 查询参数 store | `store/use-query-params.ts` | 列表页「草稿 → 提交」的参数状态工厂 |
| 编号口径 | `lib/ids.ts` | `前缀-YYMMDD-HHMMSS`;改 `ID_PREFIX` 换成自己的前缀 |
| 字典读取钩子 | `hooks/use-dict.ts` | 页面消费 `sys_dict` 的统一入口(维护入口是「字段管理」页) |
| 列可见性持久化 | `shared/use-column-visibility.ts` | 列显示与顺序存 `sys_para`(需要数据库) |
| 表单版式套件 | `shared/form-kit.tsx` | 0 调用方,做表单页时先看它 |
| 权限点选择区 | `shared/permission-tree.tsx`(`PermissionTree` / `PermissionPicker`) | 原先三个授权弹窗(用户 / 角色 / 用户组)共用;那三页改成占位页后暂无调用方 |
| mock 数据原语 | `mocks/shared.ts` | `pick` / `idOf` / `phone` / `personName` / 固定基准日等**确定性**构造器(禁 `Math.random()`) |
| 部门树示例 | `mocks/dicts.ts` | 示例单位 / 部门树 + `deptName` / `deptSelectOptions` 派生函数;做组织架构类页面时可直接复用 |

**约定**:新增可复用件时,**要么给它一个真实调用方,要么在工作台 UI 示例里展示,要么登记进上表** —— 三者都不做,它会被下一轮清理当成死代码删掉。

---

## 系统设置模块(唯一保留的真实业务)

`/settings/*` 七个页面:**四页真实数据 + 三页待实现占位**。

| 页面 | 路由 | 数据来源 | 演示的骨架 |
| --- | --- | --- | --- |
| 用户管理 | `/settings/users` | **待实现**(无数据源) | 占位页 —— 原先的 mock 已删除 |
| 用户组管理 | `/settings/groups` | **待实现**(无数据源) | 占位页 —— 原先的 mock 已删除 |
| 角色管理 | `/settings/roles` | **待实现**(无数据源) | 占位页 —— 原先的 mock 已删除 |
| 标签管理 | `/settings/tags` | `mocks/tags.ts` | 主表 + 子表条目弹窗 |
| 菜单管理 | `/settings/menus` | **`sys_menu` 表** | 可排序树 + 右侧编辑表单(改完即时生效) |
| 字段管理 | `/settings/dictionary` | **`sys_dict` 表** | 字典 CRUD + 条目编辑 |
| 参数管理 | `/settings/parameters` | **`sys_para` 表** | 按类型码(整数 / 开关 / 文本 / JSON)校验的参数表单;详情 / 编辑 / 删除 |

后四页走**真库 / 真接口**;标签管理走内存 mock(演示"数据源可替换":刷新回到种子)。
用户 / 用户组 / 角色三页**故意不摆假数据**:它们曾经跑一份 791 行的内存 mock,看上去能增删改查、
实际刷新就回到种子、和真实库毫无关系,容易被当成"已经实现"。现在这三页只是路由 + 占位页
(`modules/settings/settings-stub-page.tsx`),接上真实接口后再按页角色重建。

> 权限点目录(角色授权要勾的那棵树)原先由 `NAV_NODES` 在前端派生(`mocks/settings.ts` 的
> `PERMISSION_TREE` / `PERMISSION_POINTS`),那份 mock 已随这三页一起删除 —— 权限服务上线时
> 目录应当由**服务端**返回,不要再在前端摆一份。

---

## 派生新项目

> ⚠️ 本 README 早先描述的 `new-project.sh` 在当前工作区里**不存在**(可能随仓库分发、未随目录带过来)。没有它也不影响:直接 `cp -r` 整个目录 → 改 `package.json` 的 `name` → 删掉 `.env.local` 即可。模板没有任何"必须由脚本生成"的东西。

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
2. **保留一处 `@tanstack/react-start` 的引用** —— 容易踩的坑:`server: { handlers }` 这个路由选项的类型来自 `@tanstack/react-start` 的模块增强,而全项目只有 `demo/sentry.testing.tsx` 与 `demo/drizzle.tsx` 引用了它。删掉 demo 后 `src/routes/api/auth/$.ts` 与 `src/routes/api.trpc.$.tsx` 会开始报 `'server' does not exist in type ...`。在 `src/router.tsx` 顶部补一行 `import "@tanstack/react-start";` 即可
3. `src/components/layout/nav-config.ts`:把 `NAV_NODES` 里「组件展示 / 框架能力」两枝删掉
4. `src/components/layout/topbar.tsx`:改标题与 `username` 占位常量
5. `src/lib/constants.ts`:把 `THEME_STORAGE_KEY` 改成自己的名字 —— 多个项目都用 `localhost:3000` 时同源共用 localStorage,主题会互相串
6. `src/routes/__root.tsx`:改 `head()` 里的 `title`(`"管理后台"` 是占位)

然后:

```bash
pnpm generate-routes
pnpm typecheck
pnpm check
```

`src/components/modules/settings/` 与 `src/routes/(main)/settings/` **建议保留** —— 它们是可直接改造成新业务的完整 CRUD 骨架。

---

## 模板化改造记录

这个模板由一个真实的业务系统(约 500 个业务文件)裁剪而来。记录如下,便于追溯:

**抽取**(业务代码 → 通用件,并与已有组件合并去重)

| 新件 | 位置 | 由什么合并而来 |
| --- | --- | --- |
| `table-kit.tsx` | `shared/` | 三份同构的表壳实现(治理明细表 / 档案关联表 / 随访子表)+ 原 `table-loading.tsx` |
| `readonly-table.tsx` | `shared/` | 声明式只读子表(带搜索 / 排序 / 分页 / 导出) |
| `detail-profile.tsx` | `shared/` | 「主体摘要 + 关联业务 tab」详情页版式 |
| `stat-kit.ts` / `op-result.tsx` / `sheet-parse-options.tsx` / `sortable-tree.tsx` | `shared/` | 指标口径、操作结果反馈、导入解析选项、同级拖拽树 |
| `file-dropzone.tsx` | `ui/` | 文件拖放区 |
| `menu-detail-path.ts` | `lib/` | 从 651 行的业务文件里抽出的「参数化菜单路径」约定 |
| `status-badge.tsx` | `ui/(重写)` | 两套重复的状态徽章合并为一个,支持 `variants` 传域内词表 |

**删除**:12 个业务域目录(约 500 个文件)、80 条业务路由、29 个业务 lib、27 个业务 mocks、6 个业务 tRPC 路由、18 个业务脚本。`trpc/router.ts` 从 9 个命名空间收窄到 3 个(menu / dict / config)+ `todos` 示例。

**保留**:系统设置模块(7 页 = **4 页真实数据 + 3 页「待实现」占位**,含 `mocks/tags.ts` 的 17 个标签维度 —— 那是「标签管理」页的业务示例数据)、框架能力样例(9 页)、完整组件层、CRUD 套件、Better Auth、Drizzle、tRPC、Sentry、设计系统。

### 第二轮:遗留与封装审计

裁剪完又做了一遍全量审计(按「可达性 + 未使用导出 + 业务语汇 + 重复实现」四个维度),修掉的问题:

| 类别 | 发现 | 处理 |
| --- | --- | --- |
| **被抽出来但没人用的件** | `op-result` / `sheet-parse-options` / `file-dropzone` / `use-column-visibility` / `stat-kit` / `table-resize-handle` / `TagFieldInput` 抽完就没了调用方,也没进展示页 | 全部补进 `/showcase/*`(看不见 = 不存在) |
| **重复实现** | 三个授权弹窗各自手写「标题 + 计数 + 搜索 + 全选/清空 + 权限树」;而 `PermissionPicker` 早就是这块的封装 | 三处改用 `PermissionPicker`,顺手去掉 `keyword` state 与 `visibleIds` 派生 |
| **重复实现** | `lib/time.ts`(0 引用)与 `lib/format.ts` 各有一套日期格式化 | 日期函数只留 `lib/time.ts`,`format.ts` 只管值 / JSON 归一 |
| **正面冲突的 ui 原语** | `ui/sidebar`(与 `layout/sidebar` + `SidebarProvider` 同名冲突)、`ui/pagination`(与 `shared/pagination-control` 重复)、`hooks/use-mobile`(只服务前者) | 三件一起删;其余通用原语在工作台的 UI 示例里点名 |
| **死导出** | `NAV_PERMISSION_POINTS` / `NAV_PERMISSION_IDS` / `findNavTrail` / `findNavNode` / `flattenNavNodes` / `TruncateCell` / `moveWithinSiblings` / `countMultiValueHits` / `SHEET_DROPZONE_PROPS` / `UI_PRIMITIVE_COUNT` | 删除;另有 `visiblePermissionIds*` / `menuIconOf` / `trpcClient` 等只在本文件内用到的,收回模块内部 |
| **业务语汇残留** | `需求清单 #NN` / `应标点` / `浦锦街道` / 各业务域名词散在 25+ 个文件(含可见 UI 文案) | 全部泛化;`mocks/shared.ts` 从 299 行收到 91 行(只留真正被用到的 9 个原语) |
| **功能性 bug** | 角色种子的权限点匹配式还写着已删的域名(`re:enterprise\|visit\|works` 等),而权限树已从新 `NAV_NODES` 派生 → **6 个角色匹配到 0 个权限点**(页面显示 0 项,且不报错) | 重写 8 个角色 / 8 个用户组的匹配式对齐新菜单,并加注释提醒「改菜单要回来核对」。(那批角色 / 用户组种子随后已在「用户 / 用户组 / 角色三页去掉 mock」一轮**整体删除**) |
| **孤儿基础设施** | `src/router.tsx` 不在任何 import 图里(TanStack Start 按约定路径加载),被清理脚本误判为死代码删掉 | 从构建产物反推恢复,并在 `AGENTS.md` 里加了显式警告 |

审计后基线:`pnpm typecheck` 0 error · `pnpm check` 0 error / 4 warning · `vite build` 通过 · 产物内容校验 0 问题。

### 第三轮:视觉精修(2026-09)

在"能跑、干净"之后做的一轮观感与体验升级。三件事:**侧边栏重做**、**加点缀色**、**逐组件微动效**。

核心判断是「**颜色要用得有含义**」—— 与其多铺几种色,不如让每色承担一个导航职责:

| 改了什么 | 说明 |
| --- | --- |
| **点缀色谱** | 新增 6 个低饱和色相(oklch chroma 9%–13%,比 Material 鲜艳档低一半),每个五角色(实体 / 文字 / 软底 / 描边 / 反白前景),浅深两套。规格见 `DESIGN.md` §2.1 |
| **配色编码** | 一级模块各认一色 —— 侧边栏图标块 → 面包屑胶囊 → 页头强调条 → 工作台入口卡**四处同色**;指标卡按口径分色;告警语义仍只走 success/warn/danger |
| **侧边栏重做** | 品牌渐变标识 + 脉冲状态点;分组行常驻色相图标块;**含当前页**才上色(不是"展开了"就上色,否则三行都像选中);叶子 hover 浮现色块;选中 = 色底 + 色字 + 实心图标块 + 行内 3px 圆角标记条(从中间长出来);分组展开用 `grid-template-rows` 平滑过渡;chevron 只旋转不换图标;**折叠态改成 60px 迷你图标栏**(不再是"整条消失") |
| **全站分类色统一** | `BADGE_THEMES` 从 Tailwind 默认 `*-100/*-700`(彩度 25%–40%,偏亮)换成点缀色 token —— 标签列 / 标签输入 / 快速筛选 chip / 已选筛选 pill 一次性统一 |
| **动效层** | 抽出一批可复用原语:页面进场 / 路由进度条 / 交错入场 / 滚动入场 / 脉冲 / 呼吸 / 图标换位 / 折叠展开,全部已处理 `prefers-reduced-motion`。清单见 `DESIGN.md` §7.1 |
| **组件精修** | Card 悬停改**分层阴影抬升**(不再把边框刷蓝 + 3px 蓝环 —— 每张卡都闪是噪音)、新增 `tone` 强调线与 `interactive`;指标卡加内描边与交错入场;表格表头改渐隐色温 + 补选中态;页签计数胶囊与下划线走 token;页头加跟随模块色相的 3px 强调条与渐隐分隔线 |

顺手修掉三个**真缺陷**:`.route-progress-bar` 与 `.reveal` 两个类**只有引用没有定义**(路由进度条与滚动入场一直是隐形的,已补实现);
`DESIGN.md` §5.5 把页签写成"卡片式"而代码一直是**下划线**式(已按代码重写)。

视觉升级后基线:`pnpm typecheck` 0 error · `pnpm check` **0 error / 4 warning** · `vite build` 通过 · 产物内容校验 0 问题。

---

## 延伸阅读

项目内文档:

- `doc/前端结构与组件约定.md` —— **目录与文件角色约定、契约中枢形状、公共复用件与封装边界(必读)**
- `doc/后端接口约定.md` —— tRPC procedure 命名与出入参约定
- `AGENTS.md` —— 面向 AI 编码代理的项目约定与踩坑清单
- `DESIGN.md` —— 视觉规范(品牌 7 色 + 点缀 6 色相 + 间距 / 圆角 / 阴影 / 动效原语清单)
- `doc/archive/` —— 原业务系统的设计文档(表结构设计、需求清单、测试方案…),**仅供追溯,与新项目无关**

外部资料:

- [TanStack Start](https://tanstack.com/start) · [TanStack Router](https://tanstack.com/router) · [TanStack Table v9](https://tanstack.com/table)
- [tRPC](https://trpc.io/) · [Drizzle ORM](https://orm.drizzle.team/) · [Better Auth](https://www.better-auth.com)
- [Tailwind CSS v4](https://tailwindcss.com/) · [Biome](https://biomejs.dev/) · [Nitro 部署](https://v3.nitro.build/deploy)
