import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { taskWorkflowTable } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { DEFAULT_WORKFLOW_ID, type WorkflowStatus } from "#/lib/task/close-spec";
import { createTRPCRouter, protectedProcedure } from "../../init";
import { ID, type WorkflowPayload } from "./common";

type WorkflowRow = typeof taskWorkflowTable.$inferSelect;

/** `who` 协议合法值(`creator` / `participant` / `executor`)—— 编辑模板时的可选项 */
const WHO_ENUM = z.enum(["creator", "participant", "executor"]);

/** 状态图模板的编辑入参(`name` 与三个结构一起进 `tc_workflow.payload`) */
const workflowInput = z.object({
	name: z.string().min(1, "模板名称不能为空").max(100),
	statuses: z
		.array(
			z.object({
				value: z.string().min(1).max(32),
				label: z.string().min(1).max(32),
				terminal: z.boolean().optional(),
			}),
		)
		.min(1, "至少要有 1 个状态")
		.max(30),
	initial: z.string().min(1).max(32),
	edges: z
		.array(
			z.object({
				from: z.string().min(1).max(32),
				to: z.string().min(1).max(32),
				who: z.array(WHO_ENUM).min(1, "每条边至少选 1 个可发起角色").max(3),
				via: z.enum(["direct", "action"]),
			}),
		)
		.max(200),
});

/**
 * 校验并规范化模板定义 —— 返回可整份写进 `payload` 的 `WorkflowPayload`。
 *
 * 三道校验与前端编辑器同一套口径(服务端为准):初始态必须在状态集合里、每条边两端都要是已知状态。
 * 状态去空去重、边的顺序保留,`name` 去掉首尾空格。
 */
function normalizeWorkflow(input: z.infer<typeof workflowInput>): WorkflowPayload {
	// 状态按 `value` 去重(保留首次出现的顺序与 label);同一 value 重复只留第一条
	const values = new Set<string>();
	const statuses: WorkflowStatus[] = [];
	for (const item of input.statuses) {
		const value = item.value.trim();
		if (!value || values.has(value)) continue;
		values.add(value);
		statuses.push({ value, label: item.label.trim(), ...(item.terminal ? { terminal: true } : {}) });
	}
	if (statuses.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "至少要有 1 个状态" });
	const initial = input.initial.trim();
	if (!values.has(initial)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `初始态「${initial}」不在状态集合里` });
	}
	const seen = new Map<string, "direct" | "action">();
	const edges = input.edges.map((edge) => {
		const from = edge.from.trim();
		const to = edge.to.trim();
		if (!values.has(from)) throw new TRPCError({ code: "BAD_REQUEST", message: `转移边引用了未知状态:${from}` });
		if (!values.has(to)) throw new TRPCError({ code: "BAD_REQUEST", message: `转移边引用了未知状态:${to}` });
		// 唯一键是**状态对**(不含 via):同一对 (from,to) 只能一条边 ——
		// 否则 direct + action 并存时两条路都通,「必须经 action」就名存实亡(见 doc/task-close.md)。
		const key = `${from}->${to}`;
		const prev = seen.get(key);
		if (prev) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `同一对状态只能有一条边:${from} → ${to} 已经有一条「${prev === "action" ? "审批动作" : "直接改"}」的边`,
			});
		}
		seen.set(key, edge.via);
		return { from, to, who: [...edge.who], via: edge.via };
	});
	const name = input.name.trim();
	if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "模板名称不能为空" });
	return { name, statuses, initial, edges };
}

export const taskWorkflowRouter = createTRPCRouter({
	// ────────────────────────────── 状态图模板 ──────────────────────────────

	/**
	 * 模板清单(`tc_workflow`)—— 既给「建任务」选模板,也给「流程模板」卡片页。
	 *
	 * **刻意不锁到流程模板页面码**:建任务弹窗与「我的任务」卡片页都在用它,锁到 `/task-close/workflows`
	 * 会把「有任务页、没模板页」的人拦死(见 `lib/rbac.ts` 的 `UNMAPPED_QUERIES` 说明)。
	 * `builtin` 由服务端标好(内置模板前端不出「删除」),省得前端认 id。
	 */
	workflowList: protectedProcedure.query(async () => {
		const rows = await db
			.select()
			.from(taskWorkflowTable)
			.where(alive(taskWorkflowTable))
			.orderBy(asc(taskWorkflowTable.created_at));
		return rows.map((row: WorkflowRow) => ({
			id: row.id,
			name: (row.payload as WorkflowPayload).name ?? row.id,
			payload: row.payload as WorkflowPayload,
			builtin: row.id === DEFAULT_WORKFLOW_ID,
			createdAt: row.created_at ? row.created_at.toISOString() : null,
			updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
		}));
	}),

	/** 新建模板 —— 校验后整份写进 `payload` */
	workflowCreate: protectedProcedure.input(workflowInput).mutation(async ({ input }) => {
		const id = newId();
		const now = new Date();
		await db.insert(taskWorkflowTable).values({
			id,
			payload: normalizeWorkflow(input),
			created_at: now,
			updated_at: now,
		});
		return { id };
	}),

	/**
	 * 编辑模板 —— 整份替换 `payload`。
	 *
	 * **已建任务不受影响**:它们的状态图是创建时从 `payload` 复制的快照(`tc_task.workflow`)。
	 */
	workflowUpdate: protectedProcedure.input(workflowInput.extend({ id: ID })).mutation(async ({ input }) => {
		const [row] = await db
			.select({ id: taskWorkflowTable.id })
			.from(taskWorkflowTable)
			.where(and(eq(taskWorkflowTable.id, input.id), alive(taskWorkflowTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		await db
			.update(taskWorkflowTable)
			.set({ payload: normalizeWorkflow(input), updated_at: new Date() })
			.where(eq(taskWorkflowTable.id, row.id));
		return { ok: true };
	}),

	/**
	 * 软删模板 —— **内置默认模板不允许删**(删光了建任务就没模板可选)。
	 * 已建任务存的是快照,删模板不影响它们推进。
	 */
	workflowRemove: protectedProcedure.input(z.object({ id: ID })).mutation(async ({ input }) => {
		if (input.id === DEFAULT_WORKFLOW_ID) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "内置默认模板不能删除" });
		}
		const [row] = await db
			.select({ id: taskWorkflowTable.id })
			.from(taskWorkflowTable)
			.where(and(eq(taskWorkflowTable.id, input.id), alive(taskWorkflowTable)))
			.limit(1);
		if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "流程模板不存在" });
		await db
			.update(taskWorkflowTable)
			.set({ ...softDeleted(), updated_at: new Date() })
			.where(eq(taskWorkflowTable.id, row.id));
		return { ok: true };
	}),
});
