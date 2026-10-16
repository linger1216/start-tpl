import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

/**
 * 任务交互弹窗外壳(模块私有,不进 shared)—— 详情页 6 个表单型弹窗
 * (改状态 / 转交 / 发起审批·征询 / 加入成员 / 附件 / 驳回)的**同一骨架**在这里收口:
 * DialogContent(lg + DIALOG_FIT)→ Header(title + 可省略 description)→ Body(默认 `space-y-1 py-1`)→
 * Footer(取消 ghost disabled=pending · 动作按钮 disabled=pending||confirmDisabled,文案 pending?"X中…":confirmText)。
 * 各弹窗只剩 title / description / 字段区 / 提交判据 / 两个文案。
 */
export function TaskActionDialog({
	open,
	onOpenChange,
	title,
	description,
	pending,
	confirmDisabled,
	confirmText,
	pendingText,
	onConfirm,
	bodyClassName,
	children,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	title: string;
	/** 没有说明的弹窗(如「加入成员」)传 undefined */
	description?: ReactNode;
	pending: boolean;
	confirmDisabled: boolean;
	confirmText: string;
	pendingText: string;
	onConfirm: () => void;
	/** 默认 `space-y-1 py-1`(Select / SearchSelect 行);Picker 类传空串吃掉默认 */
	bodyClassName?: string;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-lg`}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description ? <DialogDescription>{description}</DialogDescription> : null}
				</DialogHeader>
				<DialogBody className={bodyClassName ?? "space-y-1 py-1"}>{children}</DialogBody>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button disabled={pending || confirmDisabled} onClick={onConfirm}>
						{pending ? pendingText : confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
