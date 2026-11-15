import { useState } from "react";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";

/**
 * 「破坏性操作的二次确认」状态机 —— 7 处手写 `useState<T|null> + open + onOpenChange` 收成一处。
 *
 * 用法:
 * ```tsx
 * const del = useConfirm<{ id: string; name: string }>();
 * <ActionButton onClick={() => del.ask(row)}>删除</ActionButton>
 * <del.Dialog
 *   title="删除模板"
 *   description={(t) => `「${t.name}」会被软删`}
 *   isPending={mutation.isPending}
 *   onConfirm={(t) => mutation.mutate({ id: t.id })}
 * />
 * ```
 * 关闭时机由调用方控制:`onConfirm` 成功后调 `del.dismiss()`(或用返回的 promise)。
 */
export function useConfirm<T>() {
	const [target, setTarget] = useState<T | null>(null);

	function Dialog({
		title,
		description,
		confirmText,
		isPending,
		pendingText,
		confirmVariant,
		onConfirm,
	}: {
		title: string;
		description: (target: T) => string;
		confirmText?: string;
		isPending?: boolean;
		pendingText?: string;
		confirmVariant?: "destructive" | "default" | "outline";
		onConfirm: (target: T) => void;
	}) {
		return (
			<ConfirmDialog
				open={target !== null}
				onOpenChange={(next) => {
					if (!next) setTarget(null);
				}}
				title={title}
				description={target === null ? "" : description(target)}
				confirmText={confirmText}
				isPending={isPending}
				pendingText={pendingText}
				confirmVariant={confirmVariant}
				onConfirm={() => {
					if (target !== null) onConfirm(target);
				}}
			/>
		);
	}

	return {
		/** 待确认的对象(`null` = 弹窗关闭) */
		target,
		/** 打开确认弹窗 */
		ask: (next: T) => setTarget(next),
		/** 关闭(成功后的回调里调) */
		dismiss: () => setTarget(null),
		Dialog,
	};
}
