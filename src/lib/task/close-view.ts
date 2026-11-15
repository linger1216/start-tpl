import { trpcErrorCode } from "#/lib/api/error";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { roleLabelOf, statusLabelOf, type WorkflowStatus } from "#/lib/task/close-spec";

type Member = { userId: string; name: string | null };
type Action = {
	id: string;
	rootActionId: string | null;
	creatorName: string | null;
	status: string;
	isLocking: boolean;
	fromStatus: string | null;
	toStatus: string | null;
};

export function peopleOptionsOf(input: {
	creatorId: string;
	creatorName: string | null;
	/** 执行人是任务列;传入后在候选里单列一行(与创建人重复时去重) */
	executorId?: string | null;
	executorName?: string | null;
	members: readonly Member[];
	meId: string;
	isAdmin: boolean;
}) {
	const list = [
		{ value: input.creatorId, label: input.creatorName ?? "创建人", hint: roleLabelOf("creator") },
		...(input.executorId
			? [{ value: input.executorId, label: input.executorName ?? input.executorId, hint: roleLabelOf("executor") }]
			: []),
		...input.members.map((row) => ({
			value: row.userId,
			label: row.name ?? row.userId,
			hint: roleLabelOf("participant"),
		})),
	];
	const seen = new Set<string>();
	return list.filter((option) => {
		if (option.value === input.meId && !input.isAdmin) return false;
		if (seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	});
}

/**
 * 「轮到你了」的待办条目。
 *
 * `pending` 必须是**已经筛好的**:指给我、且还 `active` 的那几条(筛法在详情页,与服务端
 * 「有没有轮到我的动作」同一判据)。所以这里不再判 `status` —— 进来的都待答复。
 */
export function todoItemsOf(pending: readonly Action[], all: readonly Action[], statuses: WorkflowStatus[]) {
	return pending.map((row) => {
		const root = all.find((item) => item.id === row.rootActionId);
		return {
			id: row.id,
			title:
				row.isLocking && root?.toStatus
					? `${row.creatorName ?? PLACEHOLDER_EMPTY} 发起 ${statusLabelOf(statuses, root.fromStatus ?? "")} → ${statusLabelOf(statuses, root.toStatus)}`
					: `${row.creatorName ?? PLACEHOLDER_EMPTY} 发起征询`,
			consult: !row.isLocking,
		};
	});
}

export function orderHintOf(
	mode: "approve" | "consult" | null,
	ids: readonly string[],
	people: readonly { value: string; label: string }[],
	target?: string,
) {
	if (!ids.length)
		return {
			names: [],
			text: mode === "approve" ? "选好审批人后,这里会显示他们审批的先后顺序。" : "选好后,这里会显示征询的先后顺序。",
		};
	const names = ids.map((id) => people.find((person) => person.value === id)?.label ?? id);
	const destination = target ?? "目标状态";
	return {
		names,
		text:
			mode === "approve"
				? ids.length > 1
					? `这 ${ids.length} 位会依次审批,全部通过后进入「${destination}」;任一人驳回就退回当前状态。`
					: `通过后进入「${destination}」;驳回则退回当前状态。`
				: `${ids.length} 位会依次收到征询,先选的人先收到。`,
	};
}

/**
 * tRPC 错误 → 「这条任务不存在 / 没权限」的分类。
 *
 * 三种判据都认一遍(实测口径,见 `lib/api/error.trpcErrorCode`):`data.code` 是字符串键、
 * `shape.code` 是数字码 `-32004`、`data.httpStatus` 是 403/404。都认不出来就当普通报错。
 */
export function isForbiddenError(error: unknown): boolean {
	const httpStatus = (error as { data?: { httpStatus?: unknown } } | null)?.data?.httpStatus;
	return trpcErrorCode(error) === "FORBIDDEN" || httpStatus === 403;
}

export function isNotFoundError(error: unknown): boolean {
	const err = error as { data?: { httpStatus?: unknown }; shape?: { code?: unknown } } | null;
	return trpcErrorCode(error) === "NOT_FOUND" || err?.shape?.code === -32004 || err?.data?.httpStatus === 404;
}
