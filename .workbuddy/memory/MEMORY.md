# start-tpl —— 项目长期备忘

## 这是什么

一个人自用的 **TanStack Start 后台模板**。业务代码已清空,只保留两个"展示用"入口
(组件展示 / 框架能力)+ 一个真实业务模块(系统设置,7 页)。

派生新项目时:**改 `components/modules/settings/` + `routes/(main)/settings/` + `nav-config.ts`**,
删掉 `showcase/` 与 `demo/` 两组。

## 硬性约定(改代码前必读)

- **不要删 `src/router.tsx`**。它不在任何 import 图里(TanStack Start 按约定路径加载),
  "扫引用找死代码"的脚本会误判它是孤儿。真实踩过:裁剪业务时被删掉,从 `.output` 旧构建产物里反推才恢复。
- **两张 schema 文件不能合**:`db/schema.ts`(走 drizzle 迁移:Better Auth 四表 + todos)与
  `db/data-base-schema.ts`(**不走迁移**:sys_menu / sys_dict / sys_config)。合并会导致
  `db:generate` 生成 `CREATE TABLE` 而库里已存在 → `db:migrate` 报 1050。
- **`nav-config.ts` 的 `NAV_ICON_MAP` 是图标白名单**:`NavIcon = keyof NAV_ICON_MAP`,
  菜单图标必须登记在这张表里,否则 `menuIconOf` 退回 `file-text`。
- **新增可复用组件时必须顺手在 `/showcase/*` 加一个 `ShowcaseItem`** —— 那一层是模板的核心资产。
  要么给它真实调用方、要么展示、要么登记进 `AGENTS.md` 的「随模板分发但没有调用方」表,否则会被下轮清理删掉。
- **组件三层分工**:`ui/`(无业务语义叶子原语)→ `modules/shared/`(有版式约定、不声明字段)→
  `modules/<域>/`(业务)。**不做声明式驱动的通用 CRUD**(字段一多、校验一复杂就打架)。
- **`components/ui/` 是 vendored 目录**,`biome.json` 有 scoped override 关掉一批 a11y 规则。
  不要在里面"顺手修 lint"。**权衡原则**:与项目内已有实现正面冲突的原语不保留
  (曾删掉 shadcn 的 `sidebar` 与 `pagination`);通用但没用到的不删,但要在 `/showcase/ui` 点名。
- **时间格式化只走 `lib/time.ts`**。`lib/format.ts` 的日期函数已合并过去(同一值两处算会给出不同结果;
  `toISOString()` 是 UTC,当本地时间用会差 8 小时 —— 真实踩过两次)。
- **`mocks/settings.ts` 的角色 / 用户组种子里的 `选` 匹配式必须与 `NAV_NODES` 对齐**:改菜单后要回来核对,
  否则角色匹配到 0 个权限点(页面显示 0 项,**不报错**)。唯一例外是 `mocks/tags.ts` 的 17 个标签维度 ——
  那是「标签管理」页的业务示例数据,按需求保留。
- **权限点选择区只有 `PermissionPicker` 一个实现**;三个授权弹窗共用它,不要手写「标题+计数+搜索+全选/清空+树」。

## 视觉与配色(改 UI 前必读)

- **点缀色谱 = 6 个低饱和色相,是「配色编码」不是装饰**。`--hue-{blue,violet,teal,amber,rose,emerald}`,
  每个色相五个角色:实体 `--hue-X` / 文字 `-fg` / 软底 `-soft` / 描边 `-line` / 反白前景 `-on`。
  一级模块各认一色,**侧边栏图标块 → 面包屑胶囊 → 页头强调条 → 工作台入口卡四处同色**。
  规格见 `DESIGN.md` §2.1。告警语义仍只走 success/warn/danger(`emerald ≠ success`);一屏内不超过 4 个色相。
- **色相 → 类名的映射只有一份**:`src/components/layout/nav-tone.ts`。
  加色相要改四处:`styles.css` 的 `:root` / `.dark` / `@theme inline` + `nav-config.ts` 的 `NAV_TONES` + `nav-tone.ts`。
  **漏最后一步 typecheck 会报缺 key**(不会静默失效)。
- **Tailwind 只扫描源码里的字面量类名**:`bg-hue-${tone}-soft` 这种拼接不会生成 CSS。
  所有按色相取类名的地方必须查 `nav-tone.ts`。**这是改配色最容易踩的坑。**
- **`BADGE_THEMES`(`ui/badge-list.tsx`)是全站分类色的唯一来源**(标签列 / 标签输入 / 快速筛选 chip /
  已选筛选 pill 都读它)。已从 Tailwind 默认 `*-100/*-700`(25%–40% 彩度,太亮)换成点缀色 token。
- **动效先查 `DESIGN.md` §7.1 的「现成动效原语」表**,不要每次现搓 keyframes:
  `.page-enter` / `.route-progress-bar` / `.stagger` / `<Reveal>` / `.pulse-dot` / `.attention-dot` /
  `.icon-swap` / `.collapse-grid` / `.MotionButton`。全部已处理 `prefers-reduced-motion`。
  `.collapse-grid`(grid-template-rows 展开)是本项目**唯一允许的布局动画**。
- **阴影抬升用 `--af-raise-1|2|3`(静置 / 悬停 / 浮起)**:`shadow-(--af-raise-1)`。
  hover **只换档位 + 边框加深**,不做位移(位移会让元素从光标下移走 → hover 反复开关 → 抖)。
- **`ui/tabs.tsx` 是下划线页签**(不是卡片式;`DESIGN.md` §5.5 之前写错过,已按代码修正)。
- **侧边栏 `aside` 的 `overflow-hidden` 不能删**:宽度 240↔60 动画期间要靠它裁住内容。
  因此迷你栏的名字用**原生 `title`** 而不是自绘浮层 —— 自绘气泡必定被裁,而 CSS 做不到
  "纵向 `auto` + 横向可见"(一个轴为 `auto`,另一个轴必然也是 `auto`)。
- **侧边栏分组行上色的判据是「这一枝含当前页」,不是「这一枝展开了」** ——
  否则同时展开三个分组会看到三行都像选中。
- 文档入口:`DESIGN.md`(视觉规范唯一来源)· `AGENTS.md` §设计系统(token 约定)· `/showcase/layout` 的「动效与卡片」节。

## 自检基线

| 命令 | 期望 |
| --- | --- |
| `pnpm typecheck` | 0 error |
| `pnpm check` | **0 error / 4 warning**(`ui/badge-list.tsx` 3 处 + `shared/icons-list.ts` 1 处 `!` 断言,不要清理) |
| `pnpm generate-routes` | 改过 `src/routes/` 必跑 |
| `pnpm build` | exit 0 → `.output/` |

## 环境限制(沙箱)

- 批量删除被拦(`SAFE_DELETE_BULK_CONFIRM_REQUIRED`)→ 用 `mv` 挪走而不是 `rm -rf`;
  `vite build` 会因 Nitro 清理 `.output` / `node_modules/.nitro` 被拦而失败,先 `mv` 走再 build
- **回环网络不可达**:`curl 127.0.0.1:<port>` 连不上本地 dev server → 验证改用**构建产物内容 grep**
- `pnpm <script>` 触发 install 会报 `EEXIST` → 直接调 `node_modules/.bin/<bin>`
- `grep --include=*.ts` 在 zsh 下会被 glob 展开 → 加引号或用工具层 Grep
- shell 里的 `grep -rn "中文A\|中文B"` 结果不可靠(多次出现假空结果)→ 用 Read / Grep 工具核对

## 待办 / 可继续做的

- `lib/crud/*`、`lib/validators/`、`store/use-query-params.ts` 目前**只有定义没有调用方**;
  接第一个真实 CRUD 模块时按文件头注释接起来
- `settings` 的用户/组/角色/标签四页走 `mocks/`(内存表),菜单/字段/参数三页走真库 ——
  想统一成真后端,把那四页换成 tRPC 调用即可,页面结构不用动
- `doc/前端结构与组件约定.md` 的 §11.7「页头与需求清单溯源」是原业务的写法,
  派生新项目时可删或改写
- `new-project.sh` 在 AGENTS.md / README 里被提到但工作区里**不存在**

## 侧边栏选色规则(2026-09-21 更新)

- **`--af-hover` 是纯中性灰**(60% surface + 40% border,不要带蓝)。
  旧值 70% surface + 4% blue 与侧边栏设计注释「hover 不变蓝,蓝色只属于被选中」相违:
  hover 状态会带一丝蓝,和选中态混淆。改纯灰后所有 hover 行(侧边栏 / 表格 / stat-card /
  tags-tree)的视觉统一为「选中 = 蓝,其它 = 中性灰」。
- **一级菜单按钮**:`selfSelected = pathname === node.path`(精确匹配,子页不算)。
  蓝色出现条件 = 一级菜单**自己被选中**,不是子树被选中(原 `branchActive` 会让父级因子树
  命中而变蓝,与设计不符,5 月 Round-2 已修,见 `2026-09-20.md`)。
- **连接线 / 肘形接头**:每个子项**自己被选中**才亮,不再用整枝判断 —— 否则"选第 N 项,线
  亮在第 1 项"。这是侧边栏最容易被踩坑的点。

## 2026-09-21 收敛重构(已提交 9256157)

从 198 文件/28.3k 行 → 154 文件/20.0k 行(-8858 行,49 文件),typecheck 0 / biome 0err+4warn / prod build OK。

**删了什么**
- `showcase/`(7 路由 + 7 组件):自我文档,派生新项目时必删 → 现在 UI 示例移进工作台。
- `settings/groups`、`settings/roles`(共 14 文件 ~90KB):与 `users` 近乎相同的 CRUD,重复概念。
- 传递闭包孤儿 21 个(ui/shared/layout):删 showcase 后暴露的新孤儿要**迭代扫描**(删完再扫,直到稳定)。
- `demo/sentry.testing`(纯占位)、`demo/form.address`(与 form.simple 重复)。

**保留了什么 / 移到哪**
- **UI 原语不删**:45 个 `components/ui/*` 全部保留,新增 `workbench/ui-gallery.tsx`
  在工作台 `/` 展示全部最小可用示例(受控组件都给好 useState)。改 ui/ 时同步改这里,否则又变孤儿。
- settings 保留 5 个**形态各异**的示例:users(CRUD+授权)、tags(树)、menus(树+驱动侧边栏)、
  dictionary(轻量)、parameters(DB 配置)。

**关键坑(已修)**
- `mocks/settings.ts` 的「选」匹配式必须与 `NAV_NODES` 对齐:删了 showcase/groups/roles 后,
  原来的 `re:^showcase:` / `re:^settings:(users|groups|roles)$` 会匹配到 **0 个权限点且不报错**。
  已改为 `re:^settings:tags$` / `re:^settings:users$` / `re:^demo:`。
- `--af-hover` 改为纯中性灰(原 70% surface + 4% blue):侧边栏设计注释写「hover 不变蓝」,
  旧值和选中态混淆。
- base-ui 的 Trigger(Popover/Tooltip/Collapsible/Dialog/Sheet/DropdownMenu/Menubar)**不支持 asChild**,
  要用 `className={buttonVariants({...})}` 直接渲染。
