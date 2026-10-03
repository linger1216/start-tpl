import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Badge } from "#/components/ui/badge";
import { DetailRow } from "#/components/ui/detail-row";
import { formatLocalMinute } from "#/lib/time";
import { type DataScopeRow, ruleShapeText } from "./settings-data-scope-table";

/**
 * 数据范围规则详情(只读)。
 *
 * 字段与 `sys_data_policy` 一一对应,外加把主体 / 资源 / 列 / 插件翻译成人话的四个标签 ——
 * 规则行里存的是 id,光看 id 看不出这条规则到底放开了谁。
 */
export function SettingsDataScopeDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: DataScopeRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: DataScopeRow) => void;
}) {
	return (
		<DetailDialog
			open={open}
			meta={row}
			onOpenChange={onOpenChange}
			title={`规则详情 · ${row?.subjectLabel ?? ""}`}
			badge={
				row ? (
					<Badge variant={Number(row.status) === 1 ? "secondary" : "outline"} className="text-xs">
						{Number(row.status) === 1 ? "启用" : "停用"}
					</Badge>
				) : null
			}
			onEdit={() => row && onEdit(row)}
		>
			{row ? (
				<div className="flex flex-col gap-0">
					<DetailRow label="ID">
						<span translate="no" className="font-mono text-xs">
							{row.id}
						</span>
					</DetailRow>
					<DetailRow label="主体">
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="text-sm">{row.subjectLabel}</span>
							<Badge translate="no" variant="outline" className="font-mono text-[10px]">
								{row.subject}
							</Badge>
						</div>
					</DetailRow>
					<DetailRow label="资源表">
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="text-sm">{row.resourceLabel}</span>
							<Badge translate="no" variant="outline" className="font-mono text-[10px]">
								{row.resource}
							</Badge>
						</div>
					</DetailRow>
					<DetailRow label="判据">
						<span translate="no" className="font-mono text-xs">
							{ruleShapeText(row)}
						</span>
					</DetailRow>
					<DetailRow label="判据列">
						{row.column ? (
							<div className="flex flex-wrap items-center gap-1.5">
								<span className="text-sm">{row.columnLabel}</span>
								<Badge translate="no" variant="outline" className="font-mono text-[10px]">
									{row.column}
								</Badge>
							</div>
						) : (
							<span className="text-sm text-muted-foreground">
								{row.pluginKey ? "不用列(插件直接给行)" : "不用列(整类可见)"}
							</span>
						)}
					</DetailRow>
					<DetailRow label="值域插件">
						{row.pluginKey ? (
							<div className="flex flex-wrap items-center gap-1.5">
								<span className="text-sm">{row.pluginLabel}</span>
								<Badge translate="no" variant="outline" className="font-mono text-[10px]">
									{row.pluginKey}
								</Badge>
							</div>
						) : (
							<span className="text-sm text-muted-foreground">不用插件</span>
						)}
					</DetailRow>
					<DetailRow label="说明">
						<span className="text-sm">{row.remark || "—"}</span>
					</DetailRow>
					<DetailRow label="创建时间">{formatLocalMinute(row.createdAt) || "—"}</DetailRow>
					<DetailRow label="更新时间">{formatLocalMinute(row.updatedAt) || "—"}</DetailRow>
				</div>
			) : null}
		</DetailDialog>
	);
}
