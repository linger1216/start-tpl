# 代码审查发现

日期：2026-11-06。范围：工作区相对 HEAD 的 40 个原有改动文件（含未跟踪文件），重点追踪认证、访客、初始化与通知调用链；不是全仓历史代码审计。下列结论来自代码复核与局部复现，不是 OCR 模型输出。

## F1 · P1：访客白名单允许读取任意系统参数

位置：`src/lib/share-access.ts:41`、`src/integrations/trpc/init.ts:184`；实际返回值见 `src/integrations/trpc/routers/para.ts:94`。

任意有效访客令牌都能调用 `para.byKey({key: ...})`。该接口直接按 key 读取全局 `sys_para`，没有用户隔离或访客 key 限制；因此可以读取 `login.captcha_enabled`、审计配置及已知名称的自定义参数，与文档“布局偏好读自己的、结果恒为空”不符。未读取实际数据库，未断言其中存有密钥。

修复：访客只允许必要的公开 UI 参数 key；同时盘点 `dict.byCode` 所需 code，避免把整个通用取值器作为外壳权限。用任意有效令牌验证公开 key 可读、其他已存在 key 返回 FORBIDDEN。

## F2 · P1：达梦派生流程继承原 schema 并进入错误初始化分支

位置：`new-project.sh:615`、`scripts/init-db.mjs:30`、`new-project.sh:665`。

模板 `.env.local` 使用 `dm://...?...schema=原模式` 时，派生脚本只替换 mysql/mysql2 库名，达梦连接原样继承。init-db 对非 MySQL 返回退出码 0，外层却据此设置 DB_INIT_OK=1，继续运行 MySQL 专用 db:create（含 information_schema、database() 和 MySQL DDL），而不是达梦建表命令。新工程未隔离原模式，自动初始化也无法按预期完成。

修复：先识别驱动；MySQL 和达梦明确分流。达梦必须指定独立 schema 或明确跳过自动初始化；不能把“跳过”当“建库成功”。用假的命令执行器记录调用验证，禁止在原业务库上复现。

## F3 · P2：路径长度误用数量上限

位置：`src/integrations/trpc/routers/share-token.ts:21`。

`z.string().max(SHARE_PATHS_MAX)` 将字符串长度限制成 10；客户端 `parseAllowedPaths` 允许 200 字符。`/task-close`（11 字符）前端校验通过，create/update 后端拒绝。现有 CRUD 测试只使用不超过 10 字符的路径，未覆盖此边界。

修复：字符串使用 SHARE_PATH_MAX，数组继续使用 SHARE_PATHS_MAX；共享规范。覆盖 10/11/200/201 字符、10/11 条路径和创建/更新。

## F4 · P2：页面前缀与数据授权精确匹配不一致

位置：`src/integrations/trpc/init.ts:183`、`:189`；对应 `src/lib/share-access.ts` 的 guestMayView。

允许路径为 `/demo` 时，页面守卫允许 `/demo/grid`，但数据中间件比较 page:demo:view 与 page:demo_grid:view，拒绝 demoGrid.list，页面能进入却无数据。局部复现已确认前缀匹配为 true、页面码匹配为 false。具体详情路径与其共享接口也需要核对；task-close 的多个读接口处于 UNMAPPED_QUERIES，并不会因给令牌添加该页面而自动可用。

修复：以真实页面路径和可分享的 procedure 映射统一授权语义，保留 `/settings` 禁入；不要把所有未分类 query 放开。覆盖父路径、精确路径、子路径、兄弟路径、管理区以及页面实际依赖接口。

## F5 · P2：SSE 任务查询刷新分支永远不执行

位置：`src/lib/use-notice-sse.ts:25`。

使用本项目安装的 createTRPCOptionsProxy 实测：`"taskClose" in trpc` 为 false，但 `trpc.taskClose.pathFilter()` 正常产生查询键。因此新增判断使 notice.new 只刷新通知列表，任务列表/红点不再自动更新。

修复：通过功能裁剪时移除代码或显式功能配置表达模块存在性，不用 in 检测 tRPC 动态代理。验证保留 task-close 时事件会使其查询失效，裁掉时仍能通过类型检查与构建。

## F6 · P2：新增访客权限码违反现有菜单校验

位置：`scripts/seed-rbac.ts:292`；同码还在 `src/lib/rbac.ts:266` 起的登记中。

新增 sys:shareToken:add/edit/remove 含大写 T，PERM_FORMAT 仅允许小写，实测校验为 false。seed 直接入库可成功，但通过菜单管理编辑这些按钮（即使只改名称、保留权限码）会在 menu 的输入校验被拒绝；手工录入相同码也失败。不是断言 Casbin 本身无法比较这些字符串。

修复：统一改成合法小写资源段，同时迁移已存在菜单及直接按旧权限码保存的策略；保持角色授权关联。补 seed 后通过真实菜单接口编辑的用例。已有 tcWorkflow 同类历史问题另行盘点，不混为本次新增缺陷。

## F7 · P2：建库失败仍报告全量完成并成功退出

位置：`new-project.sh:665`、`:696`。

init-db 无法连接 MySQL/无建库权限返回非零，外层只打印警告后继续，最终仍打印“数据库初始化已全量完成”“现在可以直接启动”。调用者不能靠成功提示或退出状态判断数据库是否就绪。

修复：区分工程复制成功、依赖就绪、建库成功、建表成功、种子完成；失败返回非零或明确的“仅生成文件”结果，给出完整续跑命令。使用 stub 模拟失败，断言不执行后续 seed 且不输出全量完成。

## 不作为本轮已确认缺陷的边界

- 访客绕过行级数据范围是当前文档明确选择，不能直接当实现错误；发布前应明确“共享页面即共享该页面全部数据”的产品含义。
- 令牌缓存为进程内 30 秒：多实例下停用不保证立即生效；需要多实例测试后确定撤销 SLA。
- 本轮未进行浏览器首跳 cookie/重定向、真实数据库、MySQL/达梦建表或多实例实测。

## OCR 使用记录

- 本地入口：`/Users/lid/.local/share/fnm/node-versions/v26.13.0/installation/bin/ocr`。
- `ocr review` 选中 25 个代码文件；默认跳过文档与测试。新增三个审查文档后总数为 43，选中代码仍为 25。
- 第一次自动审查因沙箱 DNS 失败；获准网络重试后，已配置 minimax-cn / MiniMax-M3 返回 429，Token Plan 用量耗尽，未取得有效模型结论。
- 已成功使用 `ocr delegate preview --format json` 和 `ocr delegate rule ... --format json`，按本地规则由当前代理复核；没有改模型配置或购买额度。
- 工具证据保存在 `doc/review-2026-11-06/`，其中自动报告的零 comments 不代表审查通过。
