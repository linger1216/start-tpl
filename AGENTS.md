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

面向 AI 编码代理。一个人的 **TanStack Start 后台模板**:业务代码已清空,只剩「系统设置」一个真实模块作示例,其余是可复用能力。
人类向说明见 `README.md`。**这份文件只放能改变行为、且从代码里看不出来的规矩;长解释一律在 `doc/`。**

## 动手前先查文档(比读本文有用)

| 要做的事 | 先读 |
| --- | --- |
| **通读后端 / 摸目录结构 / 找公共路由** | **`doc/后端代码导读.md`**(目录结构 → 设计理念 → 公共路由与两个 HTTP 端点 → tRPC 中间件链 → lib 模块地图 + 阅读路线) |
| 改界面 / 加组件 / 调版式 / 高度 | **`doc/界面约定.md`**(版式骨架、组件取舍、实测高度) |
| 加页面 / 加路由 / 排目录职责 | **`doc/界面约定.md`**(版式 + 目录职责,两篇已合并) |
| 碰数据库、认证、权限、达梦 | **`doc/数据库与认证.md`** + `doc/达梦支持.md` + `doc/rbac-权限模型.md` |
| 改接口 / tRPC / 错误处理 | **`doc/后端接口约定.md`** |
| 文件 / 上传 / MinIO | **`doc/文件管理.md`** |
| 站内通知 / 铃铛 | **`doc/通知中心.md`** |
| 鉴权(登录 / 权限)、审计日志 | **`doc/审计日志.md`** |
| **改任何东西之前** | **`doc/已知陷阱.md`**(每条都真实踩过) + **`doc/数据库与认证.md`**(含数据库陷阱一节) |
| 视觉规范 / 动效 / 色板 | **`DESIGN.md`**(token 在 `src/styles.css`) |

## 常用命令

```bash
pnpm dev              # 开发服务器,固定 3000 端口
pnpm typecheck        # tsc --noEmit —— 改完必跑,只报告不写文件
pnpm check            # biome check --write —— 格式化 + lint + 整理 import,会写回文件
pnpm generate-routes  # 改过 src/routes/ 之后必跑(routeTree.gen.ts 是生成物,不要手改)
pnpm build            # 生产构建 → .output/(不是 dist/)
pnpm test             # 直调 tRPC procedure 的集成测试(要 .env.local 指向的库)
pnpm db:create        # 建系统表 21 张(20 张 sys_* + demo_grid;幂等;建完顺带对齐注释 / 索引名 / 旧列列型)
pnpm db:dm:create-ba  # 达梦线:建 17 张表(逐张清单见 doc/达梦支持.md,幂等)
pnpm db:sync:meta     # 对齐表 / 列注释与索引名(幂等,唯一真源)
pnpm db:seed:menus / :dicts / :paras / :tags / :rbac / :demo   # 六个种子都幂等「只补不覆盖」
pnpm db:minio:init    # 建桶 + 公开桶只读策略 + tmp/ 生命周期
```

`typecheck` 与 `check` 是最重要的两条自检。**`check` / `lint` / `format` 都带 `--write`。**

## 代码风格

**`biome.json` 是唯一权威**(`.editorconfig` 只是与它对齐):**Tab 缩进**、双引号、`lineWidth 120`;导入别名**只用 `#/*`**(`@/*` 已移除)。
`src/components/ui/` 是 vendored 目录,有一条 scoped override —— **不要在里面顺手修 lint**;改配置,不改组件代码。

## 硬规矩(每一条都不能越过)

- **接口只有 tRPC**:后端不要再开 REST 路由(唯一例外是 BA 的 `/api/auth/*`)。
  客户端一律 `useQuery(trpc.X.queryOptions(...))` / `useMutation(trpc.X.mutationOptions(...))` —— **严禁 `fetch` / axios / 自写 `queryFn`**;
  服务端 SSR loader 与 server function **不要绕过 HTTP 直调 procedure caller**(`createCallerFactory` 只归测试用)。
- **每新增一个 procedure 都要在 `lib/rbac.ts` 里分类**:写接口登记 `sys:*` 权限点;**读接口(query)三选一** ——
  登记成它所属页面的合成码 `page:<路径折算>:view` / 进 `UNMAPPED_QUERIES`(必须写理由)/ 值写成数组(任一页面可见即放行)。
  忘了分类 `tests/auth.test.ts` 直接挂。页面级拦截在 `routes/(main)/route.tsx` 的 `beforeLoad`,
  **没权限返回的是 404 不是 403**(框架对错误终态写死 500,只有 not-found 通道有 4xx)。详见 `doc/rbac-权限模型.md`。
- **同类页面必须同形**:同一个动作全站只能有一种形态,而且同类页面必须都长出来。改通用功能前先把同类页面扫一遍。
- **禁止薄封装**:新增组件前问一句「把它删掉,调用点能不能直接写出来?」—— 能就是薄封装,删。
  (保留的是「删掉后调用点会重复一段结构或逻辑」的件:如 `DetailRow` / `RefreshButton` / `TextCell` / `PageFrame`。)
- **按钮分两族**:主操作与对话框动作用 `ui/button` 的 `Button`;数据行内的小动作用 `ActionButton`(**纯文字、无图标、悬停才出下划线**);
  树的行尾才用纯图标的 `ActionIconButton`。页面刷新统一 `RefreshButton`,别手写带文字的。
- **详情 / 表单的字段**:直接用 `ui/detail-row` 的 `DetailRow` **单列**内联写,**没有 `fields={[...]}` 声明式封装**;
  **`label` 只给一句纯描述**(别加 fragment、别塞灰色小字);**创建 / 更新时间不进字段列表**(由 `DetailDialog` 的 `meta` 渲染在底部)。
- **版式骨架照抄,不要自创**:列表页 = 台账布局(页头 → StatCards → 工具条在卡外 → 卡内表格 + 分页);
  三个树页栅格统一 `lg:grid-cols-[30rem_minmax(0,1fr)]`;三个 tab 编辑器 `sm:max-w-2xl` + `flex h-[52vh] flex-col`。
  细节与理由 → `doc/界面约定.md`。
- **高度铁律**:**弹窗本身永远不出滚动条**,滚的只能是控件内部(候选列表 / 字段区 / 权限树);动作行与内容留 12px。
- **新增可复用件**:要么给它真实调用方,要么在工作台(`components/modules/workbench/ui-gallery.tsx`)加一格,要么登记进 `doc/界面约定.md` 的备选表 —— 三者都不做会被当死代码清掉。
- **版本坑**:TanStack Query / tRPC / Table 是 **v5 / v11 / v9**(别按 v4/v10/v8 写);Tailwind **v4 没有 config 文件**,主题 token 在 `src/styles.css`;
  `src/components/ui/` 全是 **Base UI**,shadcn 文档里的 Radix 写法(`asChild` / `onSelect`)**照抄会静默失效**。
- **数据库**:两张 schema 文件口径不同,**不要混**(`schema.ts` 只放迁移管辖的 `todos`;系统表在 `data-base-schema.ts` + 两个建表脚本 + `sync-table-meta.ts` 里三处同步);
  `db` 只能在服务端 import。详见 `doc/数据库与认证.md`。
- **认证**:`(main)` 全程要登录,守卫在服务端做且 `createServerFn` 里**动态 import** server-only 模块(否则 mysql2 进浏览器包直接崩);
  不开放自注册;代人改密码必须用 BA 的 `hashPassword` 并**真登一次**验证。
- **达梦**:`dm://` 自动切换驱动;URL 必须带 `?loginEncrypt=false` 与 `?schema=`;改表名后要清计划缓存。详见 `doc/达梦支持.md`。

## 改动完成后自检

```bash
pnpm typecheck
pnpm check
pnpm build
pnpm test
```

改了 `src/routes/` 下的文件,别忘了 `pnpm generate-routes`。

**已知基线:`pnpm check` = 0 error / 4 warning**(另有 1 条 info),只有两个文件、一类规则:
`src/components/ui/badge-list.tsx`(3 处 `noNonNullAssertion`)、`src/components/modules/shared/icons-list.ts`(1 处)。
`src/db/dm/translate.ts` 另有 1 条 `useTemplate` —— 三者都在「不要顺手修」范围内。**新代码不要新增 warning。**
