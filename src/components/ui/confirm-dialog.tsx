import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

/**
 * 通用确认 Dialog —— 单条/批量删除等"危险操作确认"场景复用。
 * page/模块里不再重复写 Dialog 样板。
 *
 * 非删除类的二次确认传 `confirmVariant="default"` 与 `pendingText`,
 * 避免出现"红按钮 + 写着『删除中…』"这种串味文案。
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmText = "删除",
	isPending = false,
	pendingText = "删除中…",
	confirmVariant = "destructive",
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	title: string;
	description: string;
	confirmText?: string;
	isPending?: boolean;
	/** 提交中的按钮文案(默认「删除中…」) */
	pendingText?: string;
	/** 确认按钮样式:危险操作默认 destructive;正向操作传 default */
	confirmVariant?: "destructive" | "default" | "outline";
	onConfirm: () => void;
}) {
	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onOpenChange(false);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button variant={confirmVariant} onClick={onConfirm} disabled={isPending}>
						{isPending ? pendingText : confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
