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
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 记录详情 —— 只读弹窗的**统一外壳**。
 *
 * 为什么收成一个组件:参数 / 字典 / 角色 / 用户四个台账页都要"点详情看全字段",
 * 而外壳(对话框 + 标题 + 描述 + 底部「关闭 / 编辑」)完全一样,只有字段不同。
 * 各页手写会漂移(有的把编辑按钮写成主色、有的干脆没有),违背「同类页面必须同形」。
 *
 * **字段由各页自己内联**(`ui/detail-row` 的 `DetailRow` + 一个两列 grid,想放徽章列表 /
 * 完整 JSON / 自定义块都随意)—— 不再提供一个 `fields={[...]}` 的声明式封装:
 * 那样每遇到"这个字段要特殊渲染"(部门/角色要徽章、长文本要 pre)就得给封装加参数,
 * 加到最后反而比内联难读。
 */
export type DetailMetaInfo = {
	createdAt?: string | null;
	updatedAt?: string | null;
};

/**
 * 底部时间行 —— 创建于 / 更新于,**灰色并排一行**(详情和编辑页共用,保证位置与口径统一)。
 *
 * 哪一边不显示 — 而不是显示 epoch 0 或 "—" —— 是想让你看出"这条记录还没被改过 / 创建过"。
 * 真正全空的两条才都不显示(让"刚被插入但没时间戳"那种角落情况保持沉默,而不是显示两个 —)。
 */
export function DetailMeta({ meta, className }: { meta?: DetailMetaInfo | null; className?: string }) {
	if (!meta) return null;
	const created = meta.createdAt ? formatLocalMinute(meta.createdAt) : null;
	const updated = meta.updatedAt ? formatLocalMinute(meta.updatedAt) : null;
	if (!created && !updated) return null;
	return (
		<div className={cn("flex flex-wrap items-center flex-1 gap-x-4 text-xs", className)}>
			{created ? <span>创建于 {created}</span> : null}
			{created && updated ? <span aria-hidden>·</span> : null}
			{updated ? <span>更新于 {updated}</span> : null}
		</div>
	);
}

export function DetailDialog({
	open,
	onOpenChange,
	title,
	description,
	badge,
	children,
	onEdit,
	editDisabled,
	editLabel = "编辑",
	footerExtra,
	meta,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	title: ReactNode;
	description?: ReactNode;
	/** 标题右侧的状态 / 类型徽章 */
	badge?: ReactNode;
	children: ReactNode;
	/** 给了就在底部渲染主操作(通常是「编辑」);不给就只有「关闭」 */
	onEdit?: () => void;
	editDisabled?: boolean;
	editLabel?: string;
	/** 底部额外的动作按钮(排在「关闭」与主操作之间),页面自己组合 */
	footerExtra?: ReactNode;
	/** 创建 / 更新时间 —— 渲染在字段网格与底部按钮之间,灰色并排 */
	meta?: DetailMetaInfo | null;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle className="flex flex-wrap items-center gap-2">
						{title}
						{badge}
					</DialogTitle>
					{description ? <DialogDescription>{description}</DialogDescription> : null}
				</DialogHeader>
				<DialogBody className="space-y-4 pr-1">{children}</DialogBody>
				{meta ? <DetailMeta meta={meta} /> : null}
				<DialogFooter className="gap-2">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
					{footerExtra}
					{onEdit ? (
						<Button
							disabled={editDisabled}
							onClick={() => {
								onOpenChange(false);
								onEdit();
							}}
						>
							{editLabel}
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
