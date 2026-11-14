/**
 * 任务闭环(tc_close)的常量真源 —— 放「router、种子脚本、测试都要用」的字面量,
 * 以及只依赖这些字面量的一行取用函数(`statusLabelOf` / `priorityLabelOf` / `taskPathOf`)。
 *
 * 单独一个文件(而不是从 `routers/task/`(组合入口 `index.ts`) 导出):那个 router 会连带拉起
 * `../init`(`@tanstack/react-start/server` 等),而 `scripts/seed-task-close.ts`
 * 是个纯 tsx 脚本 —— 为了一个字符串常量把整套 tRPC 运行时装进脚本不值当。
 */

/** 内置默认模板 id —— 由 `pnpm db:seed:task-close` 写入,不允许删除(保证总有模板可选) */
export const DEFAULT_WORKFLOW_ID = "wf-default";

/**
 * 状态定义 —— `value` 是英文标识(落库 / 边引用 / `tc_task.status`),`label` 是展示名。
 *
 * **UI 一律显示 `label`**,`value` 只在落库与边(`edges.from/to`)里用;不在这里放任何"中文映射表"。
 */
export type WorkflowStatus = { value: string; label: string; terminal?: boolean };

/** 同一动作两次手动催办的最短间隔。 */
export const TASK_URGE_COOLDOWN_MINUTES = 30;

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

/** 头部 ⓘ 用的身份名 —— 比 `roleText` 多「管理员 / 旁观」两种(那两个不是 `tc_member` 里的角色) */
export const ROLE_LABEL: Record<string, string> = {
	admin: "管理员",
	creator: "创建者",
	executor: "执行者",
	participant: "参与者",
};

/** ⓘ 里「为什么有这些按钮」的一句话 —— 与 `doc/task-close.md` 的「头部按钮(按事项流程派生)」同口径 */
export const ROLE_WHY: Record<string, string> = {
	admin: "系统管理员:按流程模板与条件执行状态转移。",
	creator: "任务创建人:编辑 / 删除 / 发起征询按身份;状态类按钮按模板里 who 含 creator 的边。",
	executor: "执行者:转交 / 发起征询按身份;状态类按钮按模板里 who 含 executor 的边。",
	participant: "参与者:发起征询按身份;状态类按钮按模板里 who 含 participant 的边。",
	viewer: "你不在这条任务的流程里(既不是创建人、也不是成员):只能看,不能推进。",
};
