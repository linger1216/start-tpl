# 任务闭环

任务闭环是模板驱动的通用协作能力，不绑定具体业务。任务流程快照、审批和征询、独立填报、自由回复分别承担不同职责；通知与调度是独立模块。填报和批次设计见 [task-forms.md](task-forms.md)，通知与 Worker 见 [通知中心.md](通知中心.md)。

## 代码与存储

- `src/integrations/trpc/routers/task-close.ts`：任务、成员、动作、填报和批次的 tRPC 接口与事务边界。
- `src/lib/task-close-spec.ts` / `task-close-log.ts`：流程状态与活动日志的客户端安全词表。
- `src/lib/task-report-spec.ts` / `task-report-summary.ts` / `task-report-excel.ts`：填报校验、确定性汇总和受限 Excel 处理。
- `src/components/modules/task-close/`：任务列表、详情、流程模板、填报与批次界面。
- `src/db/data-base-schema.ts`、`scripts/create-system-tables.ts`、`scripts/create-better-auth-tables-dm.ts`：模型及 MySQL、达梦初始化；`scripts/sync-table-meta.ts` 是表列注释唯一真源。

| 表 | 职责 |
| --- | --- |
| `tc_workflow` | 可编辑的任务流程模板，`payload` 定义状态与转移 |
| `tc_task` | 任务、创建人、说明内容及创建时固定的流程快照 |
| `tc_content_revision` | 任务说明的修订历史（每次内容变更留一版，可回看） |
| `tc_member` | 参与者与执行人关系；一个任务至多一个有效执行人 |
| `tc_action` | 审批和征询的当前处理节点，通过 `serial_no`、父节点和顺序组织 |
| `tc_comment` | 自由文字、附件与结构化 @，不作为正式填报 |
| `tc_log` | 与业务同事务、只增不改的活动历史 |
| `tc_report_template` / `tc_report_template_version` | 填报模板及不可变发布版本 |
| `tc_task_report` / `tc_report_submission` | 任务草稿、有效提交指针及不可变提交快照 |
| `tc_report_batch` / `tc_report_batch_task` | 批次及其独立任务关联，一个任务最多属于一个批次 |

## 任务与权限

`tc_member` 是执行人的唯一权威来源；新增或转交时锁定任务行，防止并发产生多个执行人。转交会在同一事务中变更成员关系并记录历史。创建任务可以暂不分配执行人；分配后执行人与参与者各有不同权限。创建人存于 `tc_task.creator_id`，不重复写成员关系。

成员的写权限分两档：`memberAdd` 只要**任务相关方**（创建者 / 管理员 / 当前成员），陌生人不能把人拉进任务、更不能把自己加成执行人；`memberRemove` 仍是创建者或管理员。`taskGet.permissions.canAddMember` 与之同一判据，前端据此决定要不要显示「加成员」按钮。

`taskUpdate` 的 `payload` 字段与 `priority` 同口径：**不传 = 不动**、传 `null` = 显式清空、传对象 = 整块替换。不传 payload 时不会写内容修订。`payload.attachments` 里的文件 id 必须真存在且 `sys_file.status = 1`（已确认），创建与编辑路径共用同一道闸口；`attachmentUrl` 也只签已确认的文件（`status = 0` 是「已签发 PUT、对象还没上来」的中间态）。

任务创建时复制流程模板的状态与转移定义，后续修改模板不改变已创建任务。`status` 永远表示模板定义的任务业务状态；审批的处理状态在 `tc_action.status`，不会把框架临时状态写入任务。执行状态动作时，服务端依据状态、模板边、角色、成员关系和动作锁重新校验；`taskGet.permissions` 同时提供界面所需的可用动作。接口统一走 tRPC，并在 `src/lib/rbac.ts` 显式分类。

模板可为状态转移配置 `report_submitted` 守卫，要求任务存在当前有效的正式填报提交。守卫在可用动作计算、发起转移和审批通过时分别检查；管理员也不能跳过模板边或守卫。状态可标记为结束状态，进入该状态时事务内终止未完成动作及待发送通知；重新打开必须由模板显式定义转移边。

## 审批与征询

`tc_action` 是处理状态，不是历史流水；`tc_log` 才是不可变业务历史。根节点的 `serial_no` 是自身 ID；多节点共用根 ID。串行流程只有当前节点为 `active`，其他节点为 `queued`；完成后在同一事务中激活下一人并创建通知。并行流程所有节点同时激活。

征询默认不锁任务状态，处理人回复意见时写入自由评论。审批锁定状态转移，但不改变任务当前状态；本期并行审批采用**全员通过**，全部通过后沿模板边推进，任一驳回则终止其他未完成节点，任务保持原状态。撤回审批会取消整条未完成流程，删除任务时取消其未完成动作和待投递通知。所有状态判定和动作结算按任务行锁串行执行。

站内通知与业务写入同一事务；SMS / Email 由独立 Worker 投递。查看时间与通知已读分开，未查看提醒只针对真实激活的节点。手动催办、投递记录及失败重试详见通知中心文档。

## 日志规则

每次用户业务操作与 `tc_log` 在同一事务内提交或回滚；`sys_log` 是独立的全站审计台账。`from_status` / `to_status` 只记录该次操作真实发生的任务状态变化，没有变化时均为 NULL。发起审批的目标状态及来源状态记录在 `detail`，不冒充任务状态变化。草稿自动保存不逐次写活动日志；提交和退回写日志与通知。

## 验证与启动

```bash
pnpm db:create             # MySQL 建表、索引与注释
pnpm db:dm:create-ba       # 达梦建表；需真实达梦实例
pnpm db:seed:task-close    # 默认流程模板
pnpm dev                   # Web 服务
pnpm worker                # 独立调度和通知投递
pnpm typecheck
pnpm check                 # 会自动写入格式修复
pnpm test                  # 使用 .env.local 所配置的测试数据库
pnpm build
```

MySQL 与达梦 DDL 均须同步维护；未连接真实达梦实例时不能以 MySQL 测试代替达梦验证。运行中的任务数据、模板和通知记录不得通过重新建表覆盖。
