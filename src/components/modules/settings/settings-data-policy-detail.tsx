import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Badge } from "#/components/ui/badge";
import { DetailRow } from "#/components/ui/detail-row";
import {
	ACTION_LABEL,
	EFFECT_LABEL,
	type PolicyRowView,
	RESOURCE_KIND_LABEL,
	SUBJECT_KIND_LABEL,
} from "#/lib/data-policy-spec";
import { EffectBadge, SubjectKindBadge } from "./settings-data-policy-badges";

/**
 * 规则详情(只读)。
 *
 * 为什么要有它:列表里全是人话,而**真正写进库的是什么**才是排障时要看的东西 ——
 * `user:xxx` / `demo_grid@org:yyy` 这两个串能直接拿去写 SQL、发工单、跟日志里的
 * `policy.scope` / `policy.denied` 对上。所以详情里原始串与 `id` **一个都不省**。
 */
export function SettingsDataPolicyDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	/** null = 没有选中行(关闭态) */
	row: PolicyRowView | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: PolicyRowView) => void;
}) {
	return (
		<DetailDialog
			open={open}
			meta={row}
			onOpenChange={onOpenChange}
			title="数据权限规则详情"
			badge={
				row ? (
					<>
						<SubjectKindBadge kind={row.subjectKind} />
						<EffectBadge effect={row.effect} />
						<Badge variant={row.status === 1 ? "secondary" : "outline"} className="text-xs">
							{row.status === 1 ? "启用" : "停用"}
						</Badge>
					</>
				) : null
			}
			onEdit={() => row && onEdit(row)}
		>
			{row ? (
				<div className="flex flex-col gap-0">
					<DetailRow label="谁">
						{SUBJECT_KIND_LABEL[row.subjectKind]} · {row.subjectLabel}
					</DetailRow>
					<DetailRow label="主体串">
						<span translate="no" className="font-mono text-xs">
							{row.subjectRaw}
						</span>
					</DetailRow>
					<DetailRow label="看什么">
						{RESOURCE_KIND_LABEL[row.resourceKind]} · {row.resourceTypeLabel}
						{row.resourceDetail ? ` ▸ ${row.resourceDetail}` : ""}
					</DetailRow>
					<DetailRow label="资源串">
						<span translate="no" className="font-mono text-xs">
							{row.resourceRaw}
						</span>
					</DetailRow>
					<DetailRow label="动作">{ACTION_LABEL[row.action] ?? row.action}</DetailRow>
					<DetailRow label="效果">
						{EFFECT_LABEL[row.effect]}
						{row.effect === "deny" ? "(从可见集合里减去这个范围)" : ""}
					</DetailRow>
					<DetailRow label="状态">{row.status === 1 ? "启用(status = 1)" : "停用(status = 0)"}</DetailRow>
					<DetailRow label="说明">
						<span className="text-sm">{row.remark || "—"}</span>
					</DetailRow>
					<DetailRow label="ID">
						<span translate="no" className="font-mono text-xs text-muted-foreground">
							{row.id}
						</span>
					</DetailRow>
				</div>
			) : null}
		</DetailDialog>
	);
}
