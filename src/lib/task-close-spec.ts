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
