/**
 * 任务闭环(tc_close)的常量真源 —— 放「router、种子脚本、测试都要用」的字面量,
 * 以及只依赖这些字面量的一行取用函数(`statusLabelOf` / `priorityLabelOf` / `taskPathOf`)。
 *
 * 单独一个文件(而不是从 `routers/task/`(组合入口 `index.ts`) 导出):那个 router 会连带拉起
 * `../init`(`@tanstack/react-start/server` 等),而 `scripts/seed-task-close.ts`
 * 是个纯 tsx 脚本 —— 为了一个字符串常量把整套 tRPC 运行时装进脚本不值当。
 */

/** 单个流程模板的状态数上限 —— zod 校验与编辑器「添加状态」共用 */
export const MAX_WORKFLOW_STATUSES = 30;

/** 单个流程模板的转移边上限 —— zod 校验与编辑器「添加边」共用 */
export const MAX_WORKFLOW_EDGES = 200;

/**
 * 名称长度上限 —— 与 `tc_task.name` / `tc_report_template.name` 的 `varchar(255)` 对齐。
 * 改列宽时这个也要一起改(四处同步:schema / MySQL DDL / 达梦 DDL / `sync-table-meta.ts`)。
 */
export const MAX_NAME_LENGTH = 255;

/**
 * 人写文本的长度上限 —— 评论正文 / 征询回复 / 任务说明 / 填报里的文本值 / 数据范围条件的值,
 * **五个字段同口径**(之前散在 6 处各写一遍 5000,改一处必漏另一处)。
 */
export const MAX_TEXT_LENGTH = 5000;

/** 一条正文里最多 @ 几个人 —— 评论与征询回复同口径 */
export const MAX_MENTIONS = 100;

/** 内置默认模板 id —— 由 `pnpm db:seed:task-close` 写入,不允许删除(保证总有模板可选) */
export const DEFAULT_WORKFLOW_ID = "wf-default";

/**
 * 状态定义 —— `value` 是英文标识(落库 / 边引用 / `tc_task.status`),`label` 是展示名。
 *
 * **UI 一律显示 `label`**,`value` 只在落库与边(`edges.from/to`)里用;不在这里放任何"中文映射表"。
 */
export type WorkflowStatus = { value: string; label: string; terminal?: boolean };

/**
 * 从流程快照(`tc_task.workflow` / `tc_workflow.payload` / `tc_log` 里摸出来的 any JSON)取状态清单。
 * 这个松散断言之前在 5 处各写一遍 —— 统一到这里。
 */
export function statusesOf(workflow: unknown): WorkflowStatus[] {
	const bag = workflow && typeof workflow === "object" ? (workflow as { statuses?: unknown }) : null;
	return Array.isArray(bag?.statuses) ? (bag.statuses as WorkflowStatus[]) : [];
}

/** 当前状态是不是「结束态」—— 结束的任务不再显示超期 / 临期,也不再催办 */
export function isTerminalStatusOf(statuses: readonly WorkflowStatus[] | undefined, value: string): boolean {
	return statuses?.some((item) => item.value === value && item.terminal === true) ?? false;
}

/** 流程快照里所有终态的 `value`(给「排除结束态」的 SQL 条件用) */
export function terminalStatusValues(workflow: unknown): string[] {
	return statusesOf(workflow)
		.filter((item) => item.terminal === true)
		.map((item) => item.value);
}

/**
 * 任务是否**已经结束** —— 终态或软删。服务端各处(提醒排期、催办、改状态)统一用这一条:
 * 之前每处各写一遍 `.statuses.some(…terminal)`,漏掉 `deleted_at` 就会给软删任务排提醒。
 */
export function isClosedSnapshot(workflow: unknown, status: string, deletedAt?: Date | null): boolean {
	if (deletedAt) return true;
	return isTerminalStatusOf(statusesOf(workflow), status);
}

/** 从状态清单取展示名;取不到就回退 `value`(不抛错) */
export function statusLabelOf(statuses: readonly WorkflowStatus[] | undefined, value: string): string {
	return statuses?.find((item) => item.value === value)?.label ?? value;
}

/**
 * 任务优先级 —— 三档,`tc_task.priority` 存为 `tinyint(1)` 数字:
 *   `0` = P0 · 最高(紧急)
 *   `1` = P1 · 高
 *   `2` = P2 · 普通
 *
 * `value` 是档位编号(进库),`label` 是展示名(`P0 · 最高` 等),renderer 一律走 label。
 * 取不到 / 为 null → 回退 "未设置",不抛错(老数据 / 未选优先级 都是这个分支)。
 *
 * 顺序敏感:`priorityToneOf` 也用同一编号索引,要改值就同时改 spec + 组件色板。
 */
export const TASK_PRIORITIES = [0, 1, 2] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
	0: "P0 · 最高",
	1: "P1 · 高",
	2: "P2 · 普通",
};

/** 从 `tc_task.priority` 取展示名;null/未知/空 → "未设置" */
export function priorityLabelOf(priority: number | string | null | undefined): string {
	if (priority === null || priority === undefined || priority === "") return "未设置";
	const n = typeof priority === "string" ? Number(priority) : priority;
	return TASK_PRIORITY_LABEL[n as TaskPriority] ?? "未设置";
}

/** 任务详情页路径前缀 —— 只给下面的 `taskPathOf` 用,不外传。 */
const TASK_PATH_PREFIX = "/task-close/";

export function taskPathOf(taskId: string): string {
	return `${TASK_PATH_PREFIX}${taskId}`;
}

/** 驳回的常用原因 —— 点一下填进输入框,省得每次从零打字 */
export const REJECT_PRESETS = [
	"材料不完整",
	"数据有误",
	"信息不一致",
	"不符合要求",
	"依据不足",
	"需补充说明",
	"流程不符",
	"重复提交",
	"超出范围",
];
/** 通过的常用意见 */
export const APPROVE_PRESETS = ["情况属实", "符合要求", "材料齐全", "已核对无误", "同意办理"];

/**
 * 审批意见落成评论时的前缀 —— 服务端写、评论流识别,共用这一份真源。
 * (`lib/notice.ts` 要能独立裁剪,自己内联了一份,不引这里。)
 */
export const APPROVE_NOTE_PREFIX = "通过意见:";
export const REJECT_NOTE_PREFIX = "驳回原因:";

/** 任务角色名称。 */
export const ROLE_LABEL: Record<string, string> = {
	admin: "管理员",
	creator: "创建者",
	executor: "执行者",
	participant: "参与者",
};

export const roleLabelOf = (role: string): string => ROLE_LABEL[role] ?? role;

export const VIA_LABEL = { direct: "直接改", action: "审批动作" } as const;

/** ⓘ 里「为什么有这些按钮」的一句话 —— 与记录头的按钮组同口径 */
export const ROLE_WHY: Record<string, string> = {
	admin: "系统管理员:按流程模板与条件执行状态转移。",
	creator: "任务创建人:编辑 / 删除 / 发起征询按身份;状态类按钮按模板里 who 含 creator 的边。",
	executor: "执行者:转交 / 发起征询按身份;状态类按钮按模板里 who 含 executor 的边。",
	participant: "参与者:发起征询按身份;状态类按钮按模板里 who 含 participant 的边。",
	viewer: "你不在这条任务的流程里(既不是创建人、也不是成员):只能看,不能推进。",
};
/** 「临期」阈值(48 小时)—— 卡片的临期标与列表的「临期」筛选共用这一个,改阈值只改这里 */
export const DUE_SOON_MS = 48 * 60 * 60 * 1000;

/** 单人提醒的逐人冷却(分钟)—— 实现与界面文案同源 */
export const REMINDER_COOLDOWN_MINUTES = 30;

export function taskDeadlineState(dueAt: string | null, now: number): "soon" | "overdue" | null {
	if (!dueAt || !Number.isFinite(now)) return null;
	const remaining = Date.parse(dueAt) - now;
	if (!Number.isFinite(remaining)) return null;
	if (remaining < 0) return "overdue";
	return remaining <= DUE_SOON_MS ? "soon" : null;
}
