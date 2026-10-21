# 任务插件化:内容块 + 作答(设计蓝,未实施)

> 状态:**设计定稿,等待拍板实施**;实施前本文件只作设计依据。
> 定稿后按 §6 顺序实施;本文件是单一设计真源,改动先改这里再动代码。
> 背景与驱动的第一场景见上;现有「内容块注册表」雏形(`lib/task-content.ts` + `task-content-blocks`)。
> 与本模板的关系:任务闭环其它能力(流程脊/动作/评论/日志)**不在本插件体系内**。

**只有一种插件**。内容块的「定义 / 展示 / 作答交互」三张脸由同个插件负责;内核不解释任何具体块语义;
"回复区"不是独立二插,它是插件的**作答面**(渲染在内容区)。

```ts
type TaskFormPlugin<K, V> = {
	kind: string; label: string; icon: LucideIcon;
	blockSchema: z.ZodType<K>;      // 定义面
	blank: () => K;
	definitionEditor: (ctx) => ReactNode;
	valueSchema: z.ZodType<V>;      // 作答面
	blankValue: (block) => V;
	answerEditor: (ctx) => ReactNode;   // 内容区就地作答;他人= view readonly
	view: (ctx: { block, value, mode: "inline"|"report" }) => ReactNode;
	summary: (v) => string;
	confirm: (v) => string | null;  // 提交门槛(必答校验)
};
```

## 数据(内核不解释,按块 id 对准)

| 位置 | 内容 | 谁写 |
| --- | --- | --- |
| `tc_task.payload.content` | 带id信封 `{ id, kind, value }`(旧数据兼容) | 创建者/管理员(taskUpdate 口径不动) |
| `tc_task.draft` JSON NULL | 作答草稿 `{ blocks: { [blockId]: 值 } }` | 可作答者,`taskSaveDraft` **静默** |
| `tc_task.answer` JSON NULL | 正式作答(带一层格式: `{blocks: ...}`) | 可作答者,`taskSubmitAnswer`(**审计1行**+ tc_log `answer.submit` + notify 创建者) |

未知 kind 三层降级:定义侧占位块 / 作答侧提示缺插件 / 提交校验**跳过**;
作答者口径(内核判):执行人 + 管理员,他人只读渲染 view(mode:"inline")。

## 内核 API(共 3 个)

| Process | 语义 | 日志/通知 |
| --- | --- | --- |
| `taskSaveDraft({ taskId, blocks })` | 逐项/整批存草稿;守卫=可作答者 | 静默 |
| `taskSubmitAnswer({ taskId })` | draft→answer;逐块 valueSchema + confirm 校验 | 审计1行 + tc_log + notify 创建者 |
| 读 | draft/answer 并入 taskGet(附带 canAnswer 能力位) | — |

**提交不自动推状态**——执行人走流程边(「发起完成」action);报告不锁在作答里,可「另存为内容块」归档。

## 场景回放(检查企业安全清单)
创建者拼清单 → 执行人在内容区就地 ✓/✗ + 拍照(debounce→draft)→ 提交(必答校验)→ 创建者 report 核验
(驳回走 action)→ 「报告另存为内容块」归档;报告视图 = `view(mode:"report")`,打印 `@media print`。

## 首批插件

- **`checklist`(首选)** — 检查企业清单直接服务;定义面逐项 label+required;作答面逐项 pass/note/photoIds;
  拍照复用 file.presign/confirm + useFileUpload(两阶段链),attachmentUrl 守卫**同步扩展**(draft/answer 的 file id 也算"挂在任务上");
- **`survey`(第二块验证轨)** — 题干/单选/多选/必答;多人答案 v1 **不做**(一人一表的假设不进内核)。

## Registry 与派生

- `lib/task-forms/registry.ts` = `registryOf([checklist, survey, ...内置4块])`;CONTENT_KIND* 四张壳表退役;
- **服务端校验只用插件的 zod**(blockSchema/valueSchema),不进渲染面(React 不进服务端,与 para-spec 拆分纪律同源);
- 派生接法:`task-forms/enterprise-check.ts` 追加块注册即可,内核零改动;payload.type 不解释,当场景标签。

## 风险备忘(写 进 来 防 忘)
- taskSaveDraft **不进审计**是刻意的(一次勾选一行会刷爆;责任链由提交行承担);
- 管理员代答覆盖草稿:前端确认,内核不拦;
- 旧任务 payload 无块id → 内核 taskUpdate 时补;
- **DDL 三处同步**:`create-system-tables.ts` / `sync-table-meta.ts` / `doc/数据库与认证.md`;
- `tc_log` 新 `answer.submit`:词链(常量/label/详情类型/界面注册/列注释/doc)一条龙同步;
- 评论与作答零耦合;@提及/通知/红点只服务"有人说话"。

## 实施顺序(定稿后按)

1. 块 id 信封迁移(旧形状兼容、taskUpdate 补 id);
2. registry 收编内置 4 块(text/table/ref/link)+ 壳表退役;
3. DDL 列(draft/answer)×3 同步;
4. taskSaveDraft / taskSubmitAnswer(含守卫/审计/词链);
5. 前端作答丝路(详情内容区分流 + debounce 存草稿 + 「作答中」标签);
6. attachmentUrl 守卫扩展;
7. checklist 插件全套;
8. survey(可选并行)。

## 待拍板三件

1. 提交后**通知创建者**?(默认:是)
2. 参与人**只读实时可见**,看不到 draft?(默认:是)
3. 证据照片**仅随作答值**(不单列到 sys_file 品控表)?(默认:是)
