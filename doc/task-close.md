# task-close · 任务闭环

甲发任务给乙 → 处置 → 审批 → 关闭归档。两类业务(任务发放 / 主动检查)共用同一套内核,只换模板。

## 六张表

落 `eg` 库,前缀 `tc_*`。DDL 在 `scripts/create-system-tables.ts` 末尾追加。
列注释唯一真源是 `scripts/sync-table-meta.ts` 的 `COLUMN_COMMENTS`,**DDL 不写列 COMMENT**(两边都写会漂移)。

| 表 | 形状要点 |
|---|---|
| `tc_workflow` | `payload` JSON NOT NULL;`id` + 时间 + `deleted_at` |
| `tc_task` | `name`(标题)+ `status` + `creator_id` + `due_at` + `payload` + `workflow`(快照)+ `deleted_at` + 时间 |
| `tc_action` | `task_id` + `serial_no` + `parent_action_id` + `is_locking` + `from/to_status` + `sequence` + `created_id`/`handle_id` + `status` + 时间 |
| `tc_member` | `task_id` + `user_id` + `role`(participant/executor)+ `is_primary` + 时间;**creator 不进表**(已在 `tc_task.creator_id`) |
| `tc_comment` | `task_id` + `author_id` + `content`(text)+ `attachments`(JSON 数组,每项 `sys_file.id`)+ `deleted_at` + 时间;全员可评论,附件复用 `sys_file` 不新建附件表 |
| `tc_log` | 活动日志:`task_id` + `event` + `from/to_status` + `target_id` + `actor_id`/`actor_name` + `detail` + **`created_at datetime(3)`**;**没有 `updated_at` / `deleted_at`**(只增不改,见「活动日志」) |

### 时间列约定

所有表(本仓库全部 `eg` 库表)时间列统一 `_at` 后缀:`created_at` / `updated_at` / `deleted_at`。**不用 `_time`**。MySQL `DEFAULT CURRENT_TIMESTAMP` + drizzle `$defaultFn` 双保险。

### 现状差异(`eg` 库)

- `tc_workflow.updated_at` / `tc_task.updated_at` 是 `datetime(3)`(毫秒精度),`tc_action.updated_at` 是 `datetime`(秒精度)
- `tc_task.idx_task_status_created` 是 `(status)` 单列索引;`idx_task_creator_status` 是 `(creator_id, status)`

## 活动日志(`tc_log`)

**只增不改**的历史流水:谁、什么时候、把什么从 A 改成 B。看详情页的「动态」卡与顶部「流程条」。

与既有两套东西的分工(**别混**):

| | 是什么 | 谁写 | 读它的人 |
|---|---|---|---|
| `sys_log`(既有) | **全站合规台账**:每次 mutation 一行(path + 尽力而为的 target + 入参快照) | `init.ts` 的 audit 中间件,**fire-and-forget** | 管理员 `/settings/logs` |
| `tc_action` / `tc_comment`(既有) | **当前状态**:动作还在不在等答复、评论还在不在 | 各 resolver | 业务页面 |
| `tc_log` | **模块业务历史**:结构化的前后状态 + 事件语义 | 各 resolver,**在业务同一个事务里** | 任务详情页 |

**两条写入口径(改代码前先读)**:

1. **与业务同事务** —— 各 resolver 用**同一个 `tx`** 调 `logTaskEvent()`(router 里的本地函数):
   业务成功就一定有日志,业务回滚日志一起没。
   ⚠️ 这与 `lib/audit.ts` 的「绝不拖累业务」**故意相反** —— 状态变了却没有历史,正是这个需求要消灭的东西。
   **别把它改成 `void` / fire-and-forget**。
2. **两个状态列 = 严格前后** —— `from_status` / `to_status` 只表示任务状态在这次事件**前后**的值,
   没动状态就**双双 NULL**;「这次想去哪」放 `detail.intendedTo`(审批的目标态),不要拿 `to_status` 兼职。

**一次用户操作 = 一行**:`taskCreate` 带的初始成员折进 `detail.members`,**不**另写 `member.add`。

| `event` | 写入点 | `to_status` | `detail` |
|---|---|---|---|
| `task.create` | `taskCreate` | 模板的 `initial` | `{workflowId, members[]}` |
| `task.update` | `taskUpdate` | null | `{fields[{key,from,to}], payloadChanged}` |
| `task.remove` | `taskRemove` | null | — |
| `task.transit` | `taskTransit` | 目标状态 | `{who[]}` |
| `action.create` | `actionCreate` | 锁定时 → `pending`,否则 null | `{intendedTo, handleId, isLocking, parentActionId, sequence}` |
| `action.respond` | `actionRespond` | 通过 → 目标态 / 驳回 → 退回原态;没动则 null | `{approved, reason, actionStatus}` |
| `comment.create` | `commentCreate` | null | `{attachments}` |
| `comment.remove` | `commentRemove` | null | — |
| `member.add` | `memberAdd` | null | `{role, isPrimary}` |
| `member.remove` | `memberRemove` | null | `{role}` |
| `member.transfer` | `taskTransfer` | null | `{from}`(转交前的主执行人 user id;`target_id` = 转交后的执行人) |

每行另有 `target_id`(动作 / 评论 / 人的 id —— **类型由 `event` 决定**,所以不存 `target_type`)与
`actor_id` + `actor_name`(姓名**快照**,账号被删历史仍读得懂;与 `sys_log.operator_name` 同口径)。

**其它口径**:

- 索引:`(task_id, created_at)` 详情页主查询;`(task_id, event, created_at)`「只看状态变化」(流程条);
  `(actor_id, created_at)` 跨任务的"我干了什么";`(target_id, created_at)` 某个动作 / 评论的历史;
- `created_at` 是 **`datetime(3)`**(毫秒):同一事务里可能写多行,秒精度会撞点;
  同毫秒撞点时读取侧用 `id` 兜底排序 —— **只为稳定,不表示语义**;
- **不加 `deleted_at`**(流水表,见 `lib/soft-delete.ts`)、**不加 `updated_at`**(不可变);
- 库里**不存中文**:状态存 `value`、事件存英文码,展示名由 `src/lib/task-close-log.ts` 的词表 +
  模板的 `statuses` 现算(与「状态存 value、UI 显示 label」同口径);认不出的 `event` 降级成占位,不崩;
- 读接口 `taskClose.logList`(登录 + 任务可见,`pageInput` 分页);权限分类在 `lib/rbac.ts` 的
  `UNMAPPED_QUERIES` 与数据权限 `UNSCOPED` 两张表里;
- **流程条现在读它**:以前「直接改状态」(`via:"direct"`)**不留痕**,只能拿 `tc_action` 反推;
  现在每一跳都有自己的行(顺带修掉了 `task-close-status-timeline.tsx` 里那条 TODO)。

**已知边界**:

- 模板(`tc_workflow`)的增删改**不进**本表(它没有 `task_id`),继续靠 `sys_log` 留痕;
- 代切换身份时 `actor` 是**被切换成的那个人**(与 `sys_log` 同口径),要追真实管理员看 `impersonate` 那条 stdout 日志;
- 被操作对象(指派人 / 成员)的姓名是**读取时 join** 出来的 —— 硬删则回退显示 id;
- 保留期 / 清理脚本:模板一贯不带(与 `sys_log` 同)。

## DDL

```sql
CREATE TABLE `tc_workflow` (
  `id`         VARCHAR(191) NOT NULL,
  `payload`    JSON         NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at` DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='状态图模板(tc_close 模块:payload 装整套 statuses/initial/edges 定义)';

CREATE TABLE `tc_task` (
  `id`          VARCHAR(191) NOT NULL,
  `name`        VARCHAR(255) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  `status`      VARCHAR(32)  NOT NULL,
  `creator_id`  VARCHAR(191) NOT NULL,
  `due_at`      DATETIME     DEFAULT NULL,
  `payload`     JSON         DEFAULT NULL,
  `workflow`    JSON         NOT NULL,
  `deleted_at`  DATETIME     DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_task_status_created` (`status`),
  KEY `idx_task_creator_status` (`creator_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='任务本体(tc_close 模块:workflow 列是创建时从 tc_workflow.payload 复制的快照)';

CREATE TABLE `tc_action` (
  `id`               VARCHAR(191) NOT NULL,
  `task_id`          VARCHAR(191) NOT NULL,
  `serial_no`        VARCHAR(191) NOT NULL,
  `parent_action_id` VARCHAR(191) DEFAULT NULL,
  `is_locking`       TINYINT(1)   NOT NULL,
  `from_status`      VARCHAR(32)  DEFAULT NULL,
  `to_status`        VARCHAR(32)  DEFAULT NULL,
  `sequence`         INT          NOT NULL,
  `created_id`       VARCHAR(191) NOT NULL,
  `handle_id`        VARCHAR(191) NOT NULL,
  `status`           VARCHAR(16)  NOT NULL,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_action_task_serial`   (`task_id`, `serial_no`, `sequence`),
  KEY `idx_action_handle_status` (`handle_id`, `status`),
  KEY `idx_action_parent`        (`parent_action_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='外挂动作(tc_close 模块:审批/征询/监督同一种模式)';

CREATE TABLE `tc_member` (
  `id`         VARCHAR(191) NOT NULL,
  `task_id`    VARCHAR(191) NOT NULL,
  `user_id`    VARCHAR(36)  NOT NULL,
  `role`       VARCHAR(16)  NOT NULL,
  `is_primary` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_member_unique`   (`task_id`, `user_id`, `role`),
  KEY        `idx_member_user_role` (`user_id`, `role`),
  KEY        `idx_member_task_role` (`task_id`, `role`),
  KEY        `idx_member_task_primary` (`task_id`, `is_primary`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='任务-成员关系(tc_close 模块:participant/executor 与 tc_task 多对多;creator 是 tc_task.creator_id 固有属性不入此表)';

CREATE TABLE `tc_comment` (
  `id`          VARCHAR(191) NOT NULL,
  `task_id`     VARCHAR(191) NOT NULL,
  `author_id`   VARCHAR(36)  NOT NULL,
  `content`     TEXT         NOT NULL,
  `attachments` JSON         DEFAULT NULL,
  `deleted_at`  DATETIME     DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_comment_task_created` (`task_id`, `created_at`),
  KEY `idx_comment_author`       (`author_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='任务评论(tc_close 模块:全员可评论;attachments JSON 存 sys_file.id 数组,字节走 sys_file/MinIO)';

CREATE TABLE `tc_log` (
  `id`          VARCHAR(32)  NOT NULL,          -- nanoid(与 sys_log.id 同口径,不参与外键)
  `task_id`     VARCHAR(191) NOT NULL,          -- → tc_task.id(不建外键:审计要留住已删任务)
  `event`       VARCHAR(48)  NOT NULL,          -- 英文事件码;中文由前端词表现算
  `from_status` VARCHAR(32)  DEFAULT NULL,      -- 事件**之前**的任务状态;没动状态就是 NULL
  `to_status`   VARCHAR(32)  DEFAULT NULL,      -- 事件**之后**的任务状态;没动状态就是 NULL
  `target_id`   VARCHAR(191) DEFAULT NULL,      -- 动作 / 评论 / 人的 id(类型由 event 决定)
  `actor_id`    VARCHAR(36)  NOT NULL,          -- → sys_user.id
  `actor_name`  VARCHAR(64)  DEFAULT NULL,      -- 姓名快照(账号被删后历史仍读得懂)
  `detail`      JSON         DEFAULT NULL,      -- 事件专属补充(结构由 event 判别)
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- 毫秒:一个事务里可能写多行
  PRIMARY KEY (`id`),
  KEY `idx_log_task_created` (`task_id`, `created_at`),
  KEY `idx_log_task_event`   (`task_id`, `event`, `created_at`),
  KEY `idx_log_actor`        (`actor_id`, `created_at`),
  KEY `idx_log_target`       (`target_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='任务闭环活动日志(tc_close 模块:只增不改;由 resolver 在同一事务里写)';
```

## JSON 字段形状

### `tc_workflow.payload` —— 状态图定义

```jsonc
{
  "name": "默认事项流程",
  "statuses": [
    { "value": "open",     "label": "进行中" },
    { "value": "pending",  "label": "待审批" },
    { "value": "done",     "label": "待核验" },
    { "value": "closed",   "label": "已关闭" },
    { "value": "archived", "label": "已归档" }
  ],
  "initial": "open",                       // value,不是 label
  "edges": [
    { "from": "open",   "to": "done",     "who": ["creator", "executor"], "via": "action" },
    { "from": "done",   "to": "closed",   "who": ["creator"],   "via": "direct" },
    { "from": "done",   "to": "open",     "who": ["creator"],   "via": "direct" },
    { "from": "closed", "to": "open",     "who": ["creator"],   "via": "direct" },
    { "from": "closed", "to": "archived", "who": ["creator"],   "via": "direct" }
  ]
}
```

- `statuses`:**状态定义数组**,每项 `{ value, label }` —— `value` 是英文标识(落库 / `tc_task.status` / 边引用),
  `label` 是展示名。**UI 一律显示 `label`**(`lib/task-close-spec.ts` 的 `statusLabelOf`,取不到回退 `value`),
  **前端不再有任何中文映射表**。同一 `value` 只留第一条(`normalizeWorkflow` 去重)。
- `initial`:任务创建时的初始状态(**用 `value`**)。
- `edges`:状态转移边,`from` / `to` 也用 `value`。`via = direct` 表示不需要 action 直接改,`via = action` 表示要 root action 结算
  - **同一对 `(from, to)` 只能有一条边**(`via` 二选一,服务端 `normalizeWorkflow` 会拒重复)。
  - **「必须经过 action」= 给这对状态只留 `via:"action"` 的边、不加对应的 `direct` 边**:
    `taskTransit` 只认 `direct` 边(没有就直接拒「没有 X → Y 的直接转移」),`actionCreate` 只认 `action` 边。
    两条并存会让两条路都通,"必须"就失效 —— 所以唯一键按状态对而不是按 `(from,to,via)`。
    **唯一的例外是管理员**:目标状态只要在 `statuses` 里,管理员就 `taskTransit` 得动(不看边、不看 `who`)。
    ⚠️ 这是「管理员什么都可以」的逃生口,**不是**模板语义的一部分 —— 派生项目若不要这个口子,去掉 `taskTransit` 里那个 `isAdmin` 分支即可。
  - `who` 的含义随 `via` 变:`direct` = 谁能**直接改**;`action` = 谁能**发起**这次审批(`action` 边的**审批人**
    不在模板里,是发起时按 `handle_id` 现选的)。

### `tc_task.workflow` —— 任务级状态图快照

**创建任务时,服务端从 `tc_workflow.payload` 复制整 shape 存到这里**。之后改 `tc_workflow` 不影响已建任务。**NOT NULL**。

### `tc_task.payload` —— 内容区(块)+ 附件区

```jsonc
{
  "type": "task-distribute",        // 可选:场景标签,内核不解释
  "content": [                       // 内容区:有序块数组(可混合、可排序)
    { "kind": "text",  "text": "3 号机组本周巡检,重点看冷却塔。" },
    { "kind": "table", "caption": "点位", "columns": [{ "key": "name", "label": "点位" }], "rows": [{ "name": "冷却塔" }] },
    { "kind": "ref",   "path": "/settings/users", "query": { "q": "张三" }, "title": "用户管理 · 张三" },
    { "kind": "link",  "url": "https://example.com/spec", "title": "巡检规范", "description": "外部文档" }
  ],
  "attachments": [ "<sys_file.id>", "…" ]   // 附件区:与 tc_comment.attachments 同形
}
```

**内容区是「有序块数组」,不是并列字段** —— 判别联合 `kind ∈ text / table / ref / link`:

| kind | 形状 | 渲染 |
|---|---|---|
| `text` | `{ text }` | 段落(`whitespace-pre-wrap`) |
| `table` | `{ caption?, columns:[{key,label}], rows:[{key→string}] }` | 只读表格(值统一 string) |
| `ref` | `{ path(以 / 开头), query?, title }` | 内部链接(**不**取目标页数据,靠 `title` 说明是什么) |
| `link` | `{ url(http/https), title, description? }` | 外链(`target=_blank rel=noopener`) |

**抽象(把这 4 种类型压成"一张表")**:前端只读 / 编辑各有一张 `kind → spec` 注册表
(`task-content-blocks.tsx` 的 `VIEWS`、`task-content-editor.tsx` 的 `EDITORS`);「添加内容块」菜单读 `CONTENT_KINDS`。
**加一种块 = 改联合类型 + 加一条注册项**,列表 / 详情 / 编辑器零改动。服务端一个 `z.discriminatedUnion` 同口径校验;
不认识 `kind` 时前端**降级成占位块**(不崩、也不吞掉其余块),前后端可独立演进。

真源:`src/lib/task-content.ts`(类型 + zod schema + 容错解析 `parseBlock` + 规范化 `normalizePayload`,前后端同一份)。
`normalizePayload` 在服务端兜底:trim / 丢空块 / 附件去重去空 / `path` 必须 `/` 开头 / `url` 只留 http(s) / 截断超量;
全空存 `NULL`(不存空壳对象)。

**附件区**:`sys_file.id[]`,`taskGet` join `sys_file` 回填 `{id,name,size,contentType}`(与 `commentList` 同一段解析,已删文件丢掉)。
上传走 `useFileUpload`(选完即传、私桶 `private`)。**预览 / 下载**走 `attachmentUrl`(只放行挂在本任务上的文件):
图片 `<img>`、PDF `<iframe>`、文本 `fetch` 后截断展示,其余给「新标签打开 / 下载」;下载用 `download:true` 的预签名地址(按原始文件名存盘)。
`taskCreate` / `taskUpdate` 的 `payload` 入参就是 `taskPayloadSchema`;`taskGet` 另回**解析好的** `content`(块数组)与 `attachments`(已回填)。

### `tc_action` 无 JSON 列

`payload` / `result` 这类业务字段后续随 `tc_attachment` / `tc_comment` 子表走。**本表不存文本**。

### `tc_comment.attachments` —— 附件 ID 引用

```ts
type TcCommentAttachment = string;        // sys_file.id (varchar 32)
type TcCommentAttachments = TcCommentAttachment[];  // JSON 数组,无序
```

字节存 MinIO(`doc/文件管理.md`),元数据在 `sys_file`。**不新建附件表**,svc 层 join `sys_file.id` 列表取详情。

## who 协议

`tc_workflow.payload.edges[].who` 数组合法值,内核触发 action 时按以下规则判定:

| 取值 | 含义 |
|---|---|
| `"creator"` | `currentUser === tc_task.creator_id`(查 task 固有列,**不走 tc_member**) |
| `"participant"` | 存在 `tc_member` 行 `role='participant'` 且 `user_id` = 当前用户 |
| `"executor"` | 同上 `role='executor'` |
| `"any"` | 三者任一命中(便利写法,等同三显值并集) |
| `["creator", "executor"]` | 数组 = OR,可任意组合 |
| `[]` | 系统自带,前端不开 |

creator **不入 `tc_member`**(已在 `tc_task.creator_id` 列里);参与者 / 执行者由 `tc_member` 维护,UK 是 `(task_id, user_id, role)`,**同一用户可同时是 participant + executor**(两行)。`is_primary=1` 仅 executor 角色允许,代表主执行人。**禁止 `"user:<id>"` 字面量进 who** —— 指名指人是 `tc_action.handle_id` 的活儿。

## 锁语义

```
任务被锁 = 存在 is_locking = 1 且 status IN ('queued', 'active') 的 tc_action
```

锁住期间不能直接 `UPDATE tc_task.status`,必须等所有 `is_locking` 链结束。**只有根级**(`parent_action_id IS NULL`)的 action 能推进 `tc_task.status`,子 action 的 `from_status` / `to_status` 必须 NULL。

## 默认状态机

| 状态 | 含义 |
|---|---|
| `open` | 进行中 |
| `pending` | 有 `is_locking` action 在跑 |
| `done` | 完成待核验 |
| `closed` | 已关闭 |
| `archived` | 终态,只读 |

| from → to | 触发 | who | via |
|---|---|---|---|
| — → open | create | — | direct |
| open → done | 发起改状态 action | creator / executor | action |
| done → closed | creator 关闭 | creator | direct |
| done → open | creator 驳回 | creator | direct |
| closed → open | creator 重开 | creator | direct |
| closed → archived | creator 归档 | creator | direct |
| open → pending | 挂上 `is_locking` action 时**系统**置位 | 系统 | direct |
| pending → done | 根级 action 通过(`to_status` = done) | 系统 | direct |
| pending → open | 根级 action 驳回(退回 `from_status`) | 系统 | direct |

上表就是 `pnpm db:seed:task-close` 灌进 `tc_workflow.payload` 的默认模板。派生项目换模板即可 ——
`pending` 两行的触发是**系统**行为(不在 `edges` 里),`who` 判定只管用户发起的那些行。

## 权限矩阵

| 操作 | 创建者 | 参与者 | 执行者 | 管理员 | 任意登录用户(RBAC 允许访客)|
|---|---|---|---|---|---|
| 评论(`tc_comment`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 发起「不改状态」action(`to_status` = NULL,征询等) | ✓ | ✓ | ✓ | ✓ | × |
| 发起「改状态」action(`to_status` ≠ NULL) | ✓ | × | ✓ | ✓ | × |
| 关闭任务(对应 `payload.edges` 的 `who=["creator"]` 边) | ✓ | × | × | ✓ | × |
| 编辑任务(`task.update`)/ 删任务(`task.remove`) | ✓ | × | × | ✓ | × |
| 加成员(`member.add`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| 移出成员(`member.remove`) | ✓ | × | × | ✓ | × |
| 转交执行人(`member.transfer`) | × | × | ✓ | ✓ | × |
| 删评论(`comment.remove`) | × | × | × | ✓(全部) | 作者本人(仅自己) |

> **管理员什么都可以**:管理员 = 「系统管理员」角色(`lib/casbin.ts` 的 `isAdminUser`),上表所有 ✓ 都对他成立,
> 且**不受 `who` / `tc_member` 限制**。读路径由 `taskGet.permissions.isAdmin` 下发,写路径
> (`taskUpdate` / `taskRemove` / `memberRemove` 的 `assertCanManage`、`actionCreate` 的 `canAct`、
> `commentRemove`)与读路径**同源放行**。
> **改状态更进一步**:管理员走 `taskTransit` 可以**直接改到模板里的任意状态** —— 不要求存在对应的边、也不查 `who`
> (前端对应头部的「改状态」按钮)。唯一仍生效的守卫是**锁语义**:任务被未完成的审批动作锁住时,谁都不能直接改状态
> (否则那条 action 的 `to_status` 会与任务状态对不上)。
>
> 前端按钮矩阵见下节「头部按钮(按事项流程派生)」。

## 头部按钮(按事项流程派生)

**与状态有关的两个按钮不写死角色**,由服务端 `taskGet.permissions`(来自任务快照的模板)派生 —— 换模板不用改前端:

| 按钮 | 出现条件 | 选项 |
|---|---|---|
| 发起审批 | `permissions.actionTargets` 非空(当前状态有我发起的 `via=action` 边)且未锁定 | `actionTargets` |
| 改状态 | 未锁定,且(`permissions.isAdmin` 或 `permissions.transitions` 非空) | 管理员 = 模板**全部**状态;其他人 = `transitions`(我能直改的 `direct` 边) |

**锁定期**(`permissions.locked` / 状态 = `pending`)这两个按钮都不出现 —— 与服务端锁守卫一致,**管理员也不例外**。

头部动作组**最左边还有一颗 ⓘ**(`ui/tooltip`):悬停 / 聚焦展开「当前身份 + 本事项流程给这个身份的边」的一行说明
(如「当前身份:创建者 / 状态:进行中 / 发起审批:→ 待核验 / 直接改状态:无」),就是为了让人当场核对这些按钮为什么是这几个。
它只是解释规则,不代替服务端授权。

其余按钮与状态无关,按角色(`myRole` = admin / creator / executor / participant / null):

| 角色 | 转交 | 发起征询 | 编辑 | 删除 | 刷新 |
|---|---|---|---|---|---|
| 管理员 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 创建者 | × | ✓ | ✓ | ✓ | ✓ |
| 执行者 | ✓ | ✓ | × | × | ✓ |
| 参与者 | × | ✓ | × | × | ✓ |
| 旁观者 | × | × | × | × | × |

按**默认事项流程**(`scripts/seed-task-close.ts`)展开,头部实际长这样:

| 当前状态 | 创建者 | 执行者 | 参与者 | 管理员 |
|---|---|---|---|---|
| 进行中 `open` | 发起审批(→待核验)· 征询 · 编辑 · 删除 · 刷新 | 发起审批(→待核验)· 转交 · 征询 · 刷新 | 征询 · 刷新 | 全显 + 改状态(任意) |
| 待审批 `pending`(锁定) | 刷新 | 刷新 | 刷新 | 刷新(锁定期不能改状态) |
| 待核验 `done` | 改状态(→已关闭 / →进行中)· 征询 · 编辑 · 删除 · 刷新 | 转交 · 征询 · 刷新 | 征询 · 刷新 | 全显 + 改状态(任意) |
| 已关闭 `closed` | 改状态(→进行中 / →已归档)· 征询 · 编辑 · 删除 · 刷新 | 转交 · 征询 · 刷新 | 征询 · 刷新 | 全显 + 改状态(任意) |
| 已归档 `archived` | 征询 · 编辑 · 删除 · 刷新 | 转交 · 征询 · 刷新 | 征询 · 刷新 | 全显 + 改状态(任意) |

> **创建者也按流程走**:默认流程里 `open→done` 是 action 边、`who` 含 creator,所以创建者在「进行中」看到的是
> **发起审批**(不是直改);`done→closed` 等四条直改边 `who=["creator"]`,所以创建者在「待核验 / 已关闭」看到的是
> **改状态**。**只有管理员**能绕开模板直接改到任意状态。

> 「全员可评论」= 任务可见即可,不限 `tc_member`。RBAC 决定谁能 **看到** 任务;`tc_member` 决定谁**参与推进**。
>
> **「加成员」对所有登录用户开放**(与「全员可评论」同口径:任务可见即可加);**「移出成员」仅创建者 / 管理员**。
>
> 「执行者可更改状态」= 通过发起 `to_status` ≠ NULL 的 `tc_action`,**只有根级 action**(子 action 不推进任务);判定走现有的 `who` 协议。
>
> 「创建者可关闭任务」= 对应 `payload.edges` 里 `who=["creator"]`、`via="direct"` 的边,直接改 `tc_task.status`,不创建 action。
>
> **任务 / 动作 / 评论的接口不经 RBAC 权限点**:授权是**任务级**的,由 `who` 协议在 resolver 内判定
> (`canAct()`)⇒ 这些接口登记在 `lib/rbac.ts` 的 `UNMAPPED_MUTATIONS` / `UNMAPPED_QUERIES`。
> **但「流程模板」页是另一回事**:它是全局配置、没有任务级的概念,所以按 RBAC 走 ——
> 读接口 `workflowGet` 用页面码 `page:/task-close/workflows`;三个写接口 `workflowCreate/Update/Remove`
> 用按钮权限点 `sys:tcWorkflow:add/edit/remove`(按钮由 `pnpm db:seed:rbac` 建,挂在 `/task-close/workflows` 菜单下)。
> `workflowList` 仍**只要求登录**(建任务 / 我的任务页共用,锁到流程模板页会把它们拦死)。

## 接口

22 个过程,router 名 `taskClose`(实现在 `src/integrations/trpc/routers/task-close.ts`)。

| 路径 | 类型 | 入参 | 谁能调 |
|---|---|---|---|
| `workflowList` | query | — | 登录 |
| `workflowGet` | query | `{id}` | 登录 + 有「流程模板」页 |
| `workflowCreate` | mutation | `{name,statuses,initial,edges}` | `sys:tcWorkflow:add` |
| `workflowUpdate` | mutation | `{id,name,statuses,initial,edges}` | `sys:tcWorkflow:edit` |
| `workflowRemove` | mutation | `{id}` | `sys:tcWorkflow:remove`(内置 `wf-default` 一律拒) |
| `taskList` | query | `{status?,keyword?,mine?,page?,pageSize?}` | 登录 |
| `taskGet` | query | `{id}` | 登录 |
| `taskCreate` | mutation | `{name,description?,dueAt?,workflowId,payload?,members?}` | 登录 |
| `taskUpdate` | mutation | `{id,name,description?,dueAt?,payload?}` | creator / 管理员 |
| `taskRemove` | mutation | `{id}` | creator / 管理员 |
| `taskTransit` | mutation | `{id,to}` | 边的 `who`;**管理员可改到任意状态** |
| `memberAdd` | mutation | `{taskId,userId,role,isPrimary?}` | 登录(所有角色都能加) |
| `memberRemove` | mutation | `{taskId,userId,role}` | creator / 管理员 |
| `taskTransfer` | mutation | `{taskId,userId}` | 执行者 / 管理员(目标必须是本任务成员,且不能是自己 / 创建者) |
| `actionList` | query | `{taskId}` | 登录 |
| `actionMine` | query | `{page?,pageSize?}` | 登录(只读自己的) |
| `actionCreate` | mutation | `{taskId,toStatus?,handleId,parentActionId?}` | 见权限矩阵 |
| `actionRespond` | mutation | `{id,approved,reason?}` | `handle_id` 本人(**驳回必填 `reason`**) |
| `commentList` | query | `{taskId}` | 登录 |
| `commentCreate` | mutation | `{taskId,content,attachments?}` | 登录 |
| `commentRemove` | mutation | `{id}` | 作者本人 / 管理员 |
| `attachmentUrl` | query | `{taskId,fileId,download?}` | 登录(内部校验该附件挂在本任务上) |

**可见性** v1 口径:任何登录用户可读任何任务(无菜单 = RBAC 允许访客);`tc_member` 只决定**推进权**。
`taskList.mine = true` 是「我创建 + 我是成员」的过滤,是**便利筛选**不是安全边界。

**`taskGet.permissions`** 由服务端算好下发(`transitions`(可直接改到的状态)/ `actionTargets`(可发起「改状态」
action 的目标状态,「发起审批」弹窗的候选项)/ `canInitiateStatusAction` / `canInitiateConsult` /
`canAddMember`(恒 true)/ `canManageMembers`(仅创建者)/ `canUpdate` / `canRemove` / `isAdmin` / `locked`(任务是否被
未完成的审批动作锁住)/ `myRoles` / `isCreator`),前端不再自己解释 `who` / `edges`。
`taskGet` 另回 `meId` —— 前端靠它判断「这条动作 / 评论是不是我的」,不必再单独问一次会话。

**动作派生规则**(服务端定,客户端只传 `toStatus`):

| 情况 | `is_locking` | `from_status` | `serial_no` | `sequence` | `status` | 任务状态 |
|---|---|---|---|---|---|---|
| 根级 + `toStatus` 有值(审批) | 1 | 当前任务状态 | 自己 id | 0 | `active` | → `pending` |
| 根级 + `toStatus` 为空(征询) | 0 | 当前任务状态 | 自己 id | 0 | `active` | 不动 |
| 子级(`parentActionId` 有值) | 0 | NULL | 继承父 | 父 + 1 | `queued` | 不动 |

答复结算:根级 + `is_locking` 通过 → 任务转 `to_status`;驳回 → 退回 `from_status`。
**驳回必须填 `reason`**,原因直接以**一条评论**留档(复用 `tc_comment`,不另造"驳回意见"表);通过不需要。

**并发**:`taskTransit` / `actionCreate` / `actionRespond` / `memberAdd` 走 `db.transaction`,
开头对 `tc_task` 行 `for update` —— 锁顺序统一「先 `tc_task` 再 `tc_action`」,避免互相等锁。

**种子**:模板由 `pnpm db:seed:task-close` 灌(幂等,只补不覆盖)—— 一条内置默认模板 `wf-default`
(界面与接口都**不允许删除**,保证建任务时总有模板可选)+ 一条示例「安全检查流程」。派生项目照 `rows` 加即可。

> **`pending` 是框架锁态,不是用户可发起的边**:任何 `via:"action"` 的边,任务在被锁期间都会进入 `pending`
> (由 `actionCreate` 硬编码置位,答复后离开,见「默认状态机」),所以**它本来就没有用户边** ——
> 想在编辑/详情里把它"看成有一条边"是错的。模板 `statuses` 里声明它是为了让状态集完整;
> 详情弹窗把审批边渲染成 `from →〔待审批〕→ to`,让这条系统转移看得见。

## 前端页面

菜单「任务闭环 ▸ 我的任务 / 流程模板」在 `NAV_NODES`(`src/components/layout/nav-config.ts`)里,灌表用 `pnpm db:seed:menus`。

| 路由 | 组件(`src/components/modules/task-close/`) | 说明 |
|---|---|---|
| `/task-close` | `task-close-cards-page.tsx` | 我的任务:卡片视图 + 状态/关键词筛选 + **服务端分页** |
| `/task-close/$taskId` | `task-close-detail-page.tsx` | 详情:任务头(动作条 / 流程条 / 元信息 / 描述)+ 内容+附件 / 动态 / 动作 / 评论 / 成员 |
| `/task-close/workflows` | `task-close-workflows-page.tsx` | 流程模板:卡片视图 + 增删改查(卡上「详情 / 编辑 / 删除」)|

配套件:`task-close-form.tsx`(新建 / 编辑弹窗)、`task-close-actions.tsx`(发起动作 + 时间线 + 答复)、
`task-close-comments.tsx`(评论,附件走 `useFileUpload` 传进 `sys_file`)、`task-close-status.tsx`(状态徽章 —— 名字由模板 label 给)、
`task-close-workflow-form.tsx`(结构化编辑器:状态行(value + label)+ 初始态 + 边的行表格)、`task-close-workflow-detail.tsx`(只读详情)、
`task-content-blocks.tsx` / `task-content-editor.tsx`(内容块只读 / 编辑注册表)、`task-content-attachments.tsx`(附件选择 / 列表)、
`task-close-status-timeline.tsx`(流程条 —— 读 `tc_log` 里 `to_status` 非空的行,所以「直接改状态」也留痕)、
`task-close-log.tsx`(「动态」卡:图标 + 人名 + 人话 + 时间;事件词表与文本在 `src/lib/task-close-log.ts`,客户端安全)、
`task-close-attachment-preview.tsx`(附件预览 / 下载弹窗)。

三条口径:

- **页面级授权**:`/task-close`、`/task-close/workflows` 都进了 `sys_menu` ⇒ 按**菜单授权**判(`lib/rbac.ts` 的 `canViewPath`)。
  **⚠️ 通配 `*:*:*` 管不到这里** —— 它只在装载时命中**带 `perm` 的菜单**(按钮权限点),
  而页面菜单的 `perm` 为空,展开不到(实测踩过:菜单灌进去了,系统管理员却看不见)。
  所以要在「角色管理」里勾上这个菜单,或者跑 `pnpm db:seed:rbac` ——
  它的 `ensureAdminGrants` 会把系统管理员对账成「全部活菜单 + 那条通配」,新加页面不用再手点。
  `/task-close/$taskId` 刻意**不进**菜单表 ⇒ 按 `canViewPath` 的口径只要求登录(详情路由拦不了推进权)。
- **按钮级授权**:前端**不解释** `who` / `edges`,能做什么全部读 `taskGet.permissions` ——
  隐藏按钮不是安全边界,真正的拦截在 resolver 里(见「权限矩阵」末尾那段)。
  流程模板页的「新增 / 编辑 / 删除」另按 `sys:tcWorkflow:*` 按钮权限点显隐(`useHasPerm`)。
- **发起动作**:目标 = **「征询」+ 当前状态下 `via:"action"` 的边**(模板里枚举好),选的是 `value`,
  界面显示 `label`;选「征询」则 `toStatus = null`。
- 新建任务只选**一名执行人**;更多成员、改状态、征询都在详情页做,一件事一个接口。

> **详情页的阅读顺序**(2026-10 定的版式,别拆回「一行灰字 + 一张状态卡」):
> 页头(任务名 + 状态徽章 + 返回/刷新/编辑/删除)→ **任务头卡**(动作条:左「我的身份」右「下一步」→ 流程条 →
> 标签在上/值在下的元信息 → 描述走左侧 2px 引用线)→ 左栏(任务内容+附件 / 处理动作 / 评论)+ 右栏(成员,拉满等高)。
> 三条约束:①状态徽章**只在页头出现一次**;②改状态的按钮**不放页头**,放任务头卡的动作条(状态与动作贴在一起);
> ③元信息用 `dl`(`dt` = 12px muted + 图标,`dd` = 14px foreground)成对排,**不写成「截止 xxx」一行灰字**。
>
> 详情页的 id **查不到就自动回「我的任务」**:`taskGet` 报 tRPC `NOT_FOUND`(含已软删)时弹一句提示 + `replace` 回列表,
> 不留错误页;`taskRemove` 成功同样 `replace` 回列表(缓存只标过期、**不立刻重取** —— 那条 `taskGet` 已经查不到了,重取只会先报一次错)。

> **新增页面后**记得跑 `pnpm db:seed:menus`(让 `/task-close/workflows` 进 `sys_menu`,页面码才对得上)
> 和 `pnpm db:seed:rbac`(建 `sys:tcWorkflow:*` 按钮)—— 少跑任何一个,`tests/auth.test.ts` 的守卫会挂。

## 角色 / 不做的事

- 角色(处置人 / 参与人 / 监督人 / 审批人)由 RBAC 管理,本模块只记 `user_id`
- 任务 / 动作 / 评论 16 个接口**不用 RBAC 权限点**(在 `UNMAPPED_MUTATIONS` / `UNMAPPED_QUERIES` 里,由 `who` 协议内判);
  **流程模板** 4 个接口按 RBAC 走(页面码 + `sys:tcWorkflow:*` 按钮权限点,理由见「权限矩阵」末尾)
- 不做会签、并联审批、嵌套子流程
- 不写 `task.type` 多类型字段,用 `tc_task.payload.type` 区分场景
- 不接管 `task-close` 数据库(那是独立原型实验,与本项目无关)
