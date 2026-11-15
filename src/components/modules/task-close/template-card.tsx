import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "#/components/layout/empty-state";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { AsyncState } from "#/components/modules/task-close/async-state";
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
				<div className="flex flex-wrap gap-3">{cards}</div>
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
		<Card className="group relative flex h-full w-full max-w-sm cursor-pointer flex-col gap-0 bg-card p-5 transition-[border-color] hover:border-primary/50">
			<button
				type="button"
				aria-label={viewLabel}
				onClick={onView}
				className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
			/>
			<div className="relative mb-4 flex items-start justify-between gap-2">
				<div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-primary">{icon}</div>
				<div className="flex items-center gap-1.5">
					{badge}
					<div className="relative z-10 flex items-center gap-1">
						{canEdit ? (
							<Button variant="ghost" size="icon-sm" aria-label="编辑" onClick={onEdit}>
								<Pencil className="size-4" />
							</Button>
						) : null}
						{canRemove ? (
							<Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除" onClick={onDelete}>
								<Trash2 className="size-4" />
							</Button>
						) : null}
					</div>
				</div>
			</div>
			<h3 className="mb-1 line-clamp-1 text-base font-semibold text-foreground">{name}</h3>
			<p className="mb-3 text-xs leading-relaxed text-muted-foreground">{description}</p>
			<div className="mb-3 max-h-24 overflow-hidden rounded-md bg-muted/50 p-3">{preview}</div>
			<div className="mt-auto flex flex-wrap items-center gap-1.5">{meta}</div>
		</Card>
	);
}
