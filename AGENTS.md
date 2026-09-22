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
| 组件示例 | 工作台 `/` 的 `components/modules/workbench/`(`ui-gallery.tsx` + `ui-gallery-table.tsx` + `workbench-tagging.tsx`) | ★ **三样都在这一页验收**:44 个 `ui/` 原语、`shared/` 的通用交互件(SortableTree / PermissionPicker / LedgerToolbar / …)、`lib/` 的通用工具(time / ids / format / mock-table / …),再加表格与打标签两组实战示例。**改封装后这里就是验收现场** |
| 框架能力 | `routes/(main)/demo/` | 9 个可运行样例:tRPC / Query / Form / Table / Drizzle / Auth / Store / Sentry |
| 系统设置 | `routes/(main)/settings/` + `components/modules/settings/` | ★ 唯一保留的真实业务:**7 页 = 4 页真实数据 + 3 页「待实现」占位** |

新增可复用组件时,**顺手在工作台的 UI 示例里加一格** —— 这一层是模板的核心资产,没有展示就等于没有。

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

- **接口访问的铁规**:
  - **后端** —— 所有接口都是 tRPC(`src/integrations/trpc/routers/*.ts`),不要再开新的 REST 路由;BA 的 `/api/auth/*` 是唯一例外。
  - **客户端** —— 业务侧的所有数据获取/变更都用 **`useQuery(trpc.X.queryOptions(...))` / `useMutation(trpc.X.mutationOptions(...))`**(统一缓存、key 自动生成、重复请求合并、类型端到端推断);
    严禁直接 `fetch(...)`、自己写 `axios`、自己 `useQuery({ queryFn: ... })`。
  - **服务端** —— SSR loader / server function **不绕过 HTTP 直接调 procedure caller**(`createCallerFactory` 只在 `tests/helpers.ts` 用了 1 次,仅供测试;业务侧不要用 —— 那样会绕过 tRPC 中间件、日志、错误归一、序列化)。
  - 这条已经在审计期自查过(grep `fetch(` / `useQuery` / `useMutation` / `await X.query(`):**全仓库 0 处违规**;以后改完代码跑一遍这几条 grep,作为轻量自检。
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
pnpm db:seed:paras    # 把 PARA_DEFAULTS 写进 sys_para(幂等)
pnpm test             # 直调 tRPC procedure 的集成测试(需要 .env.local 指向的库)
pnpm db:create        # 建系统表九张(设置五 + 认证四,幂等;建完顺带对齐列注释 / 索引名)
pnpm db:sync:meta     # 对齐**表注释 / 列注释 / 索引名**(MySQL 与达梦都支持,幂等)
pnpm db:dm:smoke      # 达梦连通性冒烟:drizzle 走 select/insert/update/delete/transaction
pnpm db:dm:defaults   # 给达梦表补默认值(达梦建表没带 DEFAULT 时必跑,幂等)
pnpm db:dm:create-ba  # 给达梦建认证四表(sys_user / sys_session / sys_account / sys_verification)+ todos(幂等)
pnpm db:dm:poc        # 达梦底层验证:直连 dmdb,逐条验 SQL 翻译(反引号/占位符/inArray)
pnpm check:legacy     # 诊断:当前 Node 能否用 DES-CFB(连达梦挂住不报错时先跑它)
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
  - 色相 → 类名的映射**只有一份**:`src/styles.css` 的 `@theme inline`(`--color-hue-X` / `-fg` / `-soft` / `-line` / `-on`)。加色相改三处:①`:root` ②`.dark` ③`@theme inline` —— 漏了第 ③ 步,`bg-hue-X-soft` 这类工具类不会生成(Tailwind 扫不到、也不报错)。
  - 同理,`--af-*` 那套中性/品牌 token 也在 `@theme inline` 里映射成了标准工具类(`bg-hover` / `bg-brand-soft` / `border-border-strong` / `shadow-card` / `shadow-raise-1` …)。**组件里不要再写 `bg-[color:var(--af-hover)]` 这种任意值** —— 又长又容易拼错 var 名,拼错了整条规则静默失效。
  - **Tailwind 只扫描源码里的字面量类名**,不能写 `bg-hue-${tone}-soft` 这种拼接 —— 扫描不到就不会生成 CSS。所有按色相取类名的地方必须查表。
  - 告警语义仍然只走 `--success` / `--warn` / `--danger`,`emerald` ≠ `success`。一屏内出现的色相不超过 4 个。
- `--warn-*` / `--danger-*` / `--destructive` / `--chart-1..5` 是**规范之外的功能色**(规范只定义 7 个品牌色),不要把它们当品牌色扩散使用。`BadgeList` 的彩色主题(`rainbow` / `ocean` / …,定义在 `ui/badge-list.tsx` 的 `BADGE_THEMES`)**已改为读点缀色 token**(原先用的是 Tailwind 默认 `*-100/*-700`,约 25%–40% 彩度,太亮)。改那一处 = 全站分类色统一。默认值仍是规范内的 `brand` 主题。
- **不要在渲染期用 `Math.random()`**:会造成 SSR 水合不一致,而且每次重渲染都变值。需要"看起来随机"的效果时,用基于 `useId()` 或数据本身的稳定哈希(`BadgeList` 的 `stable` 就是这么做的)。
- **不要覆盖 Tailwind 的 `--radius-*` 命名空间。** 它的默认阶就是 `DESIGN.md` §5 要的:`rounded-lg` 8px、`rounded-xl` 12px(按钮)、`rounded-2xl` 16px(小卡片)、`rounded-3xl` 24px(区块)。覆盖会让所有组件圆角一起漂移。
- 字体在 `@theme inline` 的 `--font-sans` / `--font-heading`(Haas / Haas Groot Disp,fallback 到系统栈,**fallback 必须保留**)。换字体只改这两行。
- 字距在 `@layer base`:正文 `0.08px`、标题负向、按钮与 label `0.02em`、全大写 `0.08em`。组件里的 `tracking-*` 会覆盖 base。
- 阴影用工具类 `shadow-card` / `shadow-soft` / `shadow-glow`,**不要写厚重纯黑阴影**(实现变量叫 `--elev-*`、和 Tailwind 的 `--shadow-*` 命名空间避开;映射在 `@theme inline`)。
  **抬升三档 `shadow-raise-1|2|3`(静置 / 悬停 / 浮起)**。hover **只换档位**(可加边框加深),不做位移 —— 三档同族颜色,切换才不跳。
- 动效用 `--ease-brand` + `--t-fast|base|slow`(120 / 180 / 260ms)。**先查 `DESIGN.md` §7.1 的「现成动效原语」表**,不要每次现搓 keyframes;表里没有的才自己写,并保证 `prefers-reduced-motion` 下复位(全局媒体查询已兜底,但别用 `transform` 表达"必须保持的位置")。
- `.dark` 是品牌色经 `color-mix` 推导的对偶值;`DESIGN.md` 只规定浅色,加新 token 时记得同时补 `.dark`。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/routes/` | 文件路由。文件名即 URL;`(main)` 是无路径布局组 |
| `src/routes/(main)/demo/` | 框架能力示例页(表格 / 表单 / Query / tRPC / store / DB / Auth / Sentry),用模板自身组件写成,可整目录删除。放在 `(main)` 里是为了复用后台外壳,URL 仍是 `/demo/*` |
| `src/routes/(main)/settings/` | 唯一保留的真实业务模块,**7 个页面 = 4 页真实数据(标签 / 菜单 / 字典 / 参数)+ 3 页「待实现」占位(用户 / 用户组 / 角色)**。派生新项目时**从这里开始改**,不要删 |
| `src/components/ui/` | 叶子原语,43 个(vendored shadcn + 自研组合控件)。**例外:`tabs.tsx` 已被项目改写为「四种分割形态」的页签**(下划线 / 分段 / 药丸 / 卡片,计数走 `count` 属性),规格见 `DESIGN.md` §5.5;`pnpm dlx shadcn@latest add tabs` 会覆盖它,覆盖后需按该节重做。**取舍原则**:与项目内已有实现**正面冲突**的原语不保留(曾有 shadcn 的 `sidebar` 与 `pagination`,与 `layout/sidebar` + `shared/pagination-control` 打架,已删);通用但当前没用到的保留,并在工作台 UI 示例里点名,否则等于不存在 |
| `src/components/layout/` | 后台外壳:`sidebar`(含 60px 迷你图标栏)+ `sidebar-header`(品牌标题区)+ `sidebar-provider`(折叠状态)+ `topbar`(面包屑/主题)+ `page-header` / `empty-state` / `stub-page` / `page-transition` / `route-progress` / `module-overview`,导航四件:`nav-config`(静态菜单 + 纯树工具)/ `nav-menu`(库行→树)/ `nav-data`(两个只读 hook)/ `nav-config` |
| `src/components/modules/shared/` | 跨模块复用的**领域无关**展示件(工作台有示例,见「这个模板里有什么」的工作台行):`table-kit`(表格套件:`DataTable` / `selectColumn` / `actionsColumn` / `TableLoadingShell` / `TextCell`)、**`sortable-tree`(可拖拽排序树 —— 菜单管理 / 标签管理两页共用同一套交互)**、`ledger-toolbar`(台账工具条)、`filter-chips`(快速筛选 + 已选 pill)、`pagination-control`、`stat-cards`(指标卡)、`tag-badges`(标签渲染:`splitTags` + `TagBadges`,上色走 `ui/badge-list`)、`form-kit`(表单套件)、`icon-picker` + `icons-list` + `use-lucide-icons`(图标选择)、`permission-tree`(权限树 / 权限选择区)、`excel-import` + `ledger-excel`(导入导出) |
| `src/components/modules/<域>/` | 业务域模块。每页固定文件角色:`-page` / `-table` / `-form` / `-form-mappers` / `-detail`(或整页 `-detail-page`)/ `-stats`;多页面域用 `<域>-<页面>-<角色>`。**不做通用增删改查封装** —— 列定义、行类型、增删改写操作逐页手写。完整约定见 `doc/前端结构与组件约定.md`;现成范例见 `components/modules/settings/` |
| `src/lib/api/` | `ApiError` 与错误归一化 |
| `src/lib/` | 通用工具:`table.ts`(v9 app hook + `useRowSelection` 多选)、`excel.ts`(Excel 列类型与**唯一**写盘点 `writeSheet`/`cellText`)、`mock-table.ts`(内存表)、`multi-value.ts`、`format.ts`、`time.ts`、`ids.ts`(编号口径)、`menu-detail-path.ts`、`sys-para.ts`(系统参数读写)、`para-spec.ts`(参数类型码与校验,客户端可 import)、`logger.ts`、`constants.ts`、`utils.ts` 等 |
| `src/db/` | `index.ts` 按 `DATABASE_URL` 前缀选驱动(mysql2 / 达梦)并导出 drizzle 实例 `db`;**`dm/` 是达梦驱动**(复用 mysql-core 方言 + dmdb,见「数据库 ▸ 达梦支持」);`schema.ts` 是迁移管辖的表(只剩 `todos`);`data-base-schema.ts` 是**不走迁移**的九张系统表:五张设置表(`sys_menu` / `sys_dict` / **`sys_para`**(参数,旧名 `sys_config`)/ `sys_tag` / `sys_tag_relation`)+ 四张认证表(`sys_user` / `sys_session` / `sys_account` / `sys_verification`) |
| `src/integrations/` | 第三方接线:tRPC 初始化与路由、TanStack Query 上下文、Better Auth 客户端侧 |
| `src/hooks/` | 通用 hook:`use-dict`(读 `sys_dict` 的统一入口)、`use-stable-keys`(列表稳定 key)、`demo.form*`(框架能力样例专用) |
| `scripts/` | 只放**运维/建表/迁移/种子脚本**:`create-system-tables`(建九张系统表)/ `sync-table-meta`(表注释 / 列注释 / 索引名的唯一真源)/ `migrate-ids-to-nanoid`(老库换主键)/ `seed-menus` / `seed-dicts` / `seed-paras` / `seed-tags`,全部幂等(建表 `if not exists`、迁移只改该改的行、种子"只补不覆盖")。业务验证脚本随业务一起删 |

## 随模板分发、但当前**没有调用方**的东西

这些不是遗留,是刻意留的"备选件" —— 派生新项目时会马上用到。**改它们之前先确认没有别的实现替代**:

| 件 | 位置 | 说明 |
| --- | --- | --- |
| 编号口径 | `lib/ids.ts` | `前缀-YYMMDD-HHMMSS`(`formatCode` / `nextIdByTime`)+ `newId()`(nanoid 主键);改 `ID_PREFIX` 换成自己的前缀 |
| 字典读取钩子 | `hooks/use-dict.ts` | **作为模板底料保留**:页面消费 `sys_dict` 的统一入口(派生项目里把 `dict.byCode` 接好即可用) |
| 表单版式套件 | `shared/form-kit.tsx`(`FieldGrid` / `FormSection` / `FormActions` / `ReadonlyField` / `TagField`) | **作为模板底料保留**:如果项目要改成统一表单布局,直接用、不用再重写。系统设置各页目前是手写表单(`doc/前端结构与组件约定.md` 那套「逐页手写」的口径) |
| 权限点选择区 | `shared/permission-tree.tsx`(`PermissionTree` / `PermissionPicker`) | **作为模板底料保留**:重建授权界面时直接用,不用再手写「标题 + 计数 + 搜索 + 全选/清空 + 树」那一块 |

> 这张表只登记**作为模板底料,衍生项目时启用**的件(代码层保留,留作新项目直接用的封装)。本轮删掉了三类名不副实的行:
> 指向不存在的目录(`lib/crud` / `lib/validators` / `store` / `shared/use-column-visibility`)、
> 本轮删掉的文件(`lib/db-errors.ts` / `mocks/shared.ts` / `mocks/dicts.ts`)、
> 以及其实**有**调用方的 ui 原语(它们由工作台的 UI 示例使用)。

**新增可复用件时:要么给它一个真实调用方,要么在工作台展示(本项目即 `components/modules/workbench/ui-gallery.tsx`,它现在同时覆盖 `ui/` / `shared/` / `lib/`),要么登记进上表** —— 三者都不做就会被下一轮清理当成死代码删掉。

展示分两层(见 `ui-gallery.tsx` 文件头):**能独立渲染的就真跑**(拖拽 / 勾选 / 校验都点得动);满足不了下面任一条的只给「签名 + 指路」卡 ——
① 需要 TanStack Form 的 field context(`shared/form-kit`);② 会把重依赖拖进**工作台首屏包**(`shared/icon-picker` → 全量 lucide;`shared/excel-*` → xlsx);
③ 服务端专用(`lib/auth` / `lib/sys-para` 引 drizzle,客户端 import 会把 mysql2 打进浏览器)。**别为了"先注册一个"就把重依赖 import 进这一页。**

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
| `src/db/schema.ts` | 只剩 `todos` 示例表 | 由 drizzle 迁移管理(`drizzle/`) |
| `src/db/data-base-schema.ts` | **系统表九张**:系统设置五张(`sys_menu` / `sys_dict` / `sys_para` / `sys_tag` / `sys_tag_relation`)+ **认证四张**(`sys_user` / `sys_session` / `sys_account` / `sys_verification`) | **不进迁移**:只声明"读写的形状",DDL 由 `scripts/create-system-tables.ts`(`pnpm db:create`)**和** `scripts/create-better-auth-tables-dm.ts`(达梦)维护。**改列之后要同时改它 + 这两个脚本** |

**不要把 `data-base-schema.ts` 的表并进 `schema.ts`** —— 下次 `db:generate` 会生成 `CREATE TABLE`,而库里已存在 → `db:migrate` 直接 1050 报错。

- 连接在 `src/db/index.ts`,用 `drizzle-orm/mysql2`,导出 `db`
- 迁移配置在 `drizzle.config.ts`:dialect `mysql`,输出 `./drizzle`,`schema` **只指向** `./src/db/schema.ts`,读 `.env.local` → `.env`
- env 流转:`.env.example`(随模板分发,无凭据)→ `cp .env.example .env.local`(本地填写,已 gitignore)
- `DATABASE_URL` **缺失会直接抛错**,`src/db/index.ts` 与 `drizzle.config.ts` 都有显式检查
- 改 schema 后:`pnpm db:push`(开发期)或 `pnpm db:generate && pnpm db:migrate`
- 建表:`pnpm db:create`(九张系统表 = 设置五 + 认证四,幂等 `create table if not exists`,不 drop 不 seed)
- 种子:`pnpm db:seed:menus`(把 `NAV_NODES` 写进 `sys_menu`)、`db:seed:dicts`、`db:seed:paras`、`db:seed:tags` —— 四个都幂等"只补不覆盖"
- 老库换主键:`pnpm db:migrate:ids`(语义 id → nanoid + 补 `sys_dict.code` + 修 `para_type` 与值不匹配的行;幂等)
- 表注释 / 列注释 / 索引名:`pnpm db:sync:meta`(表名改过之后注释不会跟着变,会留下"描述旧列名"的残留 —— 那比没注释更误导)。
  **注释的唯一真源是 `scripts/sync-table-meta.ts`**(表注释 + 列注释两张清单),**别往建表脚本的 CREATE 里塞注释**;`pnpm db:create` 建完表会自动调它一次。
  MySQL 没有 `comment on` 语法,改注释只能 `alter table … modify column …` 把**列定义整条重写**;达梦走 `comment on table/column`(不用重写定义)。详见「已知陷阱 ▸ MySQL 改注释」
- `db` 只能在服务端用(tRPC procedure、server function)。不要从客户端组件 import

### 认证(Better Auth)

**整个后台 `(main)` 都要登录**,登录页在 `/login`(故意放在 `src/routes/` 根下 —— 没有后台外壳)。

| 件 | 位置 | 说明 |
| --- | --- | --- |
| 服务端实例 | `src/lib/auth.ts` | `drizzleAdapter(db, { provider: "mysql", schema: { user: sysUser, session: sysSession, account: sysAccount, verification: sysVerification } })` + `emailAndPassword` + `tanstackStartCookies()`。**只在服务端 import** |
| HTTP 入口 | `src/routes/api/auth/$.ts` | GET/POST 都交给 `auth.handler`(在 `(main)` 之外,所以不会被守卫拦住) |
| 登录页 | `src/routes/login.tsx` | 邮箱 + 密码;`?redirect=` 只接受站内路径(挡开放重定向);已登录会自动跳走 |
| 守卫 | `src/routes/(main)/route.tsx` → `beforeLoad` | `createServerFn` 里 `auth.api.getSession({ headers: getRequestHeaders() })`;没有会话就 `redirect({ to: "/login", search: { redirect: location.href } })` |
| 顶栏用户菜单 | `src/components/layout/topbar.tsx` | 显示姓名 / 邮箱 + 退出登录;用户信息由 `beforeLoad` 返回、经 `SidebarProvider` 传到顶栏(SSR 首帧就对,不会先闪"管理员") |
| 表定义 | `src/db/data-base-schema.ts` | 四张表叫 `sys_user` / `sys_session` / `sys_account` / `sys_verification`(auth 是**系统内部服务**,按项目口径吃 `sys_` 前缀、不进 drizzle 迁移) |
| 回归测试 | `tests/better-auth.test.ts` | 注册 / 登录 / 取会话 / 错密码 / 登出,并回查库里落了什么行 |

**两条硬约束**(踩过):

- **守卫必须在服务端做,而且 `createServerFn` 的 handler 里要动态 import server-only 模块**。路由文件被 `routeTree.gen.ts` 静态引用,顶层 import `#/lib/auth` 就会顺着 `#/db` 把 mysql2/dmdb 拖进客户端包 —— 浏览器里没有 `Buffer.prototype`,整个应用直接崩(同一坑的详细记录见 `routes/(main)/demo/drizzle.tsx` 顶部)。客户端的 `authClient.useSession()` 只能用于**展示**,不能当守卫:它异步,首帧没有结论,未登录的人会先看到后台外壳。
- **不开放自注册**:`/login` 只登录,没有注册页。账号得先在库里建 —— 用 better-auth 自己的接口建最稳(密码会被正确地 scrypt 哈希):

  ```ts
  // 一次性脚本(tsx 跑):pnpm exec dotenv -e .env.local -- tsx <脚本>
  import { auth } from "#/lib/auth";
  await auth.api.signUpEmail({ body: { email: "you@example.com", password: "改成强密码", name: "你的名字" } });
  ```

  注意 `signUpEmail` 会**顺手建一个会话并落下 cookie**,脚本里记得 `db.delete(sysSession)` 清掉(`sys_user` 等四表从 `#/db/data-base-schema` 导入)。
  如果需要长期可用的建用户命令(`pnpm auth:create-user`),说一声就加 —— 本轮没做是因为没确认要。

### 达梦(DM)支持

`DATABASE_URL` 以 `dm://` 开头时自动走达梦驱动(`src/db/dm/`),业务代码零改动 ——
`db.select()` / `db.insert()` / `db.transaction()` 写法完全一样。

```bash
# .env.local
DATABASE_URL="dm://SYSDBA:SYSDBA@127.0.0.1:5236?schema=eg&loginEncrypt=false"
```

**三个必须知道的前提**(都踩过):

| 前提 | 为什么 |
| --- | --- |
| `?loginEncrypt=false` | **必须带,否则连不上。** 达梦的登录握手用 **DES-CFB** 加密,而 DES 在 OpenSSL 3(Node ≥17;本机 Node 24 + OpenSSL 3.5.7)里被移进 **legacy provider**、默认不加载 → dmdb 建会话密码器时报 `ERR_OSSL_EVP_UNSUPPORTED`,达梦只回 `[6071] 消息加密失败`,而连接池那条 Promise **既不 resolve 也不 reject** —— 症状是**连接挂住、不报任何错**。关掉登录加密即绕开:**不需要任何 Node 启动开关**(实测:不带它连 `select 1` 都过不去;带上它 + 零 flag,29/29 全过)。**驱动会自动兜底**:URL 里没写 `loginEncrypt` 时 `src/db/dm/index.ts` 自动补 `=false`(并打一条 `dm.login_encrypt_defaulted` 日志)—— 所以「忘了写就静默挂住」这个坑不可能再复发;显式写 `loginEncrypt=true` 会告警提醒你先跑 `pnpm check:legacy` |
| `?schema=<模式>` | 达梦的"登录模式"属性。表在 `eg` 模式而登录用户是 SYSDBA 时,不指定就会 `无效的表或视图名[sys_para]`。**没写会打一条 `dm.no_schema_param` 告警**(这个没法自动兜底 —— 驱动猜不到你的表在哪个模式) |
| `pnpm db:dm:defaults` | 项目的表在 MySQL 上靠 DDL 的 `DEFAULT`(`sort default 0` / `status default 1` / `create_time default current_timestamp`)兜底,而 drizzle 的 `.default()` 表示"我不写这列"。达梦建表若没带默认值,任何省略这些列的 INSERT 都会 `违反列[X]非空约束` —— 这个脚本幂等地补上 |

**安全权衡(自己判断)**:`loginEncrypt=false` 意味着登录凭证不再走那段加密传输。两点事实:① 那段「加密」本身就是 **DES-CFB(56 位有效密钥)**,对真正的攻击者约等于没有;② 备选方案 `--openssl-legacy-provider` 是**进程级**地把 legacy 算法全开(MD4 / RC4 / DES… 任何依赖都能用),影响面反而更大。**所以默认选 `loginEncrypt=false`**:影响只限这一条连接的登录步骤,而不是整个 Node 进程的密码学能力。要跨不可信网络连达梦,正解是走 **SSL**(dmdb 有 `sslPath`,服务端配证书),而不是靠 DES。

**哪天需要开着登录加密**(或遇到「连接挂住且无报错」):

```bash
pnpm check:legacy   # 一秒诊断:当前 Node 进程能不能用 DES-CFB(legacy 算法)
```

要开就得给 Node 加 `NODE_OPTIONS=--openssl-legacy-provider`。⚠️ **`.npmrc` 的 `node-options` 在 pnpm 下不生效** —— 本机 pnpm 11.23.0 实测:`.npmrc` 写不写结果一样(都不可用),只有 shell / CI 层的环境变量或脚本内联才管用(官方 npm 认这个键,pnpm 不认)。

**驱动实现要点**(`src/db/dm/translate.ts` + `session.ts`,都是 dmdb 与 drizzle 的差异,drizzle 官方没有达梦方言):

- **占位符 `?` → `:1,:2…` + 反引号标识符 → 双引号**:`rewriteForDm()` 用状态机扫描(区分代码 / 单引号 / 双引号 / 反引号 / 注释),drizzle/mysql-core 生成 MySQL 语法,达梦默认模式不认。
- **不能靠 `COMPATIBLE_MODE=4`**:它是静态参数,`SP_SET_PARA_VALUE` 在运行期会报 `-839 不能修改静态配置参数的内存值`,只能改 dm.ini 重启 —— 所以走进程内翻译,服务器零改动。
- **影响行数字段叫 `rowsAffected`**(不是 mysql2 的 `affectedRows`):写错会静默拿到 `undefined`,症状是"删除成功但返回影响行数 0"。
- **写操作必须回 mysql2 那套 `[ResultSetHeader, FieldPacket[]]` 元组**:项目里读的是 `(await db.delete(...))[0].affectedRows`。
- **`dmdb.fetchAsString = [CLOB, DATE]`**:CLOB 默认回 Lob 对象(text 解码器要字符串)、DATE 默认回 Date 对象(drizzle 的 datetime 解码器却调 `value.replace(" ","T")`)。
  ⚠️ **这两行别在重构里弄丢**:丢过的症状是 24/29 用例失败(`value.replace is not a function` / `BigInt` 序列化报错),因为它们决定的是驱动回什么 JS 类型。另有配套的 `normalizeValue()`(BigInt → Number、Lob → 字符串)在同一文件。
- **达梦:`text`(CLOB)列不能直接和绑定参数做 `=` 比较**(实测报 `-6105 数据类型不匹配`;字面量 `= 'x'`、`like :1`、int/varchar 列的比较都正常)。四种可用绕法(都实测过):`like :1`(最省事)、`cast(:1 as varchar(4000))`、`to_char(col) = :1`、`dbms_lob.compare(col, :1) = 0`。
  当前代码里**没有**踩到(所有 `where(eq(...))` 都落在 varchar/id 列上),但**以后要在 `para_value`(text)/`desc`/`items`(json→text)/`todos.title` 上过滤时,别写 `eq()`**,要么改 `like`,要么给列换 `varchar(n)`。
- **json 列要驱动侧解析**:mysql2 会自动把 JSON 列解析成对象,所以 drizzle/mysql 的 json 列**没有** `mapFromDriverValue`。达梦这边 `items` 是 TEXT,回的是 JSON 字符串 —— 按列类型(`{path, field}` 包装里的 `.field.columnType === "MySqlJson"`)判断后解析。
- **事务没有 `BEGIN` 语句**:达梦不接受裸 `BEGIN`;靠执行选项 `autoCommit:false` + `Connection.commit()/rollback()` 表达(比 drizzle 自带的 `mysql-proxy` 强,那个直接抛 not supported)。
- **达梦不支持 DDL 的 `ON UPDATE CURRENT_TIMESTAMP`**(试过,报 `-2994 设置的ON UPDATE表达式错误`),所以**每处 UPDATE 都显式写 `update_time: new Date()`**(routers 里 7 处)。MySQL 上同时写也没坏处 —— 两个方言语义因此一致,不必再靠 DDL 的隐式行为。

**系统的九张表在达梦上怎么来**:MySQL 走 `scripts/create-system-tables.ts`(`pnpm db:create`,含认证四表);达梦走不了 `create table` 那套 MySQL 方言,所以另有一份手写 DDL —— `pnpm db:dm:create-ba`(幂等,建 `sys_user` / `sys_session` / `sys_account` / `sys_verification` + 示例表 `todos`,含外键与索引)。除 `todos` 外的表都**不进 drizzle 迁移**(迁移只管 `todos`)。
**改 `src/db/data-base-schema.ts` 之后要同时改这两个建表脚本**(MySQL 的 `create-system-tables.ts` + 达梦的 `create-better-auth-tables-dm.ts`)—— 漂移了 better-auth 会在运行时报「Model xxx not found / field not found」或「Missing columns」,`typecheck` 抓不到。同理,达梦期间 MySQL 专属命令(`db:migrate` / `db:push` / `db:studio`)连不上(它们按 mysql 方言解析 `dm://` 串),要用就把 `DATABASE_URL` 临时切回去。

**注释**:达梦侧的表注释 / 列注释也由 `pnpm db:sync:meta` 对齐(`comment on table/column`,不需要重写列定义)。注意它的注释视图**两套字段名**(实测):表注释在 `SYS.ALL_TAB_COMMENTS.OWNER`(就是模式名),列注释在 `SYS.ALL_COL_COMMENTS.SCHEMA_NAME` —— 用错字段会「无效的列名」。

**认证的回归测试**:`tests/better-auth.test.ts` 覆盖注册 / 登录 / 取会话 / 错密码 / 登出,并在每步回查库里真的落了什么行(含布尔与时间的类型往返)。两个方言都跑过:达梦 34/34、MySQL 34/34。

**边界**:`drizzle-kit` 的 dialect 是硬编码枚举,**没有达梦**,所以 `db:generate` / `db:migrate` 对达梦无意义 —— 建表继续手写 SQL(本项目九张 `sys_*` 表本来就是这样)。`show tables` / `information_schema` 是 MySQL/PG 习惯,达梦用 `SYS.ALL_TABLES`;这些只出现在 `scripts/` 里,不影响业务代码。

**方言口径**:默认与主要目标是 MySQL(不要写 `pg` 的 `Pool` / `postgres` dialect);达梦是**可选的第二条线**,上面那节就是它的全部前提与差异。schema 文件、routers、页面都不分方言 —— 方言差异全部收在 `src/db/dm/` 与 `scripts/dm-*.ts` 里。

## 已知陷阱

- **永远不要提交 `.env*`。** `.gitignore` 已覆盖 `.env`、`.env.*`、`*.local`,并保留 `!.env.example`。`.env.example` 是唯一允许入库的 env 文件,且必须不含真实凭据。
- **不要删 `src/router.tsx`。** 它不在任何 import 图里(TanStack Start 按**约定路径**发现并加载它),所以"扫引用找死代码"的脚本会误判它是孤儿。删了直接起不来服务。这个坑真实发生过一次。
- **不要把 `start-tpl` 这个字符串硬编码进业务代码。** 它只应该出现在 `package.json` 的 `name` 和文档里。项目名相关的展示文案走配置或 env。`localStorage` 的 key 尤其要注意加项目前缀。
- **`src/routes/(main)/demo/` 及其支撑文件可以整目录删除**:`demo/` 目录、`hooks/demo.form-context.ts`、`hooks/demo.form.tsx`、`lib/demo-store.ts`。本模板 `__root.tsx` 的 devtools 只挂了 Router 与 Query 两项(Store devtools 已随业务清理),所以**删 demo 不需要改 `__root.tsx`**。
- **删掉 demo 后必须补一行 `import "@tanstack/react-start";`**(放在 `src/router.tsx` 顶部)。`server: { handlers }` 这个路由选项的类型来自 `@tanstack/react-start` 的模块增强,而全项目只有 `(main)/demo/sentry.testing.tsx` 和 `(main)/demo/drizzle.tsx` 引用了它。不补的话 `src/routes/api/auth/$.ts` 与 `src/routes/api.trpc.$.tsx` 会报 `'server' does not exist in type ...`。
- **UI 示例已收在 `components/modules/workbench/ui-gallery.tsx`(+ 同目录 `ui-gallery-table.tsx` 的台账表格示例)**。原来那 7 条 `/showcase/*` 路由在本轮之前就并进来了;要精简模板,删这一个文件即可(`routes/(main)/index.tsx` 引用它)。
- **demo 目录是"简单示例页"**:每个页面只演示一项能力,且全部用模板自身的组件写。`(main)/demo/table.tsx` 用的是 `useAppTable`(`src/lib/table.ts`)而不是裸的 `useTable`,可以当作接真实 CRUD 表格的参照。这些页面当前不报任何类型或 lint 错误,删或留都不影响 `pnpm typecheck` / `pnpm check` / `pnpm build`。
- **`sql\`... in (${数组})\` 是错的**:drizzle 会把数组渲染成**一个括号元组**(`in (('a','b'))`),MySQL 直接报 `ER_OPERAND_COLUMNS: Operand should contain 1 column(s)`。数组条件一律用 `inArray(column, ids)`。踩过:标签级联删除/子节点删除/按 id 批量查,三处都中招,单元素时不报错所以很难发现。
- **调用函数漏括号 = 哑巴 bug(两处都真实踩过)**:`event.preventDefault`(无括号)是一个空表达式,什么也不做;`await invalidate;` 更隐蔽 —— 它 await 的是**函数引用**,立刻 resolve,于是"什么都没失效",症状是"改完了列表不动、得手动刷新"。同一批代码里这两类各踩了 7 次(菜单 4 + 字典 3)。写法上:`await invalidate()`、`event.preventDefault()`;**改完顺手 grep 一遍 `await \w+;`**。
- **MySQL 改列注释 = 重写整条列定义,漏一个子句就静默改坏列**(真实踩过):MySQL 没有 `comment on`,只能 `alter table … modify column …`,而它要求把列定义**完整重写**。踩过的两个坑:
  ① 漏了 `EXTRA` → 设置表的 `update_time datetime(3) not null default current_timestamp(3) on update current_timestamp(3)` 被改成没有 `on update`、**精度也没了**,更新数据时时间不再自动刷新,而且只有对着 `show create table` 才看得出来(`scripts/sync-table-meta.ts` 的 `COLUMN_REPAIRS` 就是补这个的);
  ② `select extra` **不写别名**读回来的是 `undefined` —— `information_schema` 的字段名是**大写 `EXTRA`**,别的字段我当时都起了别名,就漏了它。症状是"改注释把 `not null` / `auto_increment` / `on update` 一起抹了"。
  改这段代码后请一定跑一遍 `pnpm db:sync:meta` 两次:**第二次必须报「无需改动」**,否则就是没幂等、正在反复改坏列。
- **`pnpm db:push` 会提议删掉 9 张系统表**(它只认 `drizzle.config.ts` 的 schema = `src/db/schema.ts` = `todos`):终端里它会警告 "You're about to delete sys_menu table with 8 items" 然后等你确认 —— **手快确认就是丢数据**。系统表的正道是 `pnpm db:create`(建表)+ `pnpm db:sync:meta`(注释),迁移只用 `db:generate` + `db:migrate`。
- **Better Auth 四表的 drizzle 属性名必须是驼峰,不能跟 `data-base-schema.ts` 的 snake_case 惯例**:写成 `email_verified: boolean("email_verified")` 时 BA 会报
  `Drizzle schema mismatch / Missing columns: user.emailVerified …`,还附带警告「session.expires_at 是 BA 永远不会写的必填列」,随后**所有认证调用直接失败**(测试 5/5 秒挂)。
  它按 **drizzle 属性名**找模型字段。**表名反而随便改**(它按 `src/lib/auth.ts` 传给 adapter 的映射**键名**找表)—— 这就是四表能叫 `sys_*` 的原因。
- **`src/components/ui/` 是 Base UI,不是 Radix** —— shadcn 文档里大量是 **Radix** 写法,**照抄会静默失效**(类型不报错、点了没反应、菜单照常弹开):
  - `DropdownMenuItem` 的点击回调是 **`onClick`**;写 Radix 的 `onSelect` = 传了个没人认的 prop(踩过:「退出登录」点了毫无反应,查了半天才发现)。
  - 多态写法是 **`render`**;`asChild` 在这个项目里不存在。
  - `Menu.Item` / `DropdownMenuItem` 默认渲染 **`div`**;要真按钮语义用 `nativeButton`。
  - 拿不准就看它 `extends` 的 `BaseUIComponentProps<...>` / `XxxProps` 的 `.d.ts`(在 `node_modules/.pnpm/@base-ui+react@*/…` 下),别按 Radix 的记忆写。
- **事件方法漏括号是「哑巴 bug」,拖拽尤其致命**:`event.preventDefault`(无括号)是一个空表达式 —— 不报错、不 lint、编译也能过,但它**什么也没做**。HTML5 拖放的规则是「`dragover` 里调了 `preventDefault()`,`drop` 才会触发」,所以漏这一对括号的症状就是"拖了半天没反应"。`settings-menus-tree.tsx` 踩过这个坑(同目录的 `settings-tags-tree.tsx` 是正确参照)。改事件处理时对一眼括号数。
- **TanStack Table v9 的行模型必须写成「具名 slot + 调用」**:`tableFeatures({ sortedRowModel: createSortedRowModel() })`。写成 `createSortedRowModel`(无 key、未调用)属于**不会报错的错误**:类型照样通过,但 `getSortedRowModel()` / `getPaginationRowModel()` 实际不存在,症状是**页码算得对(显示"共 4 页")却把全部行都渲染出来**。`src/lib/table.ts` 已按正确写法修复并实测验证,不要改回去。
- **设计 token 只有一套**:`src/styles.css` 只保留语义 token 与 `@theme inline` 映射,色值与字体全部由 `DESIGN.md` 决定(映射见上文"设计系统")。
- **主题只有一套**:顶栏切换按钮(`components/layout/topbar.tsx`)与 `__root.tsx` 的首屏引导脚本共用 `src/lib/constants.ts` 的 `THEME_STORAGE_KEY`,无存储值时都回落到系统偏好。改主题必须同时改这两处的读取逻辑。
- **`__root.tsx` 不渲染任何页面外壳**,只有 HTML 骨架、主题引导脚本与 devtools;页面外壳统一在 `(main)/route.tsx`。它另外配置了 `notFoundComponent`(用 `EmptyState`),不要删掉。
- **`src/components/ui/*.tsx` 里残留的 `"use client"` 指令已清理**。那是 Next.js 专用指令,在 TanStack Start 里是无意义的噪音,新加组件时如果 shadcn 模板带进来,删掉即可。
- **`components/ui/` 里 vendored 组件的 lint warning 不要顺手清理**(见上文"新增 shadcn 组件")。当前基线 4 个 warning 里有 3 个出自 `badge-list.tsx`。
- **时间格式化只走 `lib/time.ts`**。曾经两个文件各有一套日期函数,同一个值在两处可能给出不同结果(而 `toISOString()` 是 UTC,当『给人看的时间』用会差 8 小时 —— 真实踩过两次)。现在只此一处时间模块,**其它任何文件都不要再加日期函数**。
- **权限弹窗直接用模板里这唯一一个 `PermissionPicker` 实现**(`shared/permission-tree.tsx`)。不要在业务页里再手写「标题 + 计数 + 搜索 + 全选/清空 + 树」那一块 —— 全都长得一样,改起来散在各处。
- **`mocks/*` 是演示数据,不是业务真相**。当前**只剩 `mocks/tags.ts`** 一个文件(「标签管理」页的示例标签体系 + `seed-tags` 的种子来源)。`mocks/settings.ts`(791 行种子 + 权限点目录)、`mocks/shared.ts`、`mocks/dicts.ts` 都已删除 —— 前者是因为用户 / 用户组 / 角色三页改成了 `StubPage` 占位,后两个是零调用方的残留。别再往回加。
- **树的"限高 + 内部滚动"也在 `shared/sortable-tree.tsx` 里**(`max-h-[62vh] overflow-y-auto` + `scrollbar-gutter: stable`)。原来是页面各包一层,菜单页包了、标签页漏了,于是标签一多就复发同一个问题:树把页面撑得很长,点最下面那个节点时右侧详情已经滚出屏幕。**树的布局约束跟树一起走,不要分到调用方**。
- **同一个交互不要写两遍**。菜单树与标签树曾经各有一份「同级判定 + dragover/drop + 提示线 + 折叠 + 键盘上下移」(约 150 行逐字重复),其中的括号坑只在其中一份修过。现在统一走 `shared/sortable-tree.tsx`,页面只提供 `renderRow`。**通用组件里不要出现具体业务的名字**:`shared/tag-badges.tsx` 曾经写死 17 个中文维度名并 import `mocks/tags` 取色 —— 通用层一旦耦合演示数据,派生新项目后全是死映射。
- **不要重建"权限过滤"这层空转**。侧边栏 / 面包屑 / 模块概览现在直接读菜单树(`nav-data.ts`);曾经的 `nav-permissions.tsx`(Context + `filterNavByPermission`)在整个仓库里 `granted` 恒为 `null`,所有过滤都是恒等映射 —— 纯伪扩展点,已删。真接权限服务时再加参数,别提前把签名铺开。

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
