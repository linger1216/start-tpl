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

## 自检基线

| 命令 | 期望 |
| --- | --- |
| `pnpm typecheck` | 0 error |
| `pnpm check` | **0 error / 4 warning**(3 处在 `ui/badge-list.tsx` 的 `!` 断言,不要清理) |
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
