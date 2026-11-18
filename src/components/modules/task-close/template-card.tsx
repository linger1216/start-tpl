import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "#/components/layout/empty-state";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { AsyncState } from "#/components/modules/task-close/async-state";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { RefreshButton } from "#/components/ui/refresh-button";

/** 两类模板页共用加载、空态和页面操作。 */
export function TemplateCardPageShell({
	title,
	description,
	stats,
	emptyIcon,
	emptyDescription,
	isEmpty,
	isPending,
	isError,
	isFetching,
	canAdd,
	onCreate,
	onRefresh,
	cards,
	children,
}: {
	title: string;
	description: string;
	stats: StatItem[];
	emptyIcon: ReactNode;
	emptyDescription: string;
	isEmpty: boolean;
	isPending: boolean;
	isError: boolean;
	isFetching: boolean;
	canAdd: boolean;
	onCreate: () => void;
	onRefresh: () => void;
	cards: ReactNode;
	children: ReactNode;
}) {
	const createButton = canAdd ? (
		<Button onClick={onCreate}>
			<Plus className="size-4" />
			新增模板
		</Button>
	) : undefined;
	return (
		<PageFrame>
			<PageHeader
				title={title}
				description={description}
				actions={
					<>
						<RefreshButton busy={isFetching} onClick={onRefresh} />
						{createButton}
					</>
				}
			/>
			<StatCards items={stats} />
			{isPending || isError || isEmpty ? (
				<Card>
					<AsyncState
						pending={isPending}
						error={isError ? { message: `${title}加载失败。` } : undefined}
						isFetching={isFetching}
						onRetry={onRefresh}
						empty={
							isEmpty ? (
								<EmptyState
									icon={emptyIcon}
									title={`还没有${title}`}
									description={emptyDescription}
									actions={createButton}
								/>
							) : null
						}
					/>
				</Card>
			) : (
				/* 有数据时卡片直接铺在页面上 —— 不套外层 Card(白底套白底会糊成一整块通栏宽面板) */
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{cards}</div>
			)}
			{children}
		</PageFrame>
	);
}

/** 模板卡片共享可访问的查看覆盖层、操作和版式。 */
export function TemplateCard({
	name,
	viewLabel,
	icon,
	badge,
	description,
	preview,
	meta,
	canEdit,
	canRemove,
	onView,
	onEdit,
	onDelete,
}: {
	name: string;
	viewLabel: string;
	icon: ReactNode;
	badge: ReactNode;
	description: ReactNode;
	preview: ReactNode;
	meta: ReactNode;
	canEdit: boolean;
	canRemove: boolean;
	onView: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<Card className="group relative flex h-48 min-w-0 cursor-pointer flex-col gap-0 bg-card p-4 transition-[border-color] hover:border-primary/50">
			<button
				type="button"
				aria-label={viewLabel}
				onClick={onView}
				className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
			/>
			<div className="flex min-w-0 items-start justify-between gap-3">
				<h3 className="min-w-0 flex-1 line-clamp-2 text-lg leading-snug font-semibold text-foreground">{name}</h3>
				<span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft text-primary">{icon}</span>
			</div>
			<div className="mt-2 flex min-h-7 items-center justify-between gap-2">
				{badge}
				<div className="relative z-10 flex shrink-0 items-center gap-3">
					{canEdit && <ActionButton onClick={onEdit}>编辑</ActionButton>}
					{canRemove && (
						<ActionButton tone="danger" onClick={onDelete}>
							删除
						</ActionButton>
					)}
				</div>
			</div>
			<p className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
			<div className="mt-1 min-h-0 flex-1 overflow-hidden">{preview}</div>
			<div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2 text-xs text-muted-foreground">
				{meta}
			</div>
		</Card>
	);
}
