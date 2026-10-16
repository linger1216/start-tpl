# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **主要用户:企业的普通员工 / 管理员**,在企业内网的**桌面浏览器**上完成日常的审批、查台账、看通知等管理工作(回答确认:"企业内部日常办公")。
- **派生方(开发者):** 从本模板派生新项目、然后在其上填业务代码的人。模板自带的「系统设置 + 任务闭环」是**可参照、可裁剪的自带样本**(`features.json` / `prune-features.mjs` 记录了裁剪面),不是最终产品(回答确认:"内部管理后台模板")。

## Product Purpose

一个**面向企业内部的管理后台起步模板**——登录 → RBAC 菜单/按钮 → 系统设置(用户/角色/部门/菜单/字典/参数/标签/文件/审计日志/数据权限)十二页 + 任务闭环(派任务 → 处置 → 审批/征询 → 关单)样本模块。它的价值在于"派生后立刻有一个能跑、有权限模型、有审计与通知的健全后台",而非某个具体业务的最终形态。

## Positioning

TanStack Start 全栈 + tRPC-only 后端 + MySQL/**达梦**双库的可派生后台模板:同一个工程不改业务代码即可在两种国产库间切换,权限、审计、软删、通知、两阶段文件上传等后台基建开箱即用。

## Operating Context

- 内网 / Docker 部署;数据库和 MinIO 连接都在 `.env.local` (`DATABASE_URL` 前缀自动选 mysql2 / dmdb)。
- 六个幂等种子(`menus / dicts / paras / tags / rbac / demo`)建出可登录的起始数据;测试也需要一个指向真库的 `.env.local`。
- 开发固定 3000 端口(`pnpm dev`);自检四件套 `typecheck / check / build / test` 是 AGENTS 定下的验收口径。

## Capabilities and Constraints

- **tRPC-only**:后端不开 REST 例外只有三个(auth / SSE / captcha);前端严禁 fetch/axios/自写 queryFn —— 未来一切 UI 都按这条路接数据。
- **双库**:MySQL 与达梦(`dm://`)共用同一套 drizzle schema;业务代码零方言分支。
- **RBAC 两级**:菜单可见 → 页面级拦截(没权限走 404 通道)→ 接口权限码;按钮级权限点 `sys:*` 驱动前端按钮显隐(`useHasPerm`),**不写死角色判断**。
- **站内通知**:`sys_notice` + SSE 铃铛;侧边栏「我的任务」红点 = 未读任务通知,读掉即消。
- 中文 UI 文案是确认承诺(回答勾选);底层技术术语(computed 列名 / API 路径等)保留英文。
- 未确立的开放事实:**无特殊的可访问性指标承诺**(未确认 WCAG 等级);派生方的真实业务场景由派生方自行决定,模板不预设。

## Brand Commitments

- 产品名 / 副标题取自 `package.json` 的 `app` 字段(当前:管理后台 / TanStack Start 模板);派生时由 new-project.sh 重写。
- 视觉世界已有成文规范:**DESIGN.md**(「公文·印鉴」—— 暖纸白/墨/印泥红的低饱和文件世界,签名动作 = 审批状态盖章;token 单一真源在 `src/styles.css`)—— init 只记录、不新增视觉决定。

## Evidence on Hand

- `doc/测试数据/综合网格履职情况列表.xlsx` —— 左侧真实业务表(网格长履职)的演示数据源,种子脚本用它与 `demo_grid` 对账。
- 22 页文档(`doc/*.md`)+ `AGENTS.md` 的硬规矩——它们是产品事实的可靠来源;`README.md` 的历轮记录是 changelog 不是现状。

## Product Principles

1. **派生优先**:每一步设计都要假设"这会被下一个开发者抄走再改"——约定比智能重要,样板比聪明重要。
2. **同形不双写**:同类页面必须同形;删掉后调用点会重复结构的才许抽共用件。
3. **权限即数据**:按钮可见性读服务端派生的权限,不按角色 hardcode;前端任何"看起来像权限"的东西都必须有对应权限点或派生结果。
4. **生产可信**:审计、软删、锁与事务、上传两阶段、通知 SSE —— 这些后台基建不是演示,是派生项目会拿去真用的能力。
