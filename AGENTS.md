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
| 组件示例 | 工作台 `/` 的 `components/modules/workbench/`(`ui-gallery.tsx` + `ui-gallery-table.tsx` + `workbench-tagging.tsx`) | ★ **三样都在这一页验收**:44 个 `ui/` 原语(`Button` 的变体与 `ActionButton` 都有格子)、`shared/` 的通用交互件(SortableTree / PermissionPicker / LedgerToolbar / …)、`lib/` 的通用工具(time / ids / format / mock-table / …),再加表格与打标签两组实战示例。**改封装后这里就是验收现场** |
| 框架能力 | `routes/(main)/demo/` | 7 个可运行样例:tRPC / Query / Form / Table / Drizzle / Auth / Store(可整目录删除) |
| 系统设置 | `routes/(main)/settings/` + `components/modules/settings/` | ★ 唯一保留的真实业务:**7 页全部接真实数据**(用户 / 部门 / 角色 / 标签 / 菜单 / 字典 / 参数)——其中部门 · 角色 · 用户三页就是一套完整的 **RBAC 骨架**(见「数据库 ▸ 权限模型」) |

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
pnpm db:seed:rbac     # RBAC 演示数据:部门 / 角色 / 按钮权限点 / 授权 / 两个演示账号(幂等)
pnpm test             # 直调 tRPC procedure 的集成测试(需要 .env.local 指向的库)
pnpm db:create        # 建系统表十四张(设置五 + 认证四 + 权限五,幂等;建完顺带对齐列注释 / 索引名)
pnpm db:sync:meta     # 对齐**表注释 / 列注释 / 索引名**(MySQL 与达梦都支持,幂等)
pnpm db:dm:smoke      # 达梦连通性冒烟:drizzle 走 select/insert/update/delete/transaction
pnpm db:dm:defaults   # 给达梦表补默认值(达梦建表没带 DEFAULT 时必跑,幂等)
pnpm db:dm:create-ba  # 给达梦建认证四表 + 权限五表 + todos(幂等;注:设置五表在达梦上仍无产出脚本,见陷阱)
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

视觉规范是 **`DESIGN.md`**(Inspired by Airtable),token 落在 `src/styles.css` —— **两处都别绕过**。

- **改视觉只改 token** ✓:不写死 hex ✓,也不写 `bg-[color:var(--af-hover)]` 这种任意值 ✓(var 名拼错会**静默失效** ✓)。
- **不要覆盖 Tailwind 的 `--radius-*` 命名空间** ✓(默认阶就是 `DESIGN.md` §5 要的 ✓)。
- **不要在渲染期用 `Math.random()`** ✓(SSR 水合不一致 ✓);要「看起来随机」用 `useId()` 或数据的稳定哈希 ✓。
- **告警语义只走 `--success` / `--warn` / `--danger`** ✓(`emerald` ≠ `success` ✓);一屏色相不超过 4 个 ✓。
- **色相 → 类名的映射只有一份**(`styles.css` 的 `@theme inline` ✓):加色相改**三处**(`:root` / `.dark` / `@theme inline` ✓)——
  **漏了第三处不报错、类名静默不生成** ✓,这是最容易踩的一条 ✓;**Tailwind 只扫字面量类名** ✓,不能拼接 ✓。
- **动效**先查 `DESIGN.md` §7.1 的现成原语 ✓;**阴影**用 `shadow-card|soft|glow` + 抬升三档 `shadow-raise-1|2|3`(hover 只换档位 ✓)。

色相表 / `@theme inline` 全量映射 / 字体字距 / 阴影变量 → **`DESIGN.md` 末尾的「token 细则」** ✓。
### 同类页面必须同形(加 / 改通用功能前先读这一条)

**这是约定,不是建议**:同一个动作在全站只能有**一种形态**,而且**同类页面必须都长出来**。
所以"改一个通用功能"≠"改被点名的那一个" —— 得把同类页面一起扫一遍。反过来也成立:
做不出第二处的"独一份"设计,要么推广、要么删掉。

已经收成"一处真源"的**版式骨架**(改之前先看对应章节):

| 位置 | 形态 | 章节 |
| --- | --- | --- |
| 页头右侧 | **信息徽章 → 刷新(纯图标)→ 新增(图标 + 文字)**,顺序固定 | 本节 ▸ 刷新 / 台账布局 |
| 工具条(卡片外) | 搜索框 + 右端操作组(刷新 / **列** / 导出 / 新增);**搜索不放进卡片** | 台账布局 |
| 表格字段 | **表结构有几列就显示几列**,收放交给工具条的「列」开关(`ColumnToggle`) | 台账布局 |
| 表格行内 / 工具条 | **纯文字**操作按钮(悬停出下划线),不带图标 | 按钮分两族 |
| 树的行尾 | **纯图标**,悬停才显形 | 树 |
| 卡片边界 | 静止 1px `border-border`,悬停刷成亮蓝 | 卡片(已知陷阱) |
| 列表页高度 | 占满主区,内容在卡片里滚 | 高度 |

**动手时按这个顺序自检**(都是真实踩过的):① 先找同类页面的**现有实现**,别新写第二种;
② 数一遍"同类页面是不是都有" —— 一次性实测抓到过:7 个设置页里 **3 个整个漏了刷新**(字典 / 菜单 / 部门)、
4 个台账页的「新增」**1 个没图标**(角色)、顶栏还挂着一条**没有 `onClick` 的装饰性「新增用户」**;
③ 改完**全站 grep 一遍**同类处,别只改被点名的那一个。

### 禁止薄封装(改/加组件前先读这一条)

**只为了转发而存在的组件一律不许加** —— 项目已有过一次:`TagBadges` 的全部内容就是
`return <BadgeList values={[...tags]} layout="wrap" color="stable" />;`,于是同一个东西有了两个名字,
别人搜 `BadgeList` 搜不到用它的地方、读 `TagBadges` 还得跳进去才知道是哪个组件。**已删,调用点直接写 `BadgeList`。**

判定:**把这一层删掉,调用点能不能直接写出来?** 能 → 就是薄封装,删。
- ✗ 只换名字 / 只预设几个 prop 的转发:`TagBadges`、`export const X = Y`、`export { A as B }`、barrel `index.ts`;
- ✗ 只透传 props:`function X(props) { return <Y {...props} /> }`;
- ✓ **保留**的是"删掉之后调用点会重复一段**结构**或**逻辑**"的件:`DetailRow`(标签 + 值的栅格形态)、
  `RefreshButton`(busy 转圈 + 全站统一刷新入口)、`TextCell`(占位符 + 截断)、`ScoreText`(分档配色)、
  `PageFrame`(flex 高度链)—— 它们不是"另一个组件的别名",而是本来就**没有**的形态。

改完顺手自查一遍(三种形态都要扫):
```bash
grep -rnE "^export const [A-Z][A-Za-z]* = [A-Z][A-Za-z]*;" src/     # 别名赋值
grep -rn "^export \* from" src/                                    # 整模块转发
grep -rn "return <[A-Z][A-Za-z]* {\.\.\.props}" src/              # props 透传
```
### 按钮分两族(改按钮前先读这一条)

| 族 | 用在哪 | 长什么样 |
| --- | --- | --- |
| `ui/button.tsx` 的 `Button` | **主操作**与对话框动作(新增 / 保存 / 提交 / 导入 / 确定 / 取消 / 关闭),以及外壳图标按钮(通知 / 主题 / 侧边栏 / 分页箭头) | 有底色或描边、可带图标;图标在这些位置是识别线索(保存配对勾、新增配加号) |
| **`ui/action-button.tsx` 的 `ActionButton`** | **操作按钮** —— 表格行内 / 工具条 / 详情卡/子项列表里那些"针对某条数据的小动作":详情 / 编辑 / 删除 / 启用停用 / 移出 / 上移下移 / 新增子项 / 批量删除 / 取消选择 / 全选清空 / 下载模板 | **纯文字、不带图标、悬停才出下划线**;窄位置上不挤不重 |
| **`ui/action-button.tsx` 的 `ActionIconButton`** | **只给树的窄位置** —— 行尾(还要放名称 / 徽章)与树顶部工具条(全部展开 / 折叠) | **20px 纯图标 + 悬停变色底**;`label` 必填(同时给 `aria-label` 与 `title`)—— 图标按钮没有可见文字,不交代就只能靠悬浮猜 |

- **为什么要分开**:操作按钮所在的位置**空间很窄**(表格操作列一行要并排 3~5 个),图标 + 方框在那里又挤又重;
  统一成文字链接后"详情 / 编辑 / 删除"在每一页长得一模一样。
- **文案口径**(同一件事不换名字):`详情` · `编辑` · `删除` · `启用` / `停用` · `移出` · `上移` / `下移` ·
  `新增子节点` · `批量删除` · `取消选择`。新增类统一用**新增**(不要"新建"),删除类统一 `tone="danger"`。
- **页面刷新统一用 `ui/refresh-button.tsx` 的 `RefreshButton`** —— **纯图标**(`RefreshCw`)、`size="icon-sm"`、
  `aria-label`/`title` 都是「刷新」,`busy` 时**转圈 + 禁用**。**每个页面的页头都要有一个**(放在 `actions` 里:
  信息徽章 → 刷新 → 主操作 CTA);页内卡片上的额外刷新入口(台账工具条)也用这一个。
  ⚠️ 别手写带文字的「刷新」按钮、也别换第二个图标 —— 以前各页各写,结果字典 / 菜单 / 部门三页**整个漏掉了**。
- `ActionButton` 的 `children` **类型上只收字符串** —— 想塞图标会先编译不过(要图标就该想想是不是该用 `Button`)。
- 行操作列(`shared/table-kit.tsx` 的 `actionsColumn`)默认宽 **132**(文字比图标占地方;给窄了会换行把行高撑开)。

### 列表页版式:一律「台账布局」

设置模块的列表页(参数 / **角色 / 用户** / 字典 / 标签 / 菜单 / 部门)统一这一套,照抄 `settings-parameters-page.tsx`:

```
PageHeader(标题 + 说明 + actions:刷新(RefreshButton) + 新增xx(Button))
StatCards(3 张:总数 / 状态分布 / 关联计数)
LedgerToolbar(搜索 + 右端「列」开关)   ← **在卡片外面**;筛选 chip 用 FilterChips
Card(「xx 清单」+ 匹配 N 条 Badge)
  CardContent:
    TableLoadingShell → DataTable   ← 表格与加载态;列定义放同目录 `-table.tsx`
    PaginationControl               ← **必须有分页**:行数长起来时不能一屏铺到底
详情对话框(只读,`shared/detail-dialog` 的 `DetailDialog` + `DetailMeta`;**字段在页面里内联写**,多值字段用 `ui/badge-list` 的 `BadgeList`)+ 新增/编辑 `-form.tsx`
+ 专用动作对话框(如「菜单权限」)+ ConfirmDialog(删除)
```

- **列表页的数据要在路由文件里预取**(`loader: ({ context }) => context.queryClient.ensureQueryData(...)`)——
  否则 SSR 只直出卡片壳、行要等 hydration 才出现(参数/字典页一直是这么做的,新页面容易漏)。
- 行操作走 `shared/table-kit` 的 `actionsColumn`(`extra` 放页面特有动作,如「菜单权限」),
  **别手写操作列**。逐行禁用(如"内置只读参数不能改")用 `disabled: (row) => boolean`。
- **搜索框在卡片外面**:`LedgerToolbar` 是页面的一个平级子元素(夹在 `StatCards` 与主体 `Card` 之间),
  **不要塞进 `CardContent`** —— 搜索被卡片边框圈起来会显得它属于卡片里的表格,而它其实是页面级筛选。
- **表格列 = 对应表的全部列**,一个不少(排障 / 核对数据要能看全);不要替使用者判断"哪个字段不重要"。
  嫌挤由使用者点工具条里的 **`ColumnToggle`**(`shared/column-toggle.tsx`)自己收 —— 它直接读
  `table.getAllLeafColumns()`,所以**列定义加一列,开关自动多一项,不会漂移**。
  `actionsColumn` / `selectColumn` 已标 `enableHiding: false`(藏掉操作列整张表就只能看不能动)。
- **列开关支持拖动排序**,并且设置**存进参数管理**的 `page.columns`(`sys_para`,JSON 类型;结构
  `{"<页面键>":{"order":[...],"hidden":[...]}}`),换机器 / 换浏览器跟着账号走。页面侧一行接上:
  `const { persist } = useColumnPrefs("<页面键>", table)` → `<ColumnToggle table={table} onPersist={persist} />`
  (`hooks/use-column-prefs.ts`)。`ColumnToggle` 自己不认识 tRPC —— 所以它能在工作台当纯展示件用。

- **树的展开态**同理存参数管理的 **`page.tree`**(`hooks/use-tree-prefs.ts`):结构 `{"<页面键>":{"expanded":[...]}}`,
  页面键与列偏好同一套(`settings.menus` / `settings.tags` / `settings.departments` …)。三棵树都接了:
  `const { initialExpandedIds, persist: persistTree } = useTreePrefs("settings.menus")` →
  `<SortableTree initialExpandedIds={initialExpandedIds} onExpandedChange={persistTree} />`。
  **只记「已展开」的 id** —— 没设置过 = 全部折叠(与 `SortableTree` 的默认一致,不用反过来存"折叠集合")。
  ⚠️ 两个坑:① hook 必须在**组件最外层**调用(部门树有个"空态 early return",塞进分支里会被 biome 判成条件调用 hook);
  ② 实测时别点 `[role="treeitem"]` **整行** —— 那是"选中",不触发展开回调;要点行内 label 为「展开 / 折叠」的那个按钮。
- ⚠️ **取消勾选某列必须让"表头 + 数据"一起消失**,这是 `DataTable` 的 `row.getVisibleCells()` 保证的。
  踩过的坑:写成 `row.getAllCells()` 时**表头没了、数据还在**(表头走 `getHeaderGroups()` 自己会跳过隐藏列,
  两边口径不一样)—— 症状很像"列错位",极难一眼看出。空态那一行的 `colSpan` 同理要用 `getVisibleColumns()`。
- **显示"徽章样"的东西一律用组件,不许用 `span` 手拼**(`ui/badge` 的 `Badge` 管单值、`ui/badge-list` 的 `BadgeList` 管多值)。踩过的实例:用户表的「部门 / 角色」两列自己拼了
  `rounded-md border bg-muted/60 px-1.5` 的 span —— 字号 / 圆角 / 配色各写各的,和详情页、别处的徽章全对不上。
  判定标准是**"它在展示数据吗"**:展示数据(状态 / 类型 / 部门 / 角色 / 计数 / 待实现…)→ 组件;
  **控件**(筛选 chip、面包屑链接、工具栏药丸)保持自己的形态 —— 它们要 hover / `aria-pressed` / 导航语义,
  塞进 `Badge` 反而丢掉交互语义。
  多值的可删除标签也用 `BadgeList` 的 `onRemove`(它自带 ×),别 span + 手写 button 拼。
- **列定义里不许出现"库里没有的派生列"**(踩过:界面上出现过 `sys_para` 里不存在的字段);
  派生展示列(如字典的「项数」= `items.length`)要显式用 `columnHelper.display` 并写清它不是表里的列。
- **换页 / 换每页条数时要有动效**:`PaginationControl` 的每页条数是"选中态胶囊滑过去"
  (`transform` 平移 + `transition`,位置用 `useLayoutEffect` 量 —— 4 个按钮不等宽,不能写死);
  `DataTable` 的 `tbody` 带 `.stagger` 且 **key 跟这一页的行 id 走**,所以换页会重挂载、逐行浮入重放一遍。
  ⚠️ key 用"行 id 拼起来"而不是 `pageIndex`:同一页内点排序不该整块重放。
- **详情页的字段直接内联写**(`ui/detail-row` 的 `DetailRow` + 两列 grid),**没有 `fields={[...]}` 的声明式封装**:
  很多字段要自定义渲染 —— 多值的部门 / 角色用 `BadgeList`、长 JSON 用 `<pre>`、字典项用可滚列表 ——
  一旦包成"字段数组",每多一种特殊渲染就得给封装加参数,最后反而比内联难读。
- **表单里的"选多个"用 `shared/multi-select`**(`<MultiSelect options value onChange />`):布局同 `TagInput` ——
  **上面一排「已选」标签(点 × 删)**,下面是带勾选框的候选列表,未搜索时最多渲染 50 条
  (部门有 3691 个,全渲染会把 DOM 撑爆 —— 与树那条是同一个教训)。
  ⚠️ **勾选不许改变列表次序**(选中项不跳第一条):列表永远是 `options` 给的顺序 ——
  以前写成"已选置顶",勾一下列表就跳,根本没法连点几个(用户明确要求去掉)。要确认选了哪些,看上面那排标签。
  选项里的 `hint` 用来消歧(部门重名时填上级名字)。**别用 `<label>` 包 Checkbox**:Base UI 的 Checkbox 不是表单控件,
  包了会被 a11y 规则拦下;行里唯一的控件就是 Checkbox,标签文字包一个 `tabIndex={-1}` 的按钮当鼠标帮手。
- 表单字段多到会超高时,**字段区自己滚**(`max-h-[62vh] overflow-y-auto`),让页头 / 底部时间行 / 按钮留在原位。
- 一个页面内「列表 + 详情」不要左右分栏 —— 详情走**对话框**(权限树那种高的,单独一个对话框,
  别和表单字段挤在一张里)。

### 树:交互与行尾操作都在 `shared/sortable-tree.tsx`

三棵树(菜单 / 部门 / 标签)**只描述"这一行长什么样"**,其余全在公共件里:

- 拖拽排序 / 折叠 / 选中 / 键盘上下移 —— 公共件实现;
- **行尾操作**(`renderActions`:**只有「新增子节点 / 删除」两个图标按钮**)—— 公共件负责:
  ① **悬停 / 键盘聚焦才显形**(树是窄列,常显会和名称抢宽);
  ② 容器带 `data-row-actions`,行的选中事件会跳过它(不然点"删除"顺带把行选中了 —— 标签树踩过);
  ③ 限高 + 内部滚动也在里面。
- **拖拽把手每一行都要有**(不是"叶子才有"):曾经把手只在**叶子**行显示,有子节点的行在同一位置显示的是
  **折叠箭头** —— 于是用户看到"有子节点的这几行没有把手",判断成**"这几行不能拖动"**。其实**能拖**
  (行本身 `draggable`,同级前后都能落),缺的只是**可供性**。现在:折叠箭头归箭头(只有父节点有)、
  **把手每一行都有**。教训 —— **一个动作在哪些行可用,可辨认的入口就得在哪些行出现**;
  验证方式是要求"每一行 `[role=treeitem]` 里都有 `svg[class*=grip]`",别只看代码。
- **行尾不放「编辑」**:点节点右侧就是编辑面板,再放一个「编辑」是冗余的(用户明确要求去掉)。
  树行的操作是**纯图标**(`ActionIconButton`),因为这一行还要放名称与徽章,宽度比表格操作列更紧。

### 三个编辑界面:tab 化(部门 / 角色 / 用户)

**部门编辑**(右侧面板,不是对话框)、**角色编辑**、**用户编辑**统一改成 tab,形态一律 **`card`**
(`DESIGN.md` §5.5:弹窗 / 抽屉里的分区)。tab 名与顺序:

| 界面 | tab |
| --- | --- |
| 部门编辑 | 基本信息 / 用户 |
| 角色编辑 | 基本信息 / 用户 / 菜单 |
| 用户编辑 | 基本信息 / 部门 / 角色 |

**尺寸固定(不然切 tab 会抖)**:

- **宽度**:两个对话框都用 `sm:max-w-2xl`(672px)—— 同一个宽度,**不随新建 / 编辑变**(角色表单以前会切宽窄 ✗)。
- **高度**:`DialogContent` 用 `flex h-[52vh] flex-col`(实测 494px;62vh 时短 tab 里会留 ~150px 空洞,52vh 后字段刚好占满);部门面板那边是"根 `flex h-full min-h-0 flex-col` +
  撑满的 Card"(面板高度由栅格行决定)。**tab 之间内容多寡差很多(菜单树很高),不锁高度切 tab 就抖** ——
  锁住之后**滚动条在 tab 内部**(每个 tab 的内容区是 `min-h-0 flex-1 overflow-y-auto`,动作行 `shrink-0` 钉在底部)。

四条统一规矩(三处都照它走,别再各写一套):

1. **动作跟着 tab 走**:每个 tab 底部一行,`[取消]` 与「该 tab 自己的动作」**一起靠右**(`justify-end gap-2`,
   与对话框页脚的动作排布一致) ——
   基本信息 `[保存]`、菜单 `[保存权限]`、用户 / 成员区**没有保存**(点一下立刻落库)。
   **对话框页脚只放「创建于 … · 更新于 …」那一行**(`DetailMeta`),不再放按钮 ——
   而且**没有时间可显示就整条不渲染**(新建时页脚是空的,白占 70px),有内容时用 `className="mt-0"` 收掉它默认的 20px 上边距。
   部门是**面板**、没有"关闭"这个动作 → 那一行是 `[保存] [还原] [删除]`,**同样 `justify-end gap-2`**
   (三处一个写法,别再给「删除」加 `flex-1` 占位去"推到最右");`还原` 就是面板版的「取消」,
   不硬塞一个同义的按钮。
2. **每个 tab 自己说清"要不要保存"**:用户 / 成员区是**点一下立刻落库**(`MemberZone` 里已经把那句话焊在标题旁);
   角色的**菜单** tab 有它自己的「保存权限」——它们动的是两张关联表,和基本信息的保存互不相干。
3. **新建时隐藏空 tab**:角色 / 用户在没有 id 之前,"用户 / 菜单 / 部门 / 角色"里没有可操作内容 → **不渲染**(不是禁用)。
4. **切 tab 不丢已填内容**:字段状态都在表单组件的 `useState` 里,与 tab 挂载无关(Base UI 只挂载当前面板,
   所以千万别把字段的 state 放进 tab 里)。

**选择框的高度与「行尾动作」**(`shared/multi-select.tsx` 的两个能力,2026-09 加):

- **`fill`** —— 候选列表**撑满父容器的剩余高度**(父容器得是 flex 列、高度有界)。用户编辑的「部门 / 角色」用它,
  列表底边**正好停在保存按钮上沿**(实测间距 0);角色 / 部门「用户」tab 的选择框也用它(168 → 341px)。
  ⚠️ 别再用 `maxHeight={168}` 定高 —— 定高会**压到**下面的动作行(实测溢出 30px)。
- **`trailing`** —— 搜索行**最右侧**的插槽。`MemberZone` 的「加入」按钮就挂在这(与搜索框同一行、距行右 0px);
  以前它单独占下面一行,把选择框挤矮了。

**高度这条铁律(改这三个界面时按它走)**:

- **弹窗本身永远不要出现滚动条** —— 滚的只能是**控件内部**(候选列表 / 字段区 / 权限树)。
  做法:tab 的内容区一律 `flex min-h-0 flex-1 flex-col`,**别在容器上写 `overflow-y-auto`**
  (写了的症状:整个 tab 区在滚、看上去就是「dialog 在滚」—— 菜单 tab 与角色「用户」tab 都踩过)。
- **动作行与内容留 12px**(`pt-3`)—— 别让按钮贴着列表底边;列表用 `flex-1` 撑到"按钮上方 12px"处。
- **基本信息要「排得下」**:字段用 `grid gap-x-3 gap-y-2 sm:grid-cols-2` 两列紧凑排
  (角色 5 个字段 → 3 行;用户 4 个 → 2 行),字段区实测 **214px 装得下**、不出滚动条。
  ⚠️ 原来 5 个字段竖排是 **405px** → 字段区自己出滚动条(贴在弹窗右侧,**看着就像「弹窗在滚」**)。
  ⚠️ **别用「加大弹窗」来消它**:62vh 也只给字段区 ~290px,装不下 405 ✗ —— 要减的是**内容的行数**。
- 顺带:字段的 `Input` 统一 `h-8`(部门面板一直是这个高度),比默认 `h-9` 每行省 4px。
- **给选择框一个下限**:`fill` 只给 `min-h-0 flex-1` —— 空间被下面那块挤走时它会塌到几十像素。
  ⚠️ **下限不能靠 `className` 传**:`className="min-h-[160px]"` 与组件自己的 `min-h-0` **同属一组**,
  tailwind-merge 会让**后者赢**,静默丢掉。正确做法:**外面包一层** `<div className="flex min-h-[160px] flex-1 flex-col">`。

**角色的权限树搬进了「菜单」tab**(原来是另一个独立对话框,已删):表格行 / 详情里的「菜单权限」入口改为
**打开编辑并直接落在「菜单」tab**(`initialTab`),不保留第二个入口;树再高也只在 tab 内部滚。

踩过的坑(改造前):`[保存][还原][新增子部门][删除]` 一排夹在字段与成员之间,而成员是**点一下立刻落库**的 ——
视觉上像「保存会把成员一起存」,于是人会去点一个根本不必点的按钮;`MemberZone` 与「即时生效」那句说明就是那时候定的。
⚠️ 另外两条已知缺口仍然在:**换上级没有 UI 入口**(树只支持同级拖拽);**成员候选是 `user.list()` 全量**
(上千人时该加服务端搜索)。

### 性能:先量再改(别凭感觉优化)

"部门管理加载太慢"是真实案例,**量出来的结论和直觉相反**,记在这里免得下次又靠猜:

| 环节 | 实测 | 结论 |
| --- | --- | --- |
| `select * from sys_dept`(3691 行) | 52–122 ms | 有成本,但不是主因 |
| … **再加 `order by sort, name`** | 48–62 ms | **排序几乎不花钱** —— 想靠索引优化排序是白费 |
| 只取 4 列(id / parent_id / name / sort) | 26–29 ms | 真正的成本是**逐列解码**,不是扫描 |
| 首屏渲染 3691 行(全展开) | **2908 ms** / 83,526 DOM | **主因在这里** |
| 首屏渲染 3 行(默认折叠) | **228 ms** / 325 DOM | 修完 **12.8×** |

三条纪律:
1. **先分段计时**(SQL / 传输 / 渲染各占多少)再决定动哪一层 —— 这次若直接"加索引",什么都不会变;
2. **`select *` 的全表读加不了索引**:索引帮不了"我要所有行、所有列";要减就减**列**(只取用到的)或**行**(少查);
3. **前端行数是常数级放大**:100 行 → 1000 行不是"慢 10 倍",它同时拖慢 SSR、水合与之后每一次重渲染。

**索引**:树表把 `parent_id` 单列索引升级成了 **(parent_id, sort) 复合索引**(`sys_dept` / `sys_menu` / `sys_tag`)——
因为项目里有 **11 处** `where parent_id = ? ... order by sort`(建 / 改 / 重排 / 级联删除都要读同级)。
⚠️ 达梦侧 `sys_menu` / `sys_tag` 原本**连 `parent_id` 索引都没有**(那两张是手工建的表),这次一并补上。
改索引名要同步三处:drizzle schema + `create-system-tables.ts` + `create-better-auth-tables-dm.ts`,并在**已存在的库**上手动 drop 旧的。

### 高度:列表页占满主区,内容在卡片里滚

**每页都占满主区剩下的高度**(3 行数据也是满屏、300 行也是满屏 —— 不要"高的高、低的低"),
超出部分由**卡片内部的滚动区**消化,整页不滚。高度只能靠 flex 链传,中间断一环就退回内容高度:

```
sidebar-provider 的 <main>    `flex min-h-0 flex-1 flex-col overflow-hidden`
  └ PageTransition            `flex min-h-0 flex-1 flex-col overflow-y-auto`   ← 只给非列表页兜底
      └ PageFrame             `flex min-h-0 flex-1 flex-col gap-4`             ← 列表页根容器(本文件)
          └ 主体卡片 Card      `flex min-h-[26rem] flex-1 flex-col`(台账页)
            或 两列栅格 grid   `grid min-h-[24rem] flex-1 gap-4 …`(树页)
              └ CardContent   `flex min-h-0 flex-1 flex-col`
                  └ 滚动区     `flex-1` + 下限(TableLoadingShell `fill` 240px / SortableTree)
```

- **链上的 flex 项一律带 `min-h-0`**,唯一例外是"主体卡片 / 栅格"——它们换成**明确下限**
  (`min-h-[26rem]` / `min-h-[24rem]`)。`min-height` 写死一个值既给了下限、又同时**封住"被内容撑高"**
  (自动最小高度只在 `min-height: auto` 时才等于内容高度)。
- **反过来,`min-h-0` 用在主体卡片上会塌**:卡片自带 `overflow-hidden`,而"overflow 不是 visible 的
  flex 项,自动最小高度是 0"—— 实测过 380px 视口下卡片只剩 42px、里面 383px 的表格全在框外且滚不到。
- **滚动区自己要有下限**(表格 240px、树跟着栅格的下限走):装不下时下限撑着,页面退化成整页滚,
  而不是把内容压没。
- **表格自己滚时表头粘住**:`sticky` 已经写在 `ui/table.tsx` 的 `TableHead` 里(项目改写,见「新增 shadcn 组件」)。
  ⚠️ 别在调用点再包一层 `overflow-x-auto` —— 它比外层更近,会把 `sticky` **抢走**(表头 position:sticky 但滚动时照跑)。
- 验收三件事(改完拿浏览器量一遍,别只读代码):**整页不滚** / 表格与树**内部有滚动条** / 长表滚动时**表头不动**。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/routes/` | 文件路由。文件名即 URL;`(main)` 是无路径布局组 |
| `src/routes/(main)/demo/` | 框架能力示例页(表格 / 表单 / Query / tRPC / store / DB / Auth),用模板自身组件写成,可整目录删除。放在 `(main)` 里是为了复用后台外壳,URL 仍是 `/demo/*` |
| `src/routes/(main)/settings/` | 唯一保留的真实业务模块,**7 个页面全部接真实数据**(部门 / 角色 / 用户 / 标签 / 菜单 / 字典 / 参数);前三个 + `lib/rbac.ts` 就是一套 RBAC 骨架。派生新项目时**从这里开始改**,不要删 |
| `src/components/ui/` | 叶子原语,44 个(vendored shadcn + 自研组合控件)。**两处已被项目改写**:① `tabs.tsx` = 「四种分割形态」的页签(下划线 / 分段 / 药丸 / 卡片,计数走 `count` 属性),规格见 `DESIGN.md` §5.5;② `table.tsx` 的 `TableHead` 多了 `sticky top-0 bg-card`(表格自己滚时表头粘住)。`pnpm dlx shadcn@latest add tabs|table` 会覆盖它们,覆盖后需按该节重做。**取舍原则**:与项目内已有实现**正面冲突**的原语不保留(曾有 shadcn 的 `sidebar` 与 `pagination`,与 `layout/sidebar` + `shared/pagination-control` 打架,已删);通用但当前没用到的保留,并在工作台 UI 示例里点名,否则等于不存在 |
| `src/components/layout/` | 后台外壳:`sidebar`(含 60px 迷你图标栏)+ `sidebar-header`(品牌标题区)+ `sidebar-provider`(折叠状态)+ `topbar`(面包屑/主题)+ `page-header` / `empty-state` / `stub-page` / `page-transition` / `route-progress` / `module-overview`,导航四件:`nav-config`(静态菜单 + 纯树工具)/ `nav-menu`(库行→树)/ `nav-data`(两个只读 hook)/ `nav-config` |
| `src/components/modules/shared/` | 跨模块复用的**领域无关**展示件(工作台有示例,见「这个模板里有什么」的工作台行):`table-kit`(表格套件:`DataTable` / `selectColumn` / `actionsColumn` / `TableLoadingShell` / `TextCell`)、**`sortable-tree`(可拖拽排序树 —— 菜单管理 / 标签管理两页共用同一套交互)**、`ledger-toolbar`(台账工具条)、`filter-chips`(快速筛选 + 已选 pill)、`pagination-control`、`stat-cards`(指标卡)、`badge-list`(`Badge` 单值 / `BadgeList` 多值,表格与详情页共用)、`icon-picker` + `icons-list` + `use-lucide-icons`(图标选择)、`permission-tree`(权限树 / 权限选择区)、**`multi-select`(多选框:布局同 TagInput —— 上面一排可删标签,下面候选列表按原顺序不动)**、**`detail-dialog`(详情弹窗外壳 `DetailDialog` + 底部时间行 `DetailMeta`;字段由页面内联)**、`excel-import` + `ledger-excel`(导入导出) |
| `src/components/modules/<域>/` | 业务域模块。每页固定文件角色:`-page` / `-table` / `-form` / `-form-mappers` / `-detail`(或整页 `-detail-page`)/ `-stats`;多页面域用 `<域>-<页面>-<角色>`。**不做通用增删改查封装** —— 列定义、行类型、增删改写操作逐页手写。完整约定见 `doc/前端结构与组件约定.md`;现成范例见 `components/modules/settings/` |
| `src/lib/api/` | `ApiError` 与错误归一化 |
| `src/lib/` | 通用工具:`table.ts`(v9 app hook + `useRowSelection` 多选)、`excel.ts`(Excel 列类型与**唯一**写盘点 `writeSheet`/`cellText`)、`mock-table.ts`(设计期假后端,只给工作台示例)、`multi-value.ts`、`format.ts`、`time.ts`、`ids.ts`(编号口径)、`menu-detail-path.ts`、`sys-para.ts`(系统参数读写)、`para-spec.ts`(参数类型码与校验,客户端可 import)、**`rbac.ts`(权限并集计算,服务端)、`menu-spec.ts`(菜单类型码,客户端可 import)、`current-user.ts`(procedure 里读当前用户)**、`logger.ts`、`constants.ts`、`utils.ts` 等 |
| `src/db/` | `index.ts` 按 `DATABASE_URL` 前缀选驱动(mysql2 / 达梦)并导出 drizzle 实例 `db`;**`dm/` 是达梦驱动**(复用 mysql-core 方言 + dmdb,见「数据库 ▸ 达梦支持」);`schema.ts` 是迁移管辖的表(只剩 `todos`);`data-base-schema.ts` 是**不走迁移**的十四张系统表:五张设置表 + 四张认证表 + **五张权限表**(部门 / 角色 / 成员 / **用户→角色** / 角色→菜单) |
| `src/integrations/` | 第三方接线:tRPC 初始化与路由、TanStack Query 上下文、Better Auth 客户端侧 |
| `src/hooks/` | 通用 hook:`use-dict`(读 `sys_dict` 的统一入口)、**`use-perms`(`useHasPerm(code)` —— 前端判断按钮显隐的唯一入口)**、`use-stable-keys`(列表稳定 key)、`demo.form*`(框架能力样例专用) |
| `scripts/` | 只放**运维/建表/迁移/种子脚本**:`create-system-tables`(建十四张系统表)/ `sync-table-meta`(表注释 / 列注释 / 索引名的唯一真源)/ `migrate-ids-to-nanoid`(老库换主键)/ `seed-menus` / `seed-dicts` / `seed-paras` / `seed-tags`,全部幂等(建表 `if not exists`、迁移只改该改的行、种子"只补不覆盖")。业务验证脚本随业务一起删 |

## 随模板分发、但当前**没有调用方**的东西

这些不是遗留,是刻意留的"备选件" —— 派生新项目时会马上用到。**改它们之前先确认没有别的实现替代**:

| 件 | 位置 | 说明 |
| --- | --- | --- |
| 编号口径 | `lib/ids.ts` | `前缀-YYMMDD-HHMMSS`(`formatCode`)+ `newId()`(nanoid 主键);改 `ID_PREFIX` 换成自己的前缀 |
| 字典读取钩子 | `hooks/use-dict.ts` | **作为模板底料保留**:页面消费 `sys_dict` 的统一入口(派生项目里把 `dict.byCode` 接好即可用) |
| 权限点选择区 | `shared/permission-tree.tsx`(`PermissionTree` / `PermissionPicker`) | **作为模板底料保留**:重建授权界面时直接用,不用再手写「标题 + 计数 + 搜索 + 全选/清空 + 树」那一块 |

> 这张表只登记**作为模板底料,衍生项目时启用**的件(代码层保留,留作新项目直接用的封装)。本轮删掉了三类名不副实的行:
> 指向不存在的目录(`lib/crud` / `lib/validators` / `store` / `shared/use-column-visibility`)、
> 本轮删掉的文件(`lib/db-errors.ts` / `mocks/shared.ts` / `mocks/dicts.ts`)、
> 以及其实**有**调用方的 ui 原语(它们由工作台的 UI 示例使用)。

**新增可复用件时:要么给它一个真实调用方,要么在工作台展示(本项目即 `components/modules/workbench/ui-gallery.tsx`,它现在同时覆盖 `ui/` / `shared/` / `lib/`),要么登记进上表** —— 三者都不做就会被下一轮清理当成死代码删掉。

展示分两层(见 `ui-gallery.tsx` 文件头):**能独立渲染的就真跑**(拖拽 / 勾选 / 校验都点得动);满足不了下面任一条的只给「签名 + 指路」卡 ——
① 需要 TanStack Form 的 field context(见 `/demo/form.simple`);② 会把重依赖拖进**工作台首屏包**(`shared/excel-*` → xlsx);
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
| `src/db/data-base-schema.ts` | **系统表十四张**:系统设置五张(`sys_menu` / `sys_dict` / `sys_para` / `sys_tag` / `sys_tag_relation`)+ **认证四张**(`sys_user` / `sys_session` / `sys_account` / `sys_verification`)+ **权限五张**(`sys_dept` / `sys_role` / `sys_user_dept` / `sys_user_role` / `sys_role_menu`,见「认证 ▸ 权限模型」) | **不进迁移**:只声明"读写的形状",DDL 由 `scripts/create-system-tables.ts`(`pnpm db:create`)**和** `scripts/create-better-auth-tables-dm.ts`(达梦)维护。**改列之后要同时改它 + 这两个脚本** |

**不要把 `data-base-schema.ts` 的表并进 `schema.ts`** —— 下次 `db:generate` 会生成 `CREATE TABLE`,而库里已存在 → `db:migrate` 直接 1050 报错。

- 连接在 `src/db/index.ts`,用 `drizzle-orm/mysql2`,导出 `db`
- 迁移配置在 `drizzle.config.ts`:dialect `mysql`,输出 `./drizzle`,`schema` **只指向** `./src/db/schema.ts`,读 `.env.local` → `.env`
- env 流转:`.env.example`(随模板分发,无凭据)→ `cp .env.example .env.local`(本地填写,已 gitignore)
- `DATABASE_URL` **缺失会直接抛错**,`src/db/index.ts` 与 `drizzle.config.ts` 都有显式检查
- 改 schema 后:`pnpm db:push`(开发期)或 `pnpm db:generate && pnpm db:migrate`
- 建表:`pnpm db:create`(十四张系统表 = 设置五 + 认证四 + 权限五,幂等 `create table if not exists`,不 drop 不 seed)。**给已存在的表加列**要登记在脚本的 `COLUMN_UPGRADES` 里(`create table if not exists` 不会补列);**删列**登记在 `COLUMN_DROPS`(列被合并 / 废弃时用 —— 不注销旧列,老库里那列还带着 not null,下一次插入就会违反约束);**改表名**登记在 `TABLE_RENAMES`(达梦侧改完会自动清一次计划缓存)
- 种子:`pnpm db:seed:menus`(把 `NAV_NODES` 写进 `sys_menu`)、`db:seed:dicts`、`db:seed:paras`、`db:seed:tags`、**`db:seed:rbac`(权限演示数据)** —— 五个都幂等"只补不覆盖"
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
| 表定义 | `src/db/data-base-schema.ts` | 四张表 `sys_user` / `sys_session` / `sys_account` / `sys_verification`(auth 是**系统内部服务**,按项目口径吃 `sys_` 前缀、不进 drizzle 迁移)。**BA 的 organization 插件已撤掉** —— 组织/部门与角色走项目自己的权限五表,见下节 |
| 回归测试 | `tests/better-auth.test.ts` | 5 个用例:注册 / 登录 / 取会话 / 错密码 / 登出;每步都回查库里真的落了什么行 |

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

**管理员代改密码 —— BA 没有这个接口,只能写库,但必须用它的 hasher。** `changePassword` 要**本人会话**
(邮件/旧密码往返),项目也**没启用 BA 的 admin 插件**,所以"帮别人把密码重置成 X"没有 API 可用。做法:

```ts
import { hashPassword } from "better-auth/crypto";   // ← 必须用它,自己搓哈希格式对不上、登录直接过不去
const hash = await hashPassword("新密码");            // 每个账号**单独算一次**(scrypt 自带盐,别共用同一个串)
await db
  .update(sysAccount)
  .set({ password: hash, updatedAt: new Date() })
  .where(and(eq(sysAccount.userId, id), eq(sysAccount.providerId, "credential")));
```

⚠️ **改完一定要拿 `auth.api.signInEmail` 真登一次** —— 直接写库最怕的就是"写进去了但登不上"
(实测过:用 BA 导出的 hasher 写、再用它的登录接口验,才是完整闭环)。

**运维「切换用户」(免登录换身份):`lib/auth-debug.ts` 的 BA 自定义插件端点** `POST /api/auth/debug/switch-user`,
顶栏入口 `components/layout/user-switcher.tsx`,权限点 `sys:user:impersonate`。
- **必须是 BA 插件端点**:换身份 = 换一个**签过名**的会话 cookie;`createServerFn` 拿不到 BA 的签名上下文,
  自己拼 cookie 值等于绑定 BA 私有格式,写 `sys_session` 行也不够。插件端点里 `ctx` 是真的。
- ⚠️ 它用 BA 的**内部适配器** `internalAdapter.createSession`(官方 admin 插件同款)。**升级 BA 后必须重跑
  `tests/impersonate.test.ts`** —— 它真的切一次再看会话是谁,`typecheck` 抓不到这类变化。
- 服务端**必须**再查一遍权限(全站第一处真正的服务端拦截);`perms === null` 时**也拒绝**。切换不删原会话,
  身份 1 小时过期,前端记"从谁来的"并常驻徽章提示(忘了切回来是这类功能最常见的翻车方式)。

### 权限模型(部门 / 角色 / 菜单可见性)

**"部门当组织用",但走的不是 Better Auth 的 organization 插件** —— 那套是"选中一个当前组织 + 租户隔离",
而这里要的是"**同时属于多个部门 + 角色给权限**",语义不同(而且它会往 session 上加一个用不上的
`active_organization_id`)。所以是项目自己的五张表:

```
sys_dept(树)                         上海公司 / 武汉公司(可嵌套)—— 纯组织架构
sys_role(全局定义)                          管理员 / 员工 / 开发 …   ← 不随部门数增长
sys_user_dept(user_id, department_id)  张三 ∈ 上海公司、武汉公司(**不带角色**)
sys_user_role(user_id, role_id)                张三 → 管理员、普通员工(**权限 = 这些角色的并集**)
sys_role_menu(role_id, menu_id)                角色能看见哪些菜单 / 能用哪些按钮
```

**权限标识 = `域:资源:动作`(三段小写),每段可整段写 `*` 通配。** 例:`sys:role:add` / `sys:role:*` / `sys:*:*` / `*:*:*`(全部权限,**含以后新增的菜单**)。
- **通配在读取时展开**,只改一处:`lib/rbac.ts` 把模式命中的菜单行当成"被授权"再走同一套祖先补全 —— 所以
  `use-perms.ts` 与各页面**一行都不用改**,`*:*:*` 也自动覆盖未来新增的域/菜单(不用回来补勾);想收窄再加一条模式行。
- **域 = 一级模块 key**,允许长新域;受控的是**形状不是取值** —— 菜单接口的 `perm` 用 `PERM_FORMAT` 挡住
  两段 / 大写 / 半截通配(`sys:ro*`)。⚠️ 段数不符的模式**永远匹配不到**,症状是"勾了没权限",极难查。
- 运维权限点两条:`*:*:*`(通配,种子授给系统管理员)与 `sys:user:impersonate`(切换用户),挂在隐藏分组「运维工具」下。

模型全文 / 三页页面 / 演示账号 / 行级数据权限规划 → **`doc/rbac-权限模型.md`** ✓。

### 达梦(DM)支持

**可选的第二条线**:`DATABASE_URL` 以 `dm://` 开头自动走达梦驱动(`src/db/dm/`),业务代码零改动 ✓。
三条必知前提(**少一条就是「连不上」或「静默挂住」**):① URL **必须**带 `?loginEncrypt=false` ✓(驱动已自动兜底 ✓)
② 带 `?schema=<模式>` ✓(没写会告警 ✓) ③ 达梦的表要跑一次 `pnpm db:dm:defaults` 补默认值 ✓。
⚠️ 达梦**没有 drizzle 迁移**(手写 DDL ✓):改 `data-base-schema.ts` 要**同时**改两个建表脚本 ✓;注释走 `pnpm db:sync:meta` ✓。

驱动实现要点 / CLOB 比较 / 事务写法 / 索引与注释差异 → **`doc/达梦支持.md`** ✓。

## 已知陷阱

- **人为改动一律不要"恢复"** —— 这是硬规矩。库里 / 文件里出现与你上次看到的不一致时,**先判断"这是谁改的",而不是先修回去**:
  用户手工改的表名、演示数据、配置都是**故意的**,把它"修回原样"等于覆盖用户的决定。真实发生过一次:用户把演示账号
  (`zhangsan`)的角色 / 部门清掉来试界面,我把它当成脏数据又给补齐了。
  判据只有一条 —— **只清我自己造的东西**:带 `__test__*` / `__probe__*` / `probe*` 这类**我自己加的前缀**才能删;
  其余一律**只报告、不动手**,拿不准就**问**。`pnpm db:seed:rbac` 同理:它只用于**首次初始化演示数据**,
  **不能**拿它去"修"数据(那属于覆盖人为改动)。
  反例(确实该修):`like '__%'` 那个 `_` 通配符 bug 把演示账号删了 —— 那是**我自己的 bug 造的脏数据**,要修。
- **永远不要提交 `.env*`。** `.gitignore` 已覆盖 `.env`、`.env.*`、`*.local`,并保留 `!.env.example`。`.env.example` 是唯一允许入库的 env 文件,且必须不含真实凭据。
- **不要删 `src/router.tsx`。** 它不在任何 import 图里(TanStack Start 按**约定路径**发现并加载它),所以"扫引用找死代码"的脚本会误判它是孤儿。删了直接起不来服务。这个坑真实发生过一次。
- **不要把 `start-tpl` 这个字符串硬编码进业务代码。** 它只应该出现在 `package.json` 的 `name` 和文档里。项目名相关的展示文案走配置或 env。`localStorage` 的 key 尤其要注意加项目前缀。
- **`src/routes/(main)/demo/` 及其支撑文件可以整目录删除**:`demo/` 目录、`hooks/demo.form-context.ts`、`hooks/demo.form.tsx`、`lib/demo-store.ts`。本模板 `__root.tsx` 的 devtools 只挂了 Router 与 Query 两项(Store devtools 已随业务清理),所以**删 demo 不需要改 `__root.tsx`**。
- **`@tanstack/react-start` 的类型增强已经有非 demo 的引用方**:`(main)/route.tsx` 与 `integrations/tanstack-query/root-provider.tsx` 都 import 了它,所以**删掉整个 demo 目录不会**让 `server: { handlers }` 报 `'server' does not exist in type ...`(这条陷阱在 demo 收敛到 7 页后已经不成立)。
- **UI 示例已收在 `components/modules/workbench/ui-gallery.tsx`(+ 同目录 `ui-gallery-table.tsx` 的台账表格示例)**。原来那 7 条 `/showcase/*` 路由在本轮之前就并进来了;要精简模板,删这一个文件即可(`routes/(main)/index.tsx` 引用它)。
- **demo 目录是"简单示例页"**:每个页面只演示一项能力,且全部用模板自身的组件写。`(main)/demo/table.tsx` 用的是 `useAppTable`(`src/lib/table.ts`)而不是裸的 `useTable`,可以当作接真实 CRUD 表格的参照。这些页面当前不报任何类型或 lint 错误,删或留都不影响 `pnpm typecheck` / `pnpm check` / `pnpm build`。
- **`sql\`... in (${数组})\` 是错的**:drizzle 会把数组渲染成**一个括号元组**(`in (('a','b'))`),MySQL 直接报 `ER_OPERAND_COLUMNS: Operand should contain 1 column(s)`。数组条件一律用 `inArray(column, ids)`。踩过:标签级联删除/子节点删除/按 id 批量查,三处都中招,单元素时不报错所以很难发现。
- **漏括号 = 哑巴 bug(两次真实踩过,各踩了 7 处)**:`await invalidate;` 更隐蔽 —— 它 await 的是**函数引用**,立刻 resolve,于是"什么都没失效"(症状:改完了列表不动、得手动刷新);`event.preventDefault`(无括号)是空表达式,什么也不做 —— **拖拽尤其致命**,HTML5 拖放的规则是「`dragover` 里调了 `preventDefault()`,`drop` 才会触发」,漏了的症状就是"拖了半天没反应"(`settings-menus-tree.tsx` 踩过,同目录 `settings-tags-tree.tsx` 是正确参照)。**改完顺手 grep 一遍 `await \w+;`,改事件处理时对一眼括号数。**
- **MySQL 改列注释 = 重写整条列定义,漏一个子句就静默改坏列**(真实踩过):MySQL 没有 `comment on`,只能 `alter table … modify column …`,而它要求把列定义**完整重写**。踩过的两个坑:
  ① 漏了 `EXTRA` → 设置表的 `update_time datetime(3) not null default current_timestamp(3) on update current_timestamp(3)` 被改成没有 `on update`、**精度也没了**,更新数据时时间不再自动刷新,而且只有对着 `show create table` 才看得出来(`scripts/sync-table-meta.ts` 的 `COLUMN_REPAIRS` 就是补这个的);
  ② `select extra` **不写别名**读回来的是 `undefined` —— `information_schema` 的字段名是**大写 `EXTRA`**,别的字段我当时都起了别名,就漏了它。症状是"改注释把 `not null` / `auto_increment` / `on update` 一起抹了"。
  改这段代码后请一定跑一遍 `pnpm db:sync:meta` 两次:**第二次必须报「无需改动」**,否则就是没幂等、正在反复改坏列。
- **删列必须登记进 `COLUMN_DROPS`(两个建表脚本各一份)**:`create table if not exists` 不会改已存在的表,
  所以"列被合并 / 废弃"时只改 `data-base-schema.ts` + CREATE 语句是**不够的** —— 老库里那列还在,而且它多半是
  `not null` 而新代码不再写它,**下一次插入就直接违反非空约束**。同理加列要登记 `COLUMN_UPGRADES`。
  踩过的实例:角色从「部门成员的角色」改成「用户的全局角色」时,`sys_user_dept.role_id` 就是靠这一段删掉的。
- **达梦改表名之后必须 `call sp_clear_plan_cache()`**:达梦有**全局执行计划缓存**,表被 `alter table … rename to …` 改过之后,
  缓存里按旧表名编译的计划仍然在 —— 症状是**看起来完全无关**的报错:`[-7009] Object is modified`(有时是 `[-2106] 无效的表或视图名[旧表名]`),
  而且**同一条 SQL 换个写法就能过**(实测:同一张表的参数化 DELETE 挂、去掉限定列名就通),极难往"表名"上想。
  两个建表脚本的「老库改表名」流程已经在 rename 之后自动清一次;手工改过表名的库记得自己跑一遍。
  顺带记住:`create table if not exists` 只认**新名字** —— 老库里还叫旧名的表它管不着,会当"没这张表"重开一张空的(见 `TABLE_RENAMES`)。
- **`pnpm db:push` 会提议删掉 14 张系统表**(它只认 `drizzle.config.ts` 的 schema = `src/db/schema.ts` = `todos`):终端里它会警告 "You're about to delete sys_menu table with 8 items" 然后等你确认 —— **手快确认就是丢数据**。系统表的正道是 `pnpm db:create`(建表)+ `pnpm db:sync:meta`(注释),迁移只用 `db:generate` + `db:migrate`。
- **Better Auth 四表的 drizzle 属性名必须是驼峰,不能跟 `data-base-schema.ts` 的 snake_case 惯例**:写成 `email_verified: boolean("email_verified")` 时 BA 会报
  `Drizzle schema mismatch / Missing columns: user.emailVerified …`,还附带警告「session.expires_at 是 BA 永远不会写的必填列」,随后**所有认证调用直接失败**(测试 5/5 秒挂)。
  它按 **drizzle 属性名**找模型字段。**表名反而随便改**(它按 `src/lib/auth.ts` 传给 adapter 的映射**键名**找表)—— 这就是四表能叫 `sys_*` 的原因。
- **别给 `<Table>` 再包一层 `overflow-x-auto`**:`ui/table.tsx` 的 `Table` 自己就有 `[data-slot=table-container]` 的 `overflow-x-auto`。多包一层不只是冗余 —— 它比外层更近,会把表头的 `sticky` **抢走**(症状:表头 `position: sticky` 但一滚就跑掉)。参数 / 字典两个手写表格踩过这个坑,已删。
- **`src/components/ui/` 全是 Base UI(radix-ui 依赖已移除)** —— shadcn 文档里大量是 **Radix** 写法,**照抄会静默失效**(类型不报错、点了没反应、菜单照常弹开)。Radix 与 Base UI 的差异点(搬 shadcn 组件时最容易踩):
  - `DropdownMenuItem` 的点击回调是 **`onClick`**;写 Radix 的 `onSelect` = 传了个没人认的 prop(踩过:「退出登录」点了毫无反应,查了半天才发现)。
  - 多态写法是 **`render`**;`asChild` 在这个项目里不存在。
  - `Menu.Item` / `DropdownMenuItem` 默认渲染 **`div`**;要真按钮语义用 `nativeButton`。
  - 拿不准就看它 `extends` 的 `BaseUIComponentProps<...>` / `XxxProps` 的 `.d.ts`(在 `node_modules/.pnpm/@base-ui+react@*/…` 下),别按 Radix 的记忆写。
- **TanStack Table v9 的行模型必须写成「具名 slot + 调用」**:`tableFeatures({ sortedRowModel: createSortedRowModel() })`。写成 `createSortedRowModel`(无 key、未调用)属于**不会报错的错误**:类型照样通过,但 `getSortedRowModel()` / `getPaginationRowModel()` 实际不存在,症状是**页码算得对(显示"共 4 页")却把全部行都渲染出来**。`src/lib/table.ts` 已按正确写法修复并实测验证,不要改回去。
- **弹窗被超长内容撑宽 —— 容器缺 `min-w-0`**(真实反复踩过,2026-09):`flex` / `grid` 项的 `min-width` 默认是 `auto`,
  会被内容的 **min-content** 顶开 —— 参数管理里值一改成长 JSON / 长串,弹窗就宽到超出设计宽度(看着像"对话框变宽了")。
  修法三件套(参数表单已按此改):① **字段容器 + 控件**都加 `min-w-0`;② 值控件再加 `break-all`(普通文本用 `break-words whitespace-pre-wrap`);
  ③ 外层 `grid` 也标 `min-w-0`。实测:塞进 **400 个字符**后,`sm:max-w-lg` 的弹窗仍是 **512px**、控件 462px 在框内、**横向溢出 0**。
  —— 规矩:**任何可能超长的内容**(JSON / 长 ID / URL / 路径 / 备注)进弹窗,先给它的容器 `min-w-0`。
- **卡片的悬浮反馈是「1px 边框刷成亮蓝」**(`ui/card.tsx`:`hover:border-primary`)。**别给 `<Card>` 传 `hover:border-border` / `hover:shadow-none`** —— 那是当年为了压住 3px 蓝环留的,现在会把悬浮态整个顶掉,症状是"页面上怎么悬浮都不变蓝"(7 个设置页踩过,已删)。
## 改动完成后自检

```bash
pnpm typecheck
pnpm check
pnpm build            # 产物落在 .output/
pnpm test
```

改了 `src/routes/` 下的文件,别忘了 `pnpm generate-routes`。**不要手改 `src/routeTree.gen.ts`**,它是生成物。

已知基线:`pnpm check` 为 **0 error / 4 warning**(另有 1 条 info),只有两个文件、一类规则:

| 文件 | 规则 |
| --- | --- |
| `src/components/ui/badge-list.tsx` | `noNonNullAssertion`(3 处) |
| `src/components/modules/shared/icons-list.ts` | `noNonNullAssertion` |

都不影响退出码,且都在"不要顺手修"的范围里(vendored `ui/`、或上游写法决定的 `!` 断言)。**新代码不要新增 warning** —— 出现新 warning 说明引入了新的写法问题。

> `layout/topbar.tsx` 的 `useTemplate` 警告已修(2026-09),基线从 5 warning 降到 4。
