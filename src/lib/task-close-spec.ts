/**
 * 任务闭环(tc_close)的常量真源 —— 只放「router、种子脚本、测试都要用」的字面量。
 *
 * 单独一个文件(而不是从 `routers/task-close.ts` 导出):那个 router 会连带拉起
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
export type WorkflowStatus = { value: string; label: string };

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

/** 取键为 `P0`/`P1`/`P2` 的展示短名(给详情头 meta-line 用)。null / 未知 → "未设置" */
export function priorityShortLabel(priority: TaskPriority | null | undefined): string {
	if (priority === null || priority === undefined) return "未设置";
	return `P${priority}`;
}

/** 从 `tc_task.priority` 取展示名;null/未知/空 → "未设置" */
export function priorityLabelOf(priority: number | string | null | undefined): string {
	if (priority === null || priority === undefined || priority === "") return "未设置";
	const n = typeof priority === "string" ? Number(priority) : priority;
	return TASK_PRIORITY_LABEL[n as TaskPriority] ?? "未设置";
}
