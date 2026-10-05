# start-tpl —— TanStack Start 后台模板

一个人自用的**后台管理系统模板**:React 19 + TanStack Start,自带后台外壳、41 个 UI 原语、16 个跨域展示件、台账页面骨架,以及 tRPC + Drizzle + Better Auth + RBAC(页面级拦截 + 菜单/按钮授权)的完整接线。

模板里**只保留一个真实业务模块**(系统设置,十二个页面),其余业务代码已清空 —— 剩下的每一块都是"可以直接搬进新项目"的能力。所有组件都有**活文档**:工作台 `/` 的 UI 示例逐个给出真实渲染的例子(受控的都给好了 useState),改了组件页面立刻反映,文档不会过期。

技术栈:React 19 · TanStack Start / Router / Query / Form / Table **v9** · tRPC **v11** · Drizzle ORM + MySQL / 达梦 · Better Auth · Tailwind CSS **v4** · Biome · Vite 8 · TypeScript 6

环境要求:Node ≥ 20.19,pnpm 11(`packageManager` 已固定为 `pnpm@11.23.0`)。

---

## 快速开始

```bash
pnpm install
cp .env.example .env.local     # 然后按需填写 DATABASE_URL 等
pnpm db:create                 # 建 21 张系统表(20 张 sys_* + demo 用的 demo_grid,幂等)
pnpm db:seed:menus && pnpm db:seed:rbac && pnpm db:seed:paras && pnpm db:seed:dicts
pnpm db:seed:demo              # 可选:71 条网格数据(那批演示账号是本机手工准备的,种子不建)
pnpm dev                       # http://localhost:3000
```

`pnpm dev` 固定监听 **3000** 端口。

> **组件示例都在工作台 `/`**。它自己也读菜单表,所以要先把 `.env.local` 的 `DATABASE_URL` 配好再 `pnpm dev`。
> `/settings` 十二页全部读真库,没配 `DATABASE_URL` 会落到错误边界。演示账号见 `doc/测试数据/README.md`(密码统一 `Passw0rd123`,管理员 `admin@example.com`)。
> 不想在本机装 MySQL / MinIO:`docker compose` 一套起齐,见下文「Docker / 容器化」。

---

## 打开后先看这四块

| 入口 | 内容 |
| --- | --- |
| **工作台** `/` | 模板入口页:上手四件事、目录职责速查、派生时删什么的清单 |
| **UI 组件示例** | ★ 就在工作台 `/` 页里:41 个原语的最小可用例子 + 台账表格实战示例 |
| **框架能力** `/demo/*` | 6 个能力样例(数据请求 / 表单 / 表格 / 数据库 / 登录认证 / 全局状态)+ 2 个演示业务页(「业务首页」+「网格履职」) |
| **系统设置** `/settings/*` | ★ 唯一保留的真实业务模块,**十二个页面**,全部读写真库(见下文「系统设置模块」) |

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
│   │   ├── demo/                 # 框架能力样例(8 个路由文件)
│   │   └── settings/             # 系统设置(13 个路由文件 = 索引 + 12 页)
│   ├── api.trpc.$.tsx            # tRPC 请求入口 /api/trpc/*
│   └── api/auth/$.ts             # Better Auth 请求入口 /api/auth/*
├── components/
│   ├── ui/                       # 41 个叶子原语(shadcn 风格 + 自研组合控件)
│   ├── layout/                   # 后台外壳:sidebar / topbar / 面包屑 / 页头 / 空态 / 占位页 + nav-config / nav-menu / nav-data
│   ├── modules/shared/           # 16 个领域无关展示件(表格套件 / 工具栏 / 详情 / 树 / 标签 / 权限树 / Excel…)
│   ├── modules/workbench/        # 工作台 + UI 示例(ui-gallery)
│   ├── modules/settings/         # 系统设置十二页的页面 / 表格 / 表单 / 详情件(49 个文件)
│   ├── modules/demo/             # 框架能力样例的页面件
│   └── modules/notice/           # 通知中心件
├── lib/
│   ├── api/error.ts              # ApiError / toApiError
│   ├── table.ts                  # TanStack Table v9 的 app hook(useAppTable + useRowSelection)
│   ├── excel.ts                  # Excel 列类型 + 唯一写盘点 writeSheet / cellText
│   ├── rbac.ts                   # 权限码判定 + PERM_BY_PATH(接口 → 权限点的唯一字典)
│   ├── casbin.ts                 # casbin enforcer + 策略装载(仅服务端)
│   ├── auth.ts / auth-client.ts / auth-debug.ts / current-user.ts
│   ├── sys-para.ts / para-spec.ts / menu-spec.ts / notice.ts / sidebar-mode.ts
│   ├── audit.ts / logger.ts / ids.ts / time.ts / format.ts / multi-value.ts / tree.ts / constants.ts
│   ├── storage.ts / storage-minio.ts / menu-detail-path.ts / mock-table.ts / demo-store.ts / utils.ts
├── db/
│   ├── index.ts                  # drizzle 实例(按 env 选 mysql2 / 达梦),导出 db
│   ├── data-base-schema.ts       # 21 张系统表(20 张 sys_* + demo_grid:设置 / 认证 / 权限 / 数据权限 / 日志…)
│   ├── schema.ts                 # 走 drizzle 迁移的表(当前只剩 demo 的 todos)
│   └── dm/                       # 达梦方言适配(连接 + SQL 翻译)
├── integrations/
│   ├── trpc/                     # init.ts / router.ts / react.ts + routers/(12 个域)
│   └── tanstack-query/           # root-provider.tsx(getContext + TRPCProvider)
├── hooks/                        # use-dict / use-para-prefs / use-perms / use-file-upload / use-ledger-table / use-stable-keys / demo.form*
├── router.tsx                    # ★ createRouter + SSR Query 集成(按约定路径被插件加载,别删)
├── routeTree.gen.ts              # 生成物,不要手改
└── styles.css                    # Tailwind v4 入口 + 设计 token
```

`lib/` 的 33 个文件、`ui/` 的 41 个原语、`shared/` 的 16 个展示件(口径:`ls src/lib/*.ts` / `src/components/ui/*` / `src/components/modules/shared/*.tsx`),当前**没有一个是没有调用方的死件**:要么有真实页面在用,要么在工作台 `/` 的 UI 示例里有一个实例。刻意留着、业务页还没接的只有两组:Excel 那一组(`lib/excel.ts` + `shared/ledger-excel.ts` + `shared/excel-import.tsx`)与 `hooks/use-dict.ts`(字典读取器;目前只有管理页在写字典,没有页面在读),理由见下文「随模板分发、当前没有调用方的件」。

---

## 组件层:三层分工

| 层 | 位置 | 放什么 | 判断标准 |
| --- | --- | --- | --- |
| **叶子原语** | `components/ui/` | Button / Card / Table / SearchSelect / BadgeList… | 接口里**不含任何业务概念**,能直接搬进任何新项目 |
| **跨域展示件** | `components/modules/shared/` | DataTable / LedgerToolbar / FilterChipBar / StatCards / PaginationControl / ColumnToggle / DetailDialog / SortableTree / PermissionTree / MultiSelect / MemberZone / IconPicker / ExcelImportDialog… | 有**版式或行为约定**,但字段声明与数据订阅仍由调用方给 |
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

**日常三条**(`typecheck` + `check` + `generate-routes`),`check` 带 `--write`:

| 命令 | 实际执行 | 说明 |
| --- | --- | --- |
| `pnpm dev` | `dotenv -e .env.local -- vite dev --port 3000` | 开发服务器,固定 3000 端口 |
| `pnpm build` | `vite build` | 产出 Nitro Node 服务到 `.output/` |
| `pnpm start` | `node .output/server/index.mjs` | 运行生产产物,需先 `pnpm build`,**不读 env 文件**(见下文) |
| `pnpm preview` | `vite preview` | Vite 自带预览。产物是 Nitro 服务,验证生产请用 `build && start` |
| `pnpm typecheck` | `tsc --noEmit` | 类型检查,只报告不写文件 |
| `pnpm check` | `biome check --write .` | 格式化 + lint + 整理 import,**会写回文件** |
| `pnpm generate-routes` | `tsr generate` | 扫描 `src/routes/` 重新生成 `routeTree.gen.ts` |
| `pnpm test` | `LOG_SILENT=1 dotenv -e .env.local -- node --import tsx --test --test-reporter=spec tests/*.test.ts` | 20 个测试文件,直连真库;跑完会清掉自己造的 `__test__*` 数据 |
| `pnpm test:cov` | 同上 + `--experimental-test-coverage` | 覆盖率是 Node 自带的(**没有 c8 / vitest**)。口径见下文「覆盖率怎么读」 |
| `pnpm check:legacy` | `node scripts/check-legacy.mjs` | 业务语汇残留扫描(清空业务后应当无输出) |

**数据库**(都读 `.env.local`):

| 命令 | 说明 |
| --- | --- |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:pull` / `db:studio` | drizzle-kit;只管 `src/db/schema.ts`(当前是 `todos`) |
| `pnpm db:create` | 建 **21 张**系统表(20 张 `sys_*` + `demo_grid`,`create table if not exists`,幂等,建完顺带对齐列注释 / 索引名) |
| `pnpm db:sync:meta` | 只对齐列注释与索引名(老库升级用,**幂等**;第二次必须打印「无需改动」) |
| `pnpm db:migrate:ids` | 把自增 id 迁成 nanoid(一次性) |
| `pnpm db:dm:smoke` / `db:dm:defaults` | 达梦专项:drizzle 冒烟 / 默认值对齐 |
| `pnpm db:dm:create-ba` | 在达梦上建 Better Auth 四表 |

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
| `bootstrap` | — | profile `setup` 的一次性任务:建 21 张表 + 四个种子 + `db:minio:init` |

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
| `VITE_TRPC_STREAM` | 否 | 设 `1` 换成流式(`httpBatchStreamLink`);留空用非流式,响应是完整 JSON,DevTools 里能直接读 |
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
| `src/db/data-base-schema.ts` | **21 张系统表**(20 张 `sys_*` + `demo_grid`):菜单 / 字典 / 参数 / 标签 / 标签关系 / 用户 / 会话 / 账号 / 验证 / 账号锁定 / 限流 / 部门 / 角色 / 用户-部门 / casbin 策略 / 通知 / 日志 / 演示网格 / 文件 / 数据策略 / 数据插件 | **不进 drizzle 迁移**:只在这里声明"读写的形状",DDL 由 `scripts/create-system-tables.ts`(`pnpm db:create`)维护,列级对账靠 `pnpm db:sync:meta` |
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

登录安全:人机验证**默认就是开的**(CaptchaKit 自托管,密钥没配会自动生成,见 `src/lib/captcha-secret.ts`);邮件则默认只打到终端,要真发配 `MAIL_DRIVER=smtp`(见 `src/lib/mailer.ts` 与 `.env.example`)。异常监控不在模板内置 —— 想接 Sentry 或自建告警,自己在 `lib/` 里加。

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
6. **mutation** —— 每个动作单独一个 `useMutation(mutationOptions())`,成功后按需 `invalidateQueries`;删除走 `ConfirmDialog`;错误提示走 `lib/api/error.ts` 的 `toApiError`(取 `.message`)
7. **详情 / Excel(可选)** —— 详情用 `shared/detail-dialog.tsx`(`DetailRow` 的 label 只给纯描述;时间放 `meta` 不放 fields);导入用 `shared/excel-import.tsx` 的 `ExcelImportDialog`,导出用 `shared/ledger-excel.ts`,写盘点只有 `lib/excel.ts` 一处

可复用的展示件都在 `src/components/modules/shared/`:表格套件 / 工具栏 / 筛选 chip / 分页 / 指标卡 / 详情弹窗 / 可拖拽树 / 权限树 / 多选 / 成员区 / 图标选择 / 列切换 / Excel 导入导出。**先看工作台**,它就是拼装说明书。

---

## 刻意留着、但业务页还没接的件

实测:仓里**没有无调用方的死件**。`lib/` 33 个文件、`ui/` 41 个原语、`shared/` 16 个展示件,要么有页面在用,要么在工作台 `/` 的 UI 示例里有实例;`permission-tree`(角色授权弹窗)、`formatCode`(业务编号)也都有真实调用方。

刻意保留、业务页尚未接的是下面两组(其余件都有调用方):

| 件 | 位置 | 说明 |
| --- | --- | --- |
| 列类型 + 写盘点 | `src/lib/excel.ts` | 导出列类型与 `writeSheet` / `cellText`(全仓唯一写盘点) |
| 台账导出 | `src/components/modules/shared/ledger-excel.ts` | 拉全量 → 行映射 → XLSX → 下载 |
| 导入弹窗 | `src/components/modules/shared/excel-import.tsx` | 解析 → 校验 → 提交 mutation 的对话框 |
| 运行示例 | 工作台 `/` 页 | 三者的最小可用示例 |

**`hooks/use-dict.ts`(字典读取器)** 也属于这一类:接口是现成的(`dict.byCode`),但目前只有字典管理页在**写**字典,还没有页面**读**它做下拉 —— 留着当模板件,新项目做业务表单时会第一个用到。

**约定**:新增可复用件时,**要么给它一个真实调用方,要么在工作台 UI 示例里展示,要么登记进本节** —— 三者都不做,它会被下一轮清理当成死代码删掉。

---

## 系统设置模块(唯一保留的真实业务)

`/settings/*` **十二个页面,全部读写真实数据库**,没有占位页、没有 mock:

| 页面 | 路由 | 数据来源 | 演示的骨架 |
| --- | --- | --- | --- |
| 用户管理 | `/settings/users` | `sys_user` + `sys_user_dept` + `sys_casbin_rule`(`g` 行) | 台账 CRUD + 角色 / 部门分配 |
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

## 派生新项目

模板自带 `new-project.sh`(在仓库根目录),按下面的方式派生一个干净的新项目:

```bash
./new-project.sh my-app              # 派生到 ../my-app
./new-project.sh my-app --into ~/src # 指定父目录
./new-project.sh my-app --strict     # 模板有未提交改动时直接中止
```

它做的事(都是纯文件操作,没有代码生成):

| 步骤 | 行为 |
| --- | --- |
| 名称规范化 | `My Cool APP!!` → `my-cool-app`(会提示已规范化) |
| 目标已存在 | 报 `Error: 目标已存在: <path>` 并 exit 1,**绝不覆盖** |
| 同名校验 | 只在**同一父目录**下才拦你(比较的是绝对路径,换个 `--into` 就能同名) |
| 复制 | rsync 主路径,失败回落到 `find`;排除 `node_modules` / `.git` / `.output` / `dist` / `.vite` / `.tanstack` / `.turbo` / `coverage` / `new-project.sh` / 真实 `.env*` |
| 带走的东西 | `.env.example`(**唯一的 env 文件**)、`pnpm-lock.yaml`(让 `pnpm install` 命中锁) |
| 改写 | `package.json` 的 `name`、`.cta.json` 的 `projectName` |
| 生成 env | 由 `.env.example` 复制出 `.env.local`,随机填 32 字节 base64 的 `BETTER_AUTH_SECRET`,权限 600 |
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
4. `src/components/layout/sidebar.tsx`:改品牌名(`<SidebarHeader title="管理后台" subtitle="TanStack Start 模板" />`,收起态只剩图标,名字走原生 `title`);`topbar.tsx` 不用动,它接的是真实会话用户
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
| `sortable-tree.tsx` | `shared/` | 同级拖拽树 |
| `file-dropzone.tsx` | `ui/` | 文件拖放区 |
| `menu-detail-path.ts` | `lib/` | 从 651 行的业务文件里抽出的「参数化菜单路径」约定 |

**删除**:12 个业务域目录(约 500 个文件)、80 条业务路由、29 个业务 lib、27 个业务 mocks、6 个业务 tRPC 路由、18 个业务脚本。`trpc/router.ts` 从 9 个命名空间收窄到 3 个(menu / dict / config)+ `todos` 示例。

**保留**:系统设置模块(**十二个页面全部接真实数据**)、框架能力样例(8 页)、组件层、Better Auth、Drizzle、tRPC、设计系统。

### 第二轮:遗留与封装审计

裁剪完又做了一遍全量审计(按「可达性 + 未使用导出 + 业务语汇 + 重复实现」四个维度),修掉的问题:

| 类别 | 发现 | 处理 |
| --- | --- | --- |
| **被抽出来但没人用的件** | `file-dropzone` / `table-resize-handle` 抽完就没了调用方,也没进展示页 | 补进展示页(当时叫 `/showcase/*`,现在就是工作台 `/`;看不见 = 不存在) |
| **重复实现** | 三个授权弹窗各自手写「标题 + 计数 + 搜索 + 全选/清空 + 权限树」;而 `PermissionPicker` 早就是这块的封装 | 三处改用 `PermissionPicker`,顺手去掉 `keyword` state 与 `visibleIds` 派生 |
| **重复实现** | `lib/time.ts`(0 引用)与 `lib/format.ts` 各有一套日期格式化 | 日期函数只留 `lib/time.ts`,`format.ts` 只管值 / JSON 归一 |
| **正面冲突的 ui 原语** | `ui/sidebar`(与 `layout/sidebar` + `SidebarProvider` 同名冲突)、`ui/pagination`(与 `shared/pagination-control` 重复)、`hooks/use-mobile`(只服务前者) | 三件一起删;其余通用原语在工作台的 UI 示例里点名 |
| **死导出** | `NAV_PERMISSION_POINTS` / `NAV_PERMISSION_IDS` / `findNavTrail` / `findNavNode` / `flattenNavNodes` / `TruncateCell` / `moveWithinSiblings` / `countMultiValueHits` / `SHEET_DROPZONE_PROPS` / `UI_PRIMITIVE_COUNT` | 删除;另有 `visiblePermissionIds*` / `menuIconOf` / `trpcClient` 等只在本文件内用到的,收回模块内部 |
| **业务语汇残留** | 各业务域名词散在 25+ 个文件(含可见 UI 文案) | 全部泛化;`mocks/shared.ts` 从 299 行收到 91 行(只留真正被用到的 9 个原语;这份 mock 后来随业务清空一并删除) |
| **功能性 bug** | 角色种子的权限点匹配式还写着已删的域名,而权限树已从新 `NAV_NODES` 派生 → **6 个角色匹配到 0 个权限点**(页面显示 0 项,且不报错) | 重写 8 个角色 / 8 个用户组的匹配式对齐新菜单,并加注释提醒「改菜单要回来核对」。(那批角色 / 用户组种子随后已在「用户 / 用户组 / 角色三页去掉 mock」一轮**整体删除**) |
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

### 第四轮:重复实现审计 + 权限两层 + 日志覆盖率(2026-09)

业务清空之后,以「同类页面同形、一件只允许一个实现、实测优先」为准又过了一遍:

| 改了什么 | 说明 |
| --- | --- |
| **重复实现审计 + 收敛重构** | 删掉通用 CRUD 套件(`lib/crud/*`)、查询参数 store、`lib/validators/common.ts` 等"配置式"封装 —— 字段一多,配置对象开始打架,读代码还得两处跳。UI 组件**一件没删**(有调用方或在工作台有实例),Excel 那一组刻意留着 |
| **权限拦两层** | ① 页面级:`(main)/route.tsx` 的 `beforeLoad` 服务端读会话 + 判页面权限,**没权限返回 404 不是 403**(详情见 `doc/已知陷阱.md`);② 接口级:每个写接口进 `lib/rbac.ts` 的 `PERM_BY_PATH`,读接口三选一登记,`write` 才放行 |
| **日志 100% 覆盖** | 每个 procedure 一条 `trpc.start` / `trpc.ok` / `trpc.err`,失败在 `trpc.err` 带错误码;附 28 条事件的**日志字典**(`doc/审计日志.md` §七),30 分钟清理测试残留 |
| **两份化石文档重写** | `README.md`(本文)与 `doc/后端接口约定.md`:前者还写着 47 个原语 / 7 个占位页 / 未接认证,后者整篇是已删业务(`lib/fusion-lane.ts` / `entity.*` / `source.*`)与不存在的脚本 |

清空业务后的基线:`pnpm typecheck` 0 · `pnpm check` 0 error / 4 warning / 1 info · `pnpm build` 通过 · `pnpm test` **158 / 158**(15 个测试文件)。

**覆盖率怎么读**(`pnpm test:cov`):Node 自带的 `--experimental-test-coverage`,**没有** c8 / vitest。两个坑:① 别加 `--test-reporter=dot`,它会吞掉覆盖率报告;② `--test-coverage-include=src/**` **补不进**"测试从未 import 的文件"。所以这份数字的口径是**测试运行中加载过的文件**:`src/lib` 与接口层约 93% line,而 `src/components/*` 与 `src/routes/*` 是**零测量**(服务端测试从不 import 它们)。要抬界面层,得先引 jsdom / playwright —— 那是另一件事。

### 第五轮:「面向收敛」精简重构(2026-09)

这一轮只用一个判据动刀:**同一个东西是否存在第二个实现**。删除优先于新增,但**只有逐字相同**的部分才允许上升为共用件 —— 凡是要靠加开关才能通用的,一律不抽。

| 改了什么 | 说明 |
| --- | --- |
| **偏好契约三合一** | `use-column-prefs` / `use-tree-prefs` / `use-page-size` → `hooks/use-para-prefs.ts`(179 行)。三个 `sys_para` 键(`page.columns` / `page.tree` / `page.size`)的名字与 JSON 形状**一字未改**,存量账号偏好零迁移 |
| **台账装配抽件** | 9 个台账页逐字手抄的「卡 + 匹配 N 条 + 表 + 空态 + 页器」→ `shared/ledger-card.tsx`(72 行)+ `hooks/use-ledger-table.ts`;页头 / 统计卡 / 工具条 / 批量条仍归页面(它们各页不同,抽出来只能靠开关区分 = 假抽象;第六轮把批量条里逐字相同的那半截也抽走了,见下) |
| **过滤收敛** | 9 处各写一遍的 `useMemo` → `lib/table.ts` 的 `matchKeyword(fields, keyword)`;顺手统一大小写口径(**行为差异**:原先 parameters / dictionary / logs 三页是大小写敏感的) |
| **UI 原语只精简、不删** | 41 件一件未删:删掉 9 个零调用点的死 prop(`skeleton` / `tag-input` / `file-dropzone` / `badge-list` / `table-kit`),`stat-cards` 去掉 `trend` / `spark` / `variant="cards"`,7 处任意值类名改回真 token —— 其中 `wrap-break-words` 是**只有引用、从未生效**的写法(正确类是 `wrap-break-word`) |
| **死件与配置面** | 删 5 个跑不通的脚本 + 4 条僵尸 script + 1 个死依赖(`@tanstack/match-sorter-utils`)+ 137 行只在假控件上生效的 CSS;`StubPage` 内联进 `blank.tsx` 后删除;topbar 那个**没有 handler 的假搜索框**与写死的路径→标签表一并去掉;`.env.example` 41 → 38 行 |
| **文档叙事** | `doc/界面约定.md` 951 → 454 行(删掉与末尾备选表重复的整块 + 迁移期的合并注释);6 份文档的件数 / 事件数 / 过程数 / 表数逐条按实测改,并把本轮新抽的两个件写进「列表页版式」节(新页面照 `LedgerCard` + `useLedgerTable`,不再手抄某个页面) |
| **刻意不做** | 不并 sheet/dialog;不内联 9 个单调用方页面件(page/table/form/detail 的「后缀即契约」是既定口径);~~不抽 `selection-bar`~~(**第六轮已推翻**:三页动作集确实不同,所以只上升逐字相同的那半截,动作仍由页面传入)、`use-ledger-mutations`、`prefetchPageSize`;保留 `logger` 与 `log` 两套 API;Excel 三件与 `hooks/use-dict.ts` 登记为「已实现、无业务调用方」但保留 |

体量:92 files, **+677 / −2644**,加 3 个新件(+278 行)⇒ **净减约 1689 行**,删除 9 个文件。

基线:`pnpm typecheck` 0 · `pnpm check` Checked 215 files / **0 error / 4 warning / 1 info**(与上一轮一字不差)· `pnpm build` 通过 · `pnpm test` **158 / 158**。行为验收用生产服 + 带 cookie 的 SSR 请求:11 个页面全 200 且匹配数与改前逐条一致(参数 17 / 用户 38 / 角色 12 / 文件 7 / 字典 3 / 日志 200),权限三态不变(队员 `/settings/users` = 200、未登录 = 307 带 `redirect`、未知路径 = 404「页面不存在」)。

### 第六轮:四片只读审计 → 逐条收敛(2026-10)

判据与第五轮相同(**同一个东西是否存在第二个实现**;删除优先于新增;只有逐字相同的才上升为共用件)。区别是这轮先派四片**只读**审计(UI 原语 / settings 域 / shared+hooks+layout+workbench+demo+notice / lib+integrations+db+routes+scripts),拿着清单逐条落地 —— 审计的结论**也证伪了几条**:所谓「13 处时间列」逐字相同的只有 3 处、「7 个页面各手搓一整套 CRUD」不成立、「画廊可压 27%」实测只压得动 12 行。

| 改了什么 | 说明 |
| --- | --- |
| **幽灵子系统** | `sys_para` 里 9 个「清理 / 定时同步 / 原始数据保留」键**没有任何读取方**(`getParaInt` 全仓只被画廊一句散文提到)→ 删这 9 键与配套的「立即清理」按钮页(`settings-parameters-cleanup.tsx` 整文件,它调的 job 路由根本不存在);参数表 17 → 8 行,种子重跑「新增 0 条」 |
| **v2 死代码** | `probeFn` / `parseParams` / `PluginCtx` / `clearResourceMetaCache` / `PolicyDefinition`+`dataScopePolicy` / `multiValueFilterFn` / `SortIcon` 的多余 `export` / `appFeatures` / `casbin` 的两个前缀常量 / 3 层「兼容用」re-export —— 逐个 grep 到零调用方后删除,并把注释里与事实相反的措辞(「`fixed` 是兜底」「`descendantsOf()`」)改对 |
| **单一真源** | 文件后缀白名单 + 20 MB 上限原先服务端与上传弹窗各写一份 → `lib/para-spec.ts` 两个常量,3 个消费方统一;**通知级别**原先 5 处各写一遍(且长短标签确实不同,不是简单重复)→ `lib/notice-levels.ts`;`ADMIN_ROLE_NAME` 两处定义 → 一处 |
| **共用件** | 时间列 → `table-kit` 的 `timeColumn` / `TimeCell`(只换逐字相同的 3 处;~~另 12 处带灰度与空值 `—` 回退,保留原样~~ —— **第八轮已推翻**:那 12 处也全部换成 `timeColumn`,`TimeCell` 自己回退 `—`);批量选择条 → `ledger-card` 的 `SelectionBar`(零选中返回 `null`,「已选 N 条(前三个名字 …)」只写一处,动作由页面以 `children` 传入);画廊的手搓工具条 / 卡壳 → `LedgerToolbar` / `LedgerCard`,并补上「搜索变化回第一页」 |
| **修事实错误** | `scripts/create-system-tables.ts` 的 **104 处内联列注释**与 `sync-table-meta.ts` 的映射表重复且已串味(A/B 快照 md5 逐字节相同 ⇒ 确认是死数据,已剥);`workbench-page.tsx` 的「44 个原语」→ 41、「建五张系统表」→ 19 张、「测试共 29 条」→ 不写死数字、「由 `NAV_NODES` 派生」→ 其实只有一张卡是派生的、两处**永远走不到**的分支 |
| **两个回归** | 上一轮抽 `Spinner` 时把「只有转圈、不带字」场景的可播报文本删没了 → 无 `label` 时渲染 `sr-only` 的「加载中」;`button-group` 丢了相邻按钮的 `border-l-0` → 相邻描边按钮会叠成 2px 缝 |
| **文档** | 表数 17 / 18 → **19**(README / AGENTS / 4 份 doc)、种子 7 → 6、已删符号(`raw.retention.*` / `probeFn` / `parseParams` / `clearResourceMetaCache` / `descendantsOf`)从文档里清掉;`doc/文件管理.md` 的幽灵键 `file.allow_content_type`、`doc/界面约定.md` 的 `appFeatures` 一并修;`ui/sheet` 补登备选表 |
| **测试脚手架** | `tests/helpers.ts` 的兜底清扫原先只认 `operator_id = "test-admin"`,漏掉 `test-nobody` / `test-other-*`(实测曾漏 863 行),且完全没覆盖 `sys_data_plugin` / `sys_data_policy` → 收敛成一个 `isTestOperator()`(`test-` 前缀 ∪ `__test__` 前缀)+ 两张表按 `plugin_key` 前缀清;顺手把库里 1775 行历史测试数据清掉(311 行 `__` 打头 + 1459 行 `test-*` 身份 + 4 个插件 + 1 条规则,清前先 `mysqldump` 到 `/tmp`) |
| **伪信号** | `route-progress` 原是「pathname 一变就无条件转 720ms」的假进度条 → 改读路由自己的 `isLoading`,连带删掉 `useRef` / `useState` / `useEffect` / `setTimeout` 四个状态位(27 → 24 行);CSS 注释同步改成「一次**真实加载**」。已知取舍:单次扫光,加载比它久会提前淡出 —— 不为它引入 nprogress 那套状态机 |
| **伪扩展点** | 导出面收敛到「真的有人 import」:**15 个**只有本文件用的类型 / 常量去掉 `export`(data-scope 的 `ScopeRow` / `ScopePreview` / `DraftRule` / `ResourceMeta` / `ResourceColumnMeta` / `PolicyUser`、`mock-table` 的 `MockTableStore`、`policy-context-block` 的 props、`use-para-prefs` 的 `PAGE_COLUMNS_KEY` / `PAGE_TREE_KEY` / `PAGE_SIZE_FALLBACK` / `parsePageColumns` 与 4 个偏好形状;其中 `parsePageColumns` / `PageColumnsMap` 已在第八轮**直接删掉** —— 它就是个 `parsePageRecord` 的薄封装);**真死件** `parsePageTree` + `PageTreeMap` 直接删(`useParaRecord` 自己就会解析,这两个包装没人调);`rbac.ts` 里与 `layout/nav-menu.ts` **同名不同形**的 `MenuRow` → `SysMenuRow`。剩下的 22 个零引用导出**全部是有意留的**:6 个 UI 原语的类型、Excel 链 11 个、文档点名的 `RuleItem` / `ResolvedPlugin` / `PluginInfo` / `TimeCell`、靠约定路径加载的 `getRouter` |
| **刻意不做** | 维持第五轮结论**不并** sheet/dialog(只补登记);**不删** Excel 三件、`hooks/use-dict.ts`、`tests/helpers.ts` 里零调用方的 `testId` / `purgeTestAuditRows`(都是登记在册的「已实现、无调用方」,且不是本轮造的东西);**不接线** Excel 导入导出 —— 那是加功能不是收敛;不动 lucide 动态取值(动行为);`/demo/table` 自带的那个 `SortIcon` 不并入 `table-kit`(该页刻意手搓,属「table 封装例外」);`@tanstack/devtools-event-client` 那行 `devDependencies` 确认冗余,但本机 `pnpm` store 异常、无法验证删除,先留着 |

基线:`pnpm typecheck` 0 · `npx biome check .` Checked 256 files / **0 error / 4 warning / 1 info**(与上一轮逐项相同)· `pnpm db:create` 幂等(全「已存在 / 不存在,跳过」,表注释 / 列注释 / 索引名「已是最新」)· `pnpm build` 通过 · `LOG_SILENT=1 pnpm test` **150 / 150**。

---

### 第七轮:模板待完善八项(2026-10)

这是「作为管理后台模板,还有哪些功能待发现 / 完成 / 待完善」那一问的落地清单(逐项一个 commit)。

| 改了什么 | 说明 |
| --- | --- |
| **#15 删占位页** | `/blank`(「功能开发中」)整文件删除 —— 它的"派生脚手架"作用已被 `LedgerCard` + `useLedgerTable` 的新页面版式取代;顺手清掉 `rbac.ts` 里 `/blank` 的两处登记与文档引用 |
| **#2 服务端登录校验** | 复核后确认**本来就是齐的**(所有业务过程都是 `protectedProcedure`,中间件链 `logging → requireUser → audit → perm → dataScope`),只有 `file.ts` 的注释还写着「⚠️ 这里没有服务端登录校验」→ 改成事实描述,顺带修掉 `doc/文件管理.md` 里「另外 **11** 个路由」的旧计数(实际 13 个 router ⇒ 12) |
| **#4 个人资料页** | 新增 `/settings/profile`:账号信息(姓名 / 邮箱 + 是否已验证 / 角色 / 部门 / 创建时间)、改姓名、改密码(`changePassword` 带 `revokeOtherSessions`)、发验证邮件、换邮箱。配套 `src/lib/mailer.ts`(默认 **console 驱动**:链接打到终端,不挑服务商、不要 API key,换驱动只加一个分支)与新接口 `user.profile`(只读自己那一行:不挂菜单授权,但必须登录) |
| **#3 文件内联预览** | 文件详情里图片仍走 `<img>`;**PDF / 文本走社区包**(`react-pdf` 懒加载,不自己写渲染器 —— 用户明确要求)。注意 minio 桶要配 GET CORS:PDF/文本要 `fetch()` 预签名地址,`<img src>` 那条路不需要 |
| **#5 日志导出** | 审计日志页接入 `ExcelExportButton`,导出当前筛选结果 |
| **#1 Excel 四页** | 用户 / 角色 / 字典 / 参数四页接入导出 + 导入。`settings-*-excel.ts` 是各域表头**唯一真源**(导出列与导入列**可以不同**,如用户的「初始密码」只能手补 —— 密码是散列);导入语义按域定义(user **只建不改**、role / para 按名 upsert、dict 合并字典项);权限点复用各域的 `*:add`;`xlsx` 只在点按钮时动态 `import()`,不进首屏包 |
| **#6 容器化** | `Dockerfile` 四个目标 + `docker-compose.yml`(mysql + minio + app + `bootstrap` 初始化服务)+ `.devcontainer/`。关键坑:`.output` **不自包含**(bundle 按包名 import)⇒ 运行镜像必须 `pnpm install --prod`;`.npmrc` 里是宿主机绝对 store 路径,不能进构建上下文 |
| **#9 统一软删** | 10 张业务表补 `deleted_at`,读路径一律 `alive(表)`,11 处硬删改软删;带唯一业务键的表用 `tombstone()` **让位**(否则删掉「测试角色」后再也建不出同名角色),口径见 `doc/数据库与认证.md` 的同名小节。`sys_file` 不叠这一列(它已有 `status = 2` 的行级软删),关联表与运维表不加。测试收尾改成按 `__test__` 前缀**扫表收 id**:以前先软删再按业务键查,键已变墓碑 ⇒ 查不到就攒残留(本轮顺手清掉 12 行并修好 5 处收尾) |

基线:`pnpm typecheck` 0 · `npx biome check .` Checked 281 files / **0 error / 4 warning / 1 info**(与上一轮逐项相同)· `pnpm db:create` 幂等 · `pnpm build` 通过 · `LOG_SILENT=1 pnpm test` **191 / 191**(+5 是新增的 `tests/soft-delete.test.ts`)。行为验收:生产包 + 带 cookie 的 SSR 请求,16 个页面全 200(未登录 `/settings/users` 仍是 307、未知路径 404),跑完测试真库 `__test__` 残留 **0**、`sys_user` 38 / `sys_role` 13 / `sys_dept` 3700 与基线一致。

---

### 第八轮:总体代码审阅 —— 去重 / 死代码 / 谎报注释(2026-10)

判据与第六轮相同(同一个东西是否存在第二个实现;删除优先于新增),区别是范围扩到**全仓** ——
`src` + `scripts` + `tests` 共 278 个 `.ts` / `.tsx` / 44,763 行(本轮又添 2 个件,现 280 个),先派五片只读审计
(settings / lib+db / 服务端 / layout+ui+shared+workbench / tests+scripts),再补一遍机器扫
(函数体归一化哈希找逐字重复、零引用导出、死文件),最后逐条核对。审计里有几条被自己的实测**证伪**,
按「像冗余但不该合并」如实退回,见下方「刻意不做」。

| 改了什么 | 说明 |
| --- | --- |
| **服务端去重** | `namesById()`(id → 名字)单源到 `lib/data-scope.ts`,两个 router 各删一份;新增 `policyContextOut()` —— 插件试算与规则预览两个弹窗的「角色 / 祖先链 / 我的部门及以下」口径从此只有一处;新增 `lib/reorder.ts` 的 `reorderSiblings()`(菜单树 / 部门树的同级排序守卫,26 行 × 2 → 一次调用,文案按 `noun` / `parentNoun` 传入);`user.ts` 抽出 `assertIdsExist()`(两段 18 行 → 4 行);`demo-grid.ts` 抽出 `gridValues()`(create / update 的 7 字段映射,过去改一头忘一头);`data-plugin.ts` 删私有 `parseOutputValues` 改用 `parseItems`;`selectRows()` 与 `isIdent()` 单源(删掉 `lib/data-scope.ts` 里那份重复的 `isSafeIdent`);`withAncestorIds()` 复用 `lib/tree.ts` 的 `collectAncestorIds()`(环保护只写一处);`lib/excel.ts` 的多值单元格改用 `joinMultiValue()` |
| **修一个真 bug** | `src/integrations/trpc/routers/file.ts` 的 `list` 用 `or(...conditions)` 拼 `where` ⇒ 同时给「状态筛选 + 关键字搜索」时两个条件是**或**,状态筛选形同失效、任意状态的行都会被关键字捞出来。全仓只此一处(`log.list` 同位置是正确的 `and(...)`)→ 改 `and(...conditions)`。现网没触发(文件页的关键字是客户端 `matchKeyword` 过滤,没把两者一起传给接口),但接口契约本来就是错的。**数据范围规则详情**(原用两态 `EnabledBadge`)把 `status=1` 的「上线」错标成「启用」、`status=2` 的「启用」错标成「停用」—— 三态不是两态,共用徽章会把「差一步就生效」的状态标得最危险;改用与表格列同一份 `policyStatusMeta()` 的内联 `StatusBadge` |
| **谎报注释 / 权限漏洞** | ⌘K 命令面板原读**静态** `NAV_NODES`,绕过了菜单授权(`menu.mine` 已按角色过滤)⇒ 改读 `useNavNodes()`,与侧边栏同源;插件页 docblock 还写着「新增只对超管显示」「写接口额外要求超管」(权限早已放开,`requireAdminUser()` 是本轮删掉的死件);`workbench-page.tsx` 的「由 `NAV_NODES` 派生」改成事实;`multi-value.ts` 补上两条**有意**例外(标签输入不切顿号、批量开账号额外按空白切);数据范围预览弹窗里的 `isSafeIdent` 文案改 `isIdent`;`topbar` / `module-overview` / `command-palette` 里残留的「`NAV_NODES`」字样也一并改成事实(实际读的都是 `useNavNodes()`) |
| **组件 / 界面收敛** | 12 处手写时间列 → `table-kit` 的 `timeColumn`,并把 `TimeCell` 的空值回退统一成 `—`(推翻第六轮「另 12 处保留原样」);9 处「启用 / 停用」徽章 → `EnabledBadge`;详情 / 表单的 9 处提交态补 `isPending`;5 处多余的 `confirmText` 删掉(确认框已有默认文案);字典页新建改 `setValues(emptyDictForm())`;菜单页抽出 `createMenu(parentId)`;角色导出的「状态」列原来带 `?? 1` 兜底(空值导成「启用」,可徽章那侧显示「停用」)⇒ 与 `EnabledBadge` 统一成同一判据;两条 settings 路由的 loader 补 `para.byKey({ key: PAGE_SIZE_KEY })` 预取(与同类页同形) |
| **死代码** | `requireAdminUser()`(零调用方)、`use-file-upload` 的 `invalidate`、`use-para-prefs` 的 `parsePageColumns` + `PageColumnsMap`(薄封装)、`lib/format.ts` 的 `normalizeValue()`、`auth-lockout.ts` 的 `LOCKOUT_CONFIG` 与文件尾多余的 `export { sql }`、`lib/data-scope.ts` 的 `isSafeIdent` |
| **文档数字** | `doc/数据库与认证.md` 系统表 20 → **21**、认证五张 → **六张**(补 `sys_account_lockout` / `sys_rate_limit`);`doc/达梦支持.md` 的 `db:dm:create-ba` 15 → **17** 张、`update_time` 出现处数 26 → **27**(多的一处是新的 `lib/reorder.ts`)、用例数改为实测值(`role` 13 / `icons` 5 / `user-crud` 15);同源漂移:**`AGENTS.md`** `pnpm db:dm:create-ba` 注释 15 → **17** 张;**`scripts/create-system-tables.ts`** docblock 19 张 → **21** 张 + 「认证四张」→「**认证六张**」;**`doc/达梦支持.md`** MySQL 一行「含认证四表」→「含认证**六**表」 |
| **测试脚手架** | `tests/helpers.ts` 新增 `purgeCasbinByMenuIds()` / `purgeCasbinByUserIds()`(casbin / role 两个套件的收尾各 19 行 → 2 行);`tests/data-scope.test.ts` 的试用用例复用 `busiestTown()`(连 `params` 一起回,删掉重复的 6 行算法) |
| **刻意不做** | **不抽**「同级 `max(sort) + 1`」为 `nextSort` —— 5 处里 4 处是一行 `reduce` 表达式、1 处是滚动计数器、1 处带 `input.sort ??`,抽出来是零收益的薄封装;`sortable-tree.tsx` 剩下两处手写 `<button>` **不换** `ActionIconButton`(一处在折叠箭头的 `size-4` 占位 span 内、一处在搜索框里绝对定位,套上会丢定位与尺寸上下文);`hover:bg-hover` 与 `hover:bg-black/10` 不是像素等价,未动 |

体量:**65 files, +563 / −761**(净减约 **198 行**),新增 2 个件(`lib/reorder.ts` 51 行、`settings-data-plugins-preview-dialog.tsx` 115 行)—— 抽出的共用件比删掉的重复体量更大,换的是「口径只有一处」。

基线:`pnpm typecheck` 0 · `npx biome check .` Checked 283 files / **0 error / 4 warning / 1 info**(与上一轮逐项相同)· `pnpm build` 通过 · `LOG_SILENT=1 pnpm test` **191 / 191**。

---

### 第九轮:总体代码审阅 —— 反对过度抽取、删薄封装、修测试 cleanup 漏洞(2026-10)

第八轮找的是「重复」(同一东西有没有第二份),这一轮找的是它的反面:「**过度抽取 / 设计为设计 / 单调用方件 / 命名不挣钱**」。用户的原话是「从公共类抽取不要过度,设计模式简单,避免为了设计而设计,一切以实用为主」—— 也就是说,**不抽** 和 **抽** 都要有理由,且理由得是「实用」不是「统一」。

**审计方法**:逐个排查上一轮没动过的小件(`sidebar-mode` / `menu-detail-path` / `auth-debug` / `lib/api/` / `use-dict` / `use-stable-keys` / `use-perms` / `gridValues` / `reorderSiblings` / `data-scope-meta`)—— 全部留,因为每个都有真实的多调用方或显著简化;再扫 `init.ts` 与四个测试文件,找那些「3 行封装 / 1 处调用 / 复杂 docblock 掩盖了 1 行实质」的件。

| 改了什么 | 说明 |
| --- | --- |
| **删两处薄封装(`init.ts`)** | `slowMs()`(3 行,1 处调用,内联是 `Number(process.env.LOG_SLOW_MS ?? 1500)`);`isTRPCError()`(6 行,1 处调用,文档理由是「避免 TRPCError 类型循环 import」—— 但 `TRPCError` 已在文件顶部 import,理由失效,改 `!(error instanceof TRPCError)` 即可) |
| **测试 cleanup 抽 3 个助手(`tests/helpers.ts`)** | `purgeRole(id)`(清 `p` 行 v0 + `g` 行 v1 + `sys_role` 行,4 处测试 `after` 重复同一段)、`purgeRoles(ids)`(批量版,`inArray` 比循环少 4× round-trip)、`getSystemAdminRoleRow()`(3 条 admin-guard 用例的「库里找系统管理员」内联查找 —— 找不到时直接抛,前置条件断言自动覆盖) |
| **修测试 cleanup 漏洞** | `tests/role.test.ts` 的 `after()` 之前**只删 `sysRole` 行、不删指向它的 `p` 行**—— `setRoleMenus` 写过 7 条 `p` 行就漏 7 条悬挂行,下次跑会撞 `uk_sys_role_name` 或让后续断言变飘。补 `purgeRoles(roleIds)` |
| **测试样板收敛** | `user-crud.test.ts` 的 `before()` 4 行内联删除 → 1 行 `for ... await purgeRole(id)`;`after()` 5 行 `createdIds` cleanup → 4 行 + 1 行 `purgeCasbinByUserIds(createdIds)`(取代内联 `g` 行删除);`after()` 4 行 `createdRoleIds` cleanup → 1 行 `for ... await purgeRole(id)`;三条 admin-guard 用例的 admin-role lookup(3 处字字相同的内联 `find((r) => r.name === "系统管理员")`)→ `getSystemAdminRoleRow()` 一行;`impersonate.test.ts` 的 3 行 `cleanupStep("删除 role_menu/继承/role")` → 单行 `cleanupStep("清理测试角色", () => purgeRoles(createdRoleIds))`,内联 `g` 行删除 → `purgeCasbinByUserIds` |
| **变量名** | `user-crud.test.ts:232-234` 的 `soft` → `afterRow`(原名误导,只是个 user row,不是 boolean 软删) |

**审查后认定不抽的(11 类)**:

| 件 | 不抽的理由 |
| --- | --- |
| `src/lib/sidebar-mode.ts` | 真单 config key + 解析函数,文档明确 |
| `src/lib/menu-detail-path.ts` | 2 调用方(nav-config + menu router)+ 单源前缀常量 |
| `src/lib/auth-debug.ts` | BA plugin + impersonate 端点,完整服务 |
| `src/lib/api/`(单文件目录) | 风格选择(为以后扩展预留命名空间),与 `lib/` 扁平命名解耦 |
| `src/hooks/use-dict.ts` | 0 直接 `src/` 调用方,但 `docs/` + `rbac.ts` 注释标为「字典前端统一入口」 |
| `src/hooks/use-stable-keys.ts` / `use-perms.ts` | 多调用方,实质 |
| `src/integrations/trpc/routers/demo-grid.ts` `gridValues` | 1 抽件 2 调用方(create / update 共用 7 字段映射) |
| `src/lib/reorder.ts` `reorderSiblings` | 1 抽件 2 调用方(menu / department),`noun` / `parentNoun` 两个文案参数没膨胀到第三个轴 |
| `src/lib/data-scope-meta.ts` | types + cached resource loader,实质 |
| `data-scope.test.ts` `busiestTown` / `ctxWithDepts` | 第八轮已抽,用例复用,2 处 inline 的不同查询(town + owner 全集)不强求合并 |
| 第八轮的 `nextSort` / `sortable-tree` 按钮 / `hover:bg-hover` | 同第八轮结论(`importLedger` 已在第十五轮因零调用方删掉) |

体量:**6 files, +86 / −79**(净增 7 行,但测试 cleanup 口径收紧了 5 处,职责更明确),新增 3 个 helper(28 行,集中在 `tests/helpers.ts`)。

基线:`pnpm typecheck` 0 · `pnpm check` 283 files / **0 error / 4 warning / 1 info**(与第八轮逐项相同)· `pnpm build` 通过 · `LOG_SILENT=1 pnpm test` **191 / 191 / 5 suites**。

### 第十轮:代码一致性 / 命名 / 文件角色(2026-10)

第九轮的口径是「反对过度抽取」;这一轮是它的姊妹篇:用户的原话是「**再次精简一下代码,强调代码的一致性,包括文件命名,变量命名,函数命名,HTTP 等**」—— 也就是说,**抽与不抽**有尺度,**怎么起名**也要有尺度。本轮 4 处改动 + 1 处文档补全,**刻意不改**的 3 处都写进 `doc/界面约定.md` 的新章节里。

| 类别 | 项 | 落地 |
| --- | --- | --- |
| 文件命名 | `DataScopeForm`(唯一 `Settings` 前缀漏掉) | `settings-data-scope-form.tsx` 内 `export function DataScopeForm → SettingsDataScopeForm`;`page` 的 import + 调用点同步 |
| 文件角色 | 5 个域里 `<域>-excel.ts` 是真源,**唯独 `logs` 把 `LOG_EXCEL_COLUMNS` / `logExcelRows` / `LogExcelKey` 塞进了 `*-table.tsx`** | 新文件 `settings-logs-excel.ts` 持有这 63 行;`table` 只剩展示职责 + 把 `statusText` `export`(列表徽章与导出的单元格共用一份 `1 ? 成功 : 失败`);`page` 的 import 拆成两个 |
| 变量名 | 6 个列表页的「待删行」叫 `pendingDelete`,**唯独** `dictionary-page` 用了 `deleteTarget` | sed 重命名为 `pendingDelete` + `setPendingDelete` |
| 文档 | 新章节「命名 / 类型约定」(`doc/界面约定.md`) | 函数前缀语义表(get/load/list/find/read)、`Row` / `TreeNode` / `FormValues` / `FormPayload` 后缀边界、状态变量 `editing` / `viewing` / `pendingDelete` 固定叫法、`<域>-excel.ts` 真源化的"别再偷懒"提醒 |

#### 决定不改的 2 处(写进 `doc/界面约定.md` 不再追)

| 项 | 现状 | 为什么不动 |
| --- | --- | --- |
| `FormValues`(4) vs `FormPayload`(7) | `FormValues` 是**树形编辑页**的可控状态形状(`useState<MenuFormValues>`);`FormPayload` 是**普通表单**的 `onSubmit(payload)` 入参 | 两类**确实不是同一种东西**,只是名字都叫 "form";**改名反会让"页面状态"和"接口入参"两套边界糊在一起**。文档里把 4 / 7 各列出 |
| `tag.move` vs `menu/department.reorder` | `tag.move` = 改父节点(无 sort);`menu.reorder` / `department.reorder` = 同级内改 sort 序 | **根本不是同一操作**,只是都用动词命名 |

#### 第十一轮补刀 —— `*.delete` 全部改成 `*.remove`

第十轮决定"不改"—— 用户回看后点名了。`delete` 与底层 SQL `DELETE` 撞名,容易让人误以为是"硬删";
`rename` 强调"业务上拿掉",软删 / 级联移出子表 / 自定义删除逻辑都装得下。

**改名清单**(15 files / +23 / −23,只动了 procedure 名 / 调用点 / 文档,**没改权限码**,因为它们本来就是 `sys:X:remove`):

| router 端 | 调用端 |
| --- | --- |
| `routers/dict.ts:155` `delete → remove` | `settings-dictionary-page.tsx:79`、`tests/dict.test.ts(×4)`、`tests/auth.test.ts:92` |
| `routers/menu.ts:235` `delete → remove` | `settings-menus-page.tsx:110`、`tests/casbin.test.ts:281` |
| `routers/para.ts:340` `delete → remove` | `settings-parameters-page.tsx:77`、`tests/parameters.test.ts(×3)` |
| `routers/tag.ts:167` `delete → remove` | `settings-tags-page.tsx:72`、`tests/tag.test.ts(×3)` |

`src/lib/rbac.ts:203-219` 的 4 条 procedure → perm 映射键名同步改为 `.remove`(值不变);`src/lib/soft-delete.ts:31` 的 docblock
里把 "dict.delete" 一并改 "dict.remove"。

体量:**4 files changed, +120 / −127**(净 −7 行);新增 `settings-logs-excel.ts`(58 行);`doc/界面约定.md` 加 1 个 `## 命名 / 类型约定` 章节(45 行)。

第十一轮补刀:**15 files changed, +23 / −23**(无新增件,纯改名)。

基线:`pnpm typecheck` 0 · `pnpm check` 284 files / **0 error / 4 warning / 1 info**(与第八轮逐项相同)· `pnpm build` 通过 · `LOG_SILENT=1 pnpm test` **191 / 191 / 5 suites**。

### 第十二轮:再扫一轮命名 / 文件角色 outlier(2026-10)

第十一轮把「动词统一」扫完后,本轮只剩 3 个**个例级别**的命名 / 角色 outlier;它们没有破坏什么,但看一眼就能看出"为什么这里例外"—— 不是不可以,**但本模板要做的是给别人看的范本**,范本里最忌讳「我知道为啥例外」这种解释成本。

| 类别 | outlier | 改法 |
| --- | --- | --- |
| 文件角色 | **用户管理**是 12 个列表页里**唯一**没有 `*-detail.tsx` 的(详情直接内联在 `settings-users-page.tsx` 的 60 行 `DetailDialog` 里) | 新件 `settings-users-detail.tsx`(71 行),只读,字段与 `UserRow` 的列一一对应;`page` 里换成 `<SettingsUsersDetail row={viewing} ...>`,砍掉 `Avatar` / `Badge` / `BadgeList` / `DetailRow` / `DetailDialog` 五组 import |
| 文件角色 | **字典**是 12 个域里**唯一**有 `settings-dictionary-types.ts` 的(`Row` 在 `*-table.tsx` 是约定,`FormValues` 在 `*-form.tsx` 是约定) | `SettingsDictRow` 移进 `settings-dictionary-table.tsx` 顶部;`DictFormValues` / `emptyDictForm` / `dictToForm` 移进 `settings-dictionary-form.tsx`(form 自有可控状态的形状与重置工具);**整个 `settings-dictionary-types.ts` 文件删除**;4 个 import 点(excel / page / form / detail)同步改 |
| 文件命名 | `settings-tags-form-dialog.tsx` —— 其他 11 个域的表单都叫 `settings-X-form.tsx`,只有 tags 多了个 `-dialog` 后缀 | `git mv` 重命名 + `SettingsTagsFormDialog` → `SettingsTagsForm`(函数名也一并对齐) |

体量:**10 files changed, +93 / −132**(净 −39 行);新增 `settings-users-detail.tsx`(71 行) + 删除 `settings-dictionary-types.ts`(38 行) + 重命名 `settings-tags-form-dialog.tsx` → `settings-tags-form.tsx`。

基线:`pnpm typecheck` 0 · `pnpm check` 284 files / **0 error / 4 warning / 1 info**(与第八轮逐项相同)· `pnpm build` 通过 · `LOG_SILENT=1 pnpm test` **191 / 191 / 5 suites**。

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
- `doc/容器化.md` —— Dockerfile 四个目标、compose 变量表、Dev Container,以及「`.output` 不自包含」这类容器专坑
- `doc/测试数据/README.md` —— 六个种子脚本与演示账号
- `AGENTS.md` —— 面向 AI 编码代理的**规矩摘要 + 文档索引**(精简版,约 7KB)
- `DESIGN.md` —— 视觉规范(品牌 7 色 + 点缀 6 色相 + 间距 / 圆角 / 阴影 / 动效原语清单)
- `doc/archive/` —— 原业务系统的设计文档(表结构设计、需求清单、测试方案…),**仅供追溯,与新项目无关**

外部资料:

- [TanStack Start](https://tanstack.com/start) · [TanStack Router](https://tanstack.com/router) · [TanStack Table v9](https://tanstack.com/table)
- [tRPC](https://trpc.io/) · [Drizzle ORM](https://orm.drizzle.team/) · [Better Auth](https://www.better-auth.com)
- [Tailwind CSS v4](https://tailwindcss.com/) · [Biome](https://biomejs.dev/) · [Nitro 部署](https://v3.nitro.build/deploy)
