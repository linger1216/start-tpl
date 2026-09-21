<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

---

# start-tpl 项目约定

面向 AI 编码代理。这是一个人自用的 **TanStack Start 后台模板**工程 —— 业务代码已清空,只剩一个真实模块(系统设置)作示例,其余全是可复用能力。人类向的说明见 `README.md`。

## 这个模板里有什么

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 工作台 | `routes/(main)/index.tsx` + `components/modules/workbench/` | 模板入口页 |
| 组件展示 | `routes/(main)/showcase/` + `components/modules/showcase/` + `components/layout/showcase.tsx` | ★ 7 页组件活文档(纯展示,无业务)。**改组件后这里就是验收现场** |
| 框架能力 | `routes/(main)/demo/` | 9 个可运行样例:tRPC / Query / Form / Table / Drizzle / Auth / Store / Sentry |
| 系统设置 | `routes/(main)/settings/` + `components/modules/settings/` | ★ 唯一保留的真实业务,7 页覆盖完整 CRUD 骨架 |

新增可复用组件时,**顺手在对应的 `/showcase/*` 页加一个 `ShowcaseItem`** —— 这一层是模板的核心资产,没有展示就等于没有。

## 技术栈与版本要点

| 领域 | 选型 | 版本约束 |
| --- | --- | --- |
| 运行时 | Node | `>=20.19.0`(`engines`) |
| 包管理 | pnpm | `11.23.0`(`packageManager`) |
| UI | React | 19 |
| 框架 | TanStack Start | `^1.168.50`,SSR + server functions |
| 路由 | TanStack Router | `^1.170.33`,文件路由 |
| 数据 | TanStack Query `^5` | 经 `@tanstack/react-router-ssr-query` 做 SSR 集成 |
| API | tRPC v11 | headless,经 `@trpc/tanstack-react-query` 桥接 |
| ORM | Drizzle + `mysql2` | **MySQL**,不是 Postgres |
| 登录 | Better Auth | `^1.5.3`(实装 1.7.x),当前无状态模式 |
| 表格 | TanStack Table | **v9**(`^9.2.4`)—— API 与 v8 差异很大 |
| 样式 | Tailwind CSS | **v4**,无 `tailwind.config.js`,配置在 CSS 内 |
| 构建 | Vite 8 + Nitro | 产物目录是 `.output/`,不是 `dist/` |
| 质量 | Biome 2.4.5 + TypeScript 6 | |

几个容易搞错的点:

- **TanStack Query / tRPC / Table 都是 v5 / v11 / v9**,不要按 v4 / v10 / v8 的 API 写。
- tRPC 是 headless 模式:没有 `api.useUtils()`、没有 `proc.useMutation()`。用 `useTRPC()` 拿代理,再走 `useQuery(proc.queryOptions(...))` / `useMutation(proc.mutationOptions(...))`。
- Tailwind v4 没有 `tailwind.config.js`,`components.json` 里 `tailwind.config` 是空串。主题 token 直接写在 `src/styles.css`。

## 常用命令

```bash
pnpm dev              # 开发服务器,固定 3000 端口
pnpm typecheck        # tsc --noEmit —— 改完必跑,只报告不写文件
pnpm check            # biome check --write —— 格式化 + lint + 整理 import,会写回文件
pnpm generate-routes  # 改过 src/routes/ 之后必跑
pnpm build            # 生产构建 → .output/
pnpm start            # 运行生产产物(需先 build)
pnpm db:push          # 开发期同步 schema 到 MySQL
pnpm db:generate      # 生成迁移 SQL 到 ./drizzle
pnpm db:migrate       # 应用迁移
pnpm db:studio        # Drizzle Studio
pnpm db:seed:menus    # 把 NAV_NODES 写进 sys_menu(幂等)
pnpm db:seed:dicts    # 示例字典种子(幂等)
pnpm db:seed:configs  # 把 CONFIG_DEFAULTS 写进 sys_config(幂等)
```

`pnpm typecheck` 与 `pnpm check` 是最重要的两条自检命令。注意 `check` / `lint` / `format` 都带 `--write`,不是只读检查。

## 代码风格

**`biome.json` 是唯一权威**,`.editorconfig` 只是与它对齐,方便编辑器不要和格式化器互相改写。改风格时改 `biome.json`,然后同步 `.editorconfig`。

- **缩进用 Tab**,`indentWidth` 为 2,`lineWidth` 120
- **字符串用双引号**(`javascript.formatter.quoteStyle: "double"`)
- **JSON 配置用 2 空格**(`package.json` / `tsconfig.json` 等,不在 Biome 的 `files.includes` 管辖内)
- 保存时 Biome 会自动整理 import(`assist.actions.source.organizeImports`)

导入别名**统一用 `#/*`**:

```ts
import { db } from "#/db";
import { PageHeader } from "#/components/layout/page-header";
```

`@/*` 映射**已从 `tsconfig.json` 移除**,不要再使用,也不要在新代码里引入这个别名。

Biome 的 `files.includes` 只覆盖 `**/src/**/*`、`**/vite.config.ts`、`**/drizzle.config.ts`,并排除 `src/routeTree.gen.ts` 与 `src/styles.css`。也就是说 `instrument.server.mjs` 与 `scripts/**` 不在 Biome 管辖范围内。

## 设计系统(必读)

视觉规范是 **`DESIGN.md`**(Inspired by Airtable),实现落在 `src/styles.css` 的 token 层。

- **改视觉只改 token**,不要在组件里写死 hex 或逐个改色值。
- 品牌色映射:`#1b61c9`(Airtable Blue)→ `--primary` / `--ring`;`#181d26` → `--foreground`;`#ffffff` → `--background`;`#f8fafc` → `--card` / `--muted` / `--secondary` / `--accent`;`#333333` → `--muted-foreground`;`#e0e2e6` → `--border` / `--input`;`#006400` → `--success`。
- **点缀色谱(6 色相)**:`--hue-{blue,violet,teal,amber,rose,emerald}`,每个色相四个角色 —— 实体 `--hue-X`、文字 `--hue-X-fg`、软底 `--hue-X-soft`、描边 `--hue-X-line`,外加反白前景 `--hue-X-on`(浅色=白 / 深色=深海军蓝,**不要在调用点硬编码 `text-white`**)。色相不是装饰:一级模块各认一色(侧边栏 → 面包屑 → 页头强调条 → 工作台入口卡四处一致)。规格见 `DESIGN.md` §2.1。
  - 色相 → 类名的映射**只有一份**:`src/components/layout/nav-tone.ts`。加色相要改四处:①`styles.css` 的 `:root` ②`styles.css` 的 `.dark` ③`styles.css` 的 `@theme inline` ④`nav-config.ts` 的 `NAV_TONES` + `nav-tone.ts` 补一条(**漏了第 ④ 步会在 typecheck 阶段报缺 key,不会静默失效**)。
  - **Tailwind 只扫描源码里的字面量类名**,不能写 `bg-hue-${tone}-soft` 这种拼接 —— 扫描不到就不会生成 CSS。所有按色相取类名的地方必须查表。
  - 告警语义仍然只走 `--success` / `--warn` / `--danger`,`emerald` ≠ `success`。一屏内出现的色相不超过 4 个。
- `--warn-*` / `--danger-*` / `--destructive` / `--chart-1..5` 是**规范之外的功能色**(规范只定义 7 个品牌色),不要把它们当品牌色扩散使用。`BadgeList` / `JsonCell` 的彩色主题(`rainbow` / `ocean` / …,定义在 `ui/badge-list.tsx` 的 `BADGE_THEMES`)**已改为读点缀色 token**(原先用的是 Tailwind 默认 `*-100/*-700`,约 25%–40% 彩度,太亮)。改那一处 = 全站分类色统一。默认值仍是规范内的 `brand` 主题。
- **不要在渲染期用 `Math.random()`**:会造成 SSR 水合不一致,而且每次重渲染都变值。需要"看起来随机"的效果时,用基于 `useId()` 或数据本身的稳定哈希(`BadgeList` 的 `stable` 就是这么做的)。
- **不要覆盖 Tailwind 的 `--radius-*` 命名空间。** 它的默认阶就是 `DESIGN.md` §5 要的:`rounded-lg` 8px、`rounded-xl` 12px(按钮)、`rounded-2xl` 16px(小卡片)、`rounded-3xl` 24px(区块)。覆盖会让所有组件圆角一起漂移。
- 字体在 `@theme inline` 的 `--font-sans` / `--font-heading`(Haas / Haas Groot Disp,fallback 到系统栈,**fallback 必须保留**)。换字体只改这两行。
- 字距在 `@layer base`:正文 `0.08px`、标题负向、按钮与 label `0.02em`、全大写 `0.08em`。组件里的 `tracking-*` 会覆盖 base。
- 阴影用 `--shadow-card` / `--shadow-soft` / `--shadow-glow`,**不要写厚重纯黑阴影**。
  **抬升三档用 `--af-raise-1|2|3`(静置 / 悬停 / 浮起)**:`shadow-(--af-raise-1)`。hover **只换档位**(可加边框加深),不做位移 —— 三档同族颜色,切换才不跳。
- 动效用 `--ease-brand` + `--t-fast|base|slow`(120 / 180 / 260ms)。**先查 `DESIGN.md` §7.1 的「现成动效原语」表**,不要每次现搓 keyframes;表里没有的才自己写,并保证 `prefers-reduced-motion` 下复位(全局媒体查询已兜底,但别用 `transform` 表达"必须保持的位置")。
- `.dark` 是品牌色经 `color-mix` 推导的对偶值;`DESIGN.md` 只规定浅色,加新 token 时记得同时补 `.dark`。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/routes/` | 文件路由。文件名即 URL;`(main)` 是无路径布局组 |
| `src/routes/(main)/showcase/` | **组件展示台**:7 页,每页对应组件分层的一层。纯展示、无业务,派生新项目时可整目录删 |
| `src/routes/(main)/demo/` | 框架能力示例页(表格 / 表单 / Query / tRPC / store / DB / Auth / Sentry),用模板自身组件写成,可整目录删除。放在 `(main)` 里是为了复用后台外壳,URL 仍是 `/demo/*` |
| `src/routes/(main)/settings/` | 唯一保留的真实业务模块,7 个页面。派生新项目时**从这里开始改**,不要删 |
| `src/components/ui/` | 叶子原语,45 个(vendored shadcn + 自研组合控件)。**例外:`tabs.tsx` 已被项目改写为下划线页签** —— 全项目唯一的页签实现(计数走 `count` 属性),规格见 `DESIGN.md` §5.5(该节此前误写成"卡片式页签",已按代码修正);`pnpm dlx shadcn@latest add tabs` 会覆盖它,覆盖后需按该节重做。**取舍原则**:与项目内已有实现**正面冲突**的原语不保留(曾有 shadcn 的 `sidebar` 与 `pagination`,与 `layout/sidebar` + `shared/pagination-control` 打架,已删);通用但当前没用到的保留,并在 `/showcase/ui` 的「其他可用原语」里点名,否则等于不存在 |
| `src/components/layout/` | 后台外壳:侧边栏(含 60px 迷你图标栏折叠态)、顶栏、面包屑、页头、空态、占位页、导航配置,以及 `nav-tone.ts`(**色相 → 类名的唯一映射表**,侧边栏 / 顶栏 / 工作台共用)与 `showcase.tsx`(展示台骨架:`ShowcasePage` / `ShowcaseSection` / `ShowcaseItem` / `PropTable` / `CodeBlock`) |
| `src/components/modules/shared/` | 跨模块复用的**领域无关**展示件,23 个:表格套件(`table-kit` 的 `DataTable` / `selectColumn` / `actionsColumn` / `TableLoadingShell`)、只读子表(`readonly-table`)、详情页版式(`detail-profile`)、台账工具栏(`ledger-toolbar`)、快速筛选条(`filter-chips`)、列选择器与列可见性(`column-visibility-menu` / `use-column-visibility`)、分页器、指标卡与语义层(`stat-cards` / `stat-kit`)、标签徽章与标签输入(`tag-badges`)、迷你图表(`mini-chart`)、Excel 导入弹窗与导入导出流程(`excel-import` / `ledger-excel`)、导入解析选项(`sheet-parse-options`)、操作结果反馈(`op-result`)、可排序树(`sortable-tree`)、权限树与权限选择区(`permission-tree` 的 `PermissionTree` / **`PermissionPicker`**)、表单套件(`form-kit`)、图标选择器(`icon-picker`)、编目信息条(`catalog-banner`) |
| `src/components/modules/showcase/` | 展示台 7 个页面本体(纯文档,不含业务逻辑) |
| `src/components/modules/<域>/` | 业务域模块。每页固定文件角色:`-page` / `-table` / `-form` / `-form-mappers` / `-detail`(或整页 `-detail-page`)/ `-stats`;多页面域用 `<域>-<页面>-<角色>`。**不做通用增删改查封装** —— 列定义、行类型、增删改写操作逐页手写。完整约定见 `doc/前端结构与组件约定.md`;现成范例见 `components/modules/settings/` |
| `src/lib/crud/` | CRUD 套件:mutation、Excel 导入导出、查询失效、表格辅助 hook |
| `src/lib/api/` | `ApiError` 与错误归一化 |
| `src/lib/validators/` | 复用的 zod 片段 |
| `src/lib/` | 通用工具:`table.ts`(v9 app hook + `useRowSelection` 多选)、`excel.ts`(Excel 列类型与**唯一**写盘点 `writeSheet`/`cellText`)、`mock-table.ts`(内存表)、`multi-value.ts`、`format.ts`、`time.ts`、`ids.ts`(编号口径)、`menu-detail-path.ts`、`sys-config.ts`(系统参数)、`db-errors.ts`、`logger.ts`、`constants.ts`、`utils.ts` 等 |
| `src/store/` | `createQueryParamsStore` 查询参数状态工厂 |
| `src/db/` | `index.ts` 导出 drizzle 实例 `db`;`schema.ts` 是迁移管辖的表;`data-base-schema.ts` 是**不走迁移**的 `sys_menu` / `sys_dict` / `sys_config` 三表 |
| `src/integrations/` | 第三方接线:tRPC 初始化与路由、TanStack Query 上下文、Better Auth 客户端侧 |
| `src/hooks/` | 通用 hook:`use-dict`(读 `sys_dict` 的统一入口)、`use-stable-keys`(列表稳定 key)、`demo.form*`(框架能力样例专用) |
| `scripts/` | 只放**运维/种子脚本**(`seed-menus` / `seed-dicts` / `seed-configs`,全部幂等"只补不覆盖")。业务验证脚本随业务一起删 |

## 随模板分发、但当前**没有调用方**的东西

这些不是遗留,是刻意留的"备选件" —— 派生新项目时会马上用到。**改它们之前先确认没有别的实现替代**:

| 件 | 位置 | 说明 |
| --- | --- | --- |
| CRUD 套件 | `lib/crud/*` | mutation / Excel / 查询失效 / 列宽持久化。文件头注释是最准确的用法文档 |
| zod 片段 | `lib/validators/common.ts` | 复用校验片段 |
| 查询参数 store | `store/use-query-params.ts` | 列表页「草稿 → 提交」的参数状态工厂 |
| 编号口径 | `lib/ids.ts` | `前缀-YYMMDD-HHMMSS`;改 `ID_PREFIX` 换成自己的前缀 |
| DB 错误归一 | `lib/db-errors.ts` | MySQL 唯一键 / 外键错误的可读化 |
| 字典读取钩子 | `hooks/use-dict.ts` | 页面消费 `sys_dict` 的统一入口(「字段管理」页负责维护它) |
| 列可见性持久化 | `shared/use-column-visibility.ts` | 存 `sys_config`(需要数据库) |
| 5 个 ui 原语 | `ui/{popover,command,context-menu,menubar,sheet}.tsx` | 已在 `/showcase/ui` 的「其他可用原语」里点名 |

**新增可复用件时:要么给它一个真实调用方,要么在 `/showcase/*` 展示,要么登记进上表** —— 三者都不做就会被下一轮清理当成死代码删掉。

沿用已有的目录分工,不要新造平级抽象层。业务无关的东西放 `lib/` 或 `components/modules/shared/`,页面专属组件就放页面文件里。

## 新增路由

1. 文件放到 `src/routes/` 下。要带后台外壳就放 `src/routes/(main)/`。
2. 跑 `pnpm generate-routes` 重新生成 `src/routeTree.gen.ts`。
3. 在 `src/components/layout/nav-config.ts` 的 `NAV_NODES` 里注册菜单。

约定:

- **`(main)` 是布局组**,`(main)/route.tsx` 渲染 `SidebarProvider`,`(main)` 本身不出现在 URL 里。`src/routes/(main)/users.tsx` 对应 `/users`。
- **`src/routeTree.gen.ts` 是生成物,绝对不要手改。** Biome 的 `files.includes` 已用 `!**/src/routeTree.gen.ts` 排除它;`.vscode/settings.json` 也把它标为只读,并从搜索与文件监听中排除。
- 加完路由后在路由文件里用 `createFileRoute("/(main)/users")`,路径要和文件名一致。
- **不要在 `src/routes/` 根下建 `index.tsx`** —— 它和 `src/routes/(main)/index.tsx` 都映射到 `/`,`pnpm generate-routes` 会直接报 `Conflicting configuration paths` 并拒绝生成。
- 页面骨架未定时用 `StubPage` 占位(参考 `src/routes/(main)/blank.tsx`)。
- 想脱离后台外壳的页面(如登录页)放 `src/routes/` 根下,不要放进 `(main)/`。

## 新增 shadcn 组件

```bash
pnpm dlx shadcn@latest add <component-name>
```

`components.json` 的 aliases 已配好(`components` → `#/components`,`ui` → `#/components/ui`,`utils` → `#/lib/utils`),组件会落在 `src/components/ui/`。

**`src/components/ui/` 是被 vendored 的目录,`biome.json` 对它有一条 scoped override**,关闭了这些规则:

- `a11y`: `noLabelWithoutControl`、`noRedundantRoles`、`noSvgWithoutTitle`、`useFocusableInteractive`、`useSemanticElements`
- `correctness.useExhaustiveDependencies`
- `suspicious.noArrayIndexKey`

**不要在这个目录里"顺手修 lint"。** 这些规则是上游组件库的写法决定的,改了既无意义又会在下次 `shadcn add` 时被覆盖。要改的是 override 配置,不是组件代码。

自研的布局和业务组件放 `src/components/layout/` 与 `src/components/modules/shared/`,那些目录**要**遵守完整的 Biome 规则。

## 数据库

**两张 schema 文件口径不同,不要混:**

| 文件 | 管辖 | 迁移 |
| --- | --- | --- |
| `src/db/schema.ts` | Better Auth 四表(`user` / `session` / `account` / `verification`)+ `todos` 示例表 | 由 drizzle 迁移管理 |
| `src/db/data-base-schema.ts` | `sys_menu` / `sys_dict` / `sys_config` | **不进迁移**:只声明"读写的形状",DDL 由建表脚本维护 |

**不要把 `data-base-schema.ts` 的表并进 `schema.ts`** —— 下次 `db:generate` 会生成 `CREATE TABLE`,而库里已存在 → `db:migrate` 直接 1050 报错。

- 连接在 `src/db/index.ts`,用 `drizzle-orm/mysql2`,导出 `db`
- 迁移配置在 `drizzle.config.ts`:dialect `mysql`,输出 `./drizzle`,`schema` **只指向** `./src/db/schema.ts`,读 `.env.local` → `.env`
- env 流转:`.env.example`(随模板分发,无凭据)→ `cp .env.example .env.local`(本地填写,已 gitignore)
- `DATABASE_URL` **缺失会直接抛错**,`src/db/index.ts` 与 `drizzle.config.ts` 都有显式检查
- 改 schema 后:`pnpm db:push`(开发期)或 `pnpm db:generate && pnpm db:migrate`
- 系统三表的种子:`pnpm db:seed:menus`(把 `NAV_NODES` 写进 `sys_menu`)、`db:seed:dicts`、`db:seed:configs` —— 三个都幂等"只补不覆盖"
- `db` 只能在服务端用(tRPC procedure、server function)。不要从客户端组件 import

本模板是 **MySQL**。写文档或示例代码时不要出现 `pg` 的 `Pool` 或 `postgres` dialect。

## 已知陷阱

- **永远不要提交 `.env*`。** `.gitignore` 已覆盖 `.env`、`.env.*`、`*.local`,并保留 `!.env.example`。`.env.example` 是唯一允许入库的 env 文件,且必须不含真实凭据。
- **不要删 `src/router.tsx`。** 它不在任何 import 图里(TanStack Start 按**约定路径**发现并加载它),所以"扫引用找死代码"的脚本会误判它是孤儿。删了直接起不来服务。这个坑真实发生过一次。
- **不要把 `start-tpl` 这个字符串硬编码进业务代码。** 它只应该出现在 `package.json` 的 `name` 和文档里。项目名相关的展示文案走配置或 env。`localStorage` 的 key 尤其要注意加项目前缀。
- **`src/routes/(main)/demo/` 及其支撑文件可以整目录删除**:`demo/` 目录、`hooks/demo.form-context.ts`、`hooks/demo.form.tsx`、`lib/demo-store.ts`。本模板 `__root.tsx` 的 devtools 只挂了 Router 与 Query 两项(Store devtools 已随业务清理),所以**删 demo 不需要改 `__root.tsx`**。
- **删掉 demo 后必须补一行 `import "@tanstack/react-start";`**(放在 `src/router.tsx` 顶部)。`server: { handlers }` 这个路由选项的类型来自 `@tanstack/react-start` 的模块增强,而全项目只有 `(main)/demo/sentry.testing.tsx` 和 `(main)/demo/drizzle.tsx` 引用了它。不补的话 `src/routes/api/auth/$.ts` 与 `src/routes/api.trpc.$.tsx` 会报 `'server' does not exist in type ...`。
- **`src/routes/(main)/showcase/` 可以整目录删**(连同 `components/modules/showcase/` 与 `layout/showcase.tsx`)。删完把 `nav-config.ts` 里 `NAV_NODES` 的「组件展示」一枝去掉即可,没有别的连带。
- **demo 目录是"简单示例页"**:每个页面只演示一项能力,且全部用模板自身的组件写。`(main)/demo/table.tsx` 用的是 `useAppTable`(`src/lib/table.ts`)而不是裸的 `useTable`,可以当作接真实 CRUD 表格的参照。这些页面当前不报任何类型或 lint 错误,删或留都不影响 `pnpm typecheck` / `pnpm check` / `pnpm build`。
- **TanStack Table v9 的行模型必须写成「具名 slot + 调用」**:`tableFeatures({ sortedRowModel: createSortedRowModel() })`。写成 `createSortedRowModel`(无 key、未调用)属于**不会报错的错误**:类型照样通过,但 `getSortedRowModel()` / `getPaginationRowModel()` 实际不存在,症状是**页码算得对(显示"共 4 页")却把全部行都渲染出来**。`src/lib/table.ts` 已按正确写法修复并实测验证,不要改回去。
- **设计 token 只有一套**:`src/styles.css` 只保留语义 token 与 `@theme inline` 映射,色值与字体全部由 `DESIGN.md` 决定(映射见上文"设计系统")。
- **主题只有一套**:顶栏切换按钮(`components/layout/topbar.tsx`)与 `__root.tsx` 的首屏引导脚本共用 `src/lib/constants.ts` 的 `THEME_STORAGE_KEY`,无存储值时都回落到系统偏好。改主题必须同时改这两处的读取逻辑。
- **`__root.tsx` 不渲染任何页面外壳**,只有 HTML 骨架、主题引导脚本与 devtools;页面外壳统一在 `(main)/route.tsx`。它另外配置了 `notFoundComponent`(用 `EmptyState`),不要删掉。
- **`src/components/ui/*.tsx` 里残留的 `"use client"` 指令已清理**。那是 Next.js 专用指令,在 TanStack Start 里是无意义的噪音,新加组件时如果 shadcn 模板带进来,删掉即可。
- **`components/ui/` 里 vendored 组件的 lint warning 不要顺手清理**(见上文"新增 shadcn 组件")。当前基线 4 个 warning 里有 3 个出自 `badge-list.tsx`。
- **时间格式化只走 `lib/time.ts`**。`lib/format.ts` 曾与它各有一套日期函数(`formatDateTime` vs `formatLocalDateTime`),同一个值在两处可能给出不同结果 —— 已合并,日期函数只留在 `time.ts`。`utils.ts` / `format.ts` 里都不要再加日期函数。
- **权限点选择区只有 `PermissionPicker` 一个实现**(`shared/permission-tree.tsx`)。三个授权弹窗(用户 / 角色 / 用户组)共用它,不要再手写「标题 + 计数 + 搜索 + 全选/清空 + 树」那一块。
- **`mocks/*` 是演示数据,不是业务真相**。`mocks/settings.ts` 的角色 / 用户组种子里的 `选` 匹配式**必须与 `NAV_NODES` 对齐** —— 改菜单后要回来核对,否则角色会匹配到 0 个权限点(页面显示 0 项权限,且不报错)。唯一例外是 `mocks/tags.ts` 的 17 个标签维度:那是「标签管理」页的业务示例数据,按需求保留。

## 改动完成后自检

按顺序跑:

```bash
pnpm typecheck        # 必须 0 error
pnpm check            # 0 error;warning 可接受
```

涉及构建配置、依赖、路由或 server 入口的改动,再跑一次:

```bash
pnpm build            # 产物落在 .output/
```

改了 `src/routes/` 下的文件,别忘了 `pnpm generate-routes`。**不要手改 `src/routeTree.gen.ts`**,它是生成物。

已知基线:`pnpm check` 为 **0 error / 4 warning**(另有 1 条 info),只有两个文件、一类规则:

| 文件 | 规则 |
| --- | --- |
| `src/components/ui/badge-list.tsx` | `noNonNullAssertion`(3 处) |
| `src/components/modules/shared/icons-list.ts` | `noNonNullAssertion` |

都不影响退出码,且都在"不要顺手修"的范围里(vendored `ui/`、或上游写法决定的 `!` 断言)。**新代码不要新增 warning** —— 出现新 warning 说明引入了新的写法问题。

> `layout/topbar.tsx` 的 `useTemplate` 警告已修(2026-09),基线从 5 warning 降到 4。
