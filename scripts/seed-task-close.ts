/**
 * 任务闭环默认状态图种子(`tc_workflow`)—— 幂等,可重复执行。
 *
 * 第一条是**内置默认模板**(`DEFAULT_WORKFLOW_ID`),不允许在界面上删除 —— 建任务时总得有模板可选。
 * 第二条是示例模板,让「流程模板」卡片页一进去就不是空的;派生项目按自己的业务增删。
 *
 * **只补不覆盖**:按 `id` 判重,已存在就跳过 —— 有人在库里改过这份模板之后再跑本脚本不会回滚。
 *
 * 用法:`pnpm db:seed:task-close`
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { taskCloseWorkflow } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/task-close-spec.ts";

const rows = [
	{
		// 固定 id:脚本按它判重,派生项目引用它当默认模板,路由器按它禁删(见 lib/task-close-spec.ts)
		id: DEFAULT_WORKFLOW_ID,
		payload: {
			name: "默认事项流程",
			// 状态 = { value 落库/引用, label 展示名 };UI 只显示 label
			statuses: [
				{ value: "open", label: "进行中" },
				{ value: "pending", label: "待审批" },
				{ value: "done", label: "待核验" },
				{ value: "closed", label: "已关闭" },
				{ value: "archived", label: "已归档" },
			],
			initial: "open",
			edges: [
				// 完成待核验:执行者和创建者都能发起(会锁任务 → pending,答复后落到 done)
				{ from: "open", to: "done", who: ["creator", "executor"], via: "action" },
				// 下面四条都是创建者直改,不经过 action
				{ from: "done", to: "closed", who: ["creator"], via: "direct" },
				{ from: "done", to: "open", who: ["creator"], via: "direct" },
				{ from: "closed", to: "open", who: ["creator"], via: "direct" },
				{ from: "closed", to: "archived", who: ["creator"], via: "direct" },
			],
		},
	},
	{
		id: "wf-safety-check",
		payload: {
			name: "安全检查流程",
			statuses: [
				{ value: "open", label: "进行中" },
				{ value: "pending", label: "待审批" },
				{ value: "done", label: "待核验" },
				{ value: "closed", label: "已关闭" },
			],
			initial: "open",
			edges: [
				// 检查人 / 参与人都能发起「待核验」
				{ from: "open", to: "done", who: ["creator", "participant"], via: "action" },
				{ from: "done", to: "closed", who: ["creator"], via: "direct" },
				{ from: "done", to: "open", who: ["creator"], via: "direct" },
			],
		},
	},
];

let inserted = 0;
for (const row of rows) {
	const [existing] = await db
		.select({ id: taskCloseWorkflow.id })
		.from(taskCloseWorkflow)
		.where(eq(taskCloseWorkflow.id, row.id))
		.limit(1);
	if (existing) continue;
	const now = new Date();
	await db.insert(taskCloseWorkflow).values({ ...row, created_at: now, updated_at: now });
	inserted += 1;
}

const all = await db.select({ id: taskCloseWorkflow.id }).from(taskCloseWorkflow);
console.log(`✓ 任务闭环模板种子完成:本次新增 ${inserted} 条,表内共 ${all.length} 条`);
process.exit(0);
