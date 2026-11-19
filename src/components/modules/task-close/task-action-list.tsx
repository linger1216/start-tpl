import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BlockHeader, InspectorSection } from "#/components/modules/task-close/block-header";
import { useConfirm } from "#/components/modules/task-close/use-confirm";
import { ActionButton } from "#/components/ui/action-button";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";

type Action = { id: string; assigneeName: string | null };

/**
 * 动作记录 —— 每个还没结束的审批 / 征询一行,发起人可以撤回。
 *
 * 传进来的 `actions` 已经是「还活着、且我能撤回」的那几条(判据在调用点,见详情页),
 * 这里不再复筛一遍 —— 一处判据一处存。
 *
 * 这里只留「撤回」:手动催办已经退役(没有写方),「历史催办」是个永远空的弹窗。
 */
export function TaskActionList({ actions }: { actions: readonly Action[] }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const del = useConfirm<Action>();
	const withdraw = useMutation(
		trpc.taskClose.actionWithdraw.mutationOptions({
			onSuccess: async () => {
				del.dismiss();
				await client.invalidateQueries(trpc.taskClose.pathFilter());
				toast.success("动作已撤回");
			},
			onError: toastApiError,
		}),
	);
	if (!actions.length) return null;
	return (
		<>
			<InspectorSection>
				<BlockHeader title="动作记录" />
				<ul className="grid gap-2">
					{actions.map((action) => (
						<li key={action.id} className="flex items-center justify-between gap-2 text-sm">
							<span className="truncate">{action.assigneeName ?? "处理人"}</span>
							<ActionButton tone="danger" onClick={() => del.ask(action)}>
								撤回
							</ActionButton>
						</li>
					))}
				</ul>
			</InspectorSection>
			<del.Dialog
				title="撤回动作"
				description={() => "撤回后动作不能继续答复，尚未送达的提醒将取消。"}
				isPending={withdraw.isPending}
				onConfirm={(t) => withdraw.mutate({ id: t.id })}
			/>
		</>
	);
}
