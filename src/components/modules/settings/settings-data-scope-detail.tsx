import { PolicyStatusTag } from "#/components/modules/settings/policy-status-tag";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
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
			tag={row ? <PolicyStatusTag status={row.status} /> : null}
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
							<Tag translate="no" variant="outline" className="font-mono text-xs">
								{row.subject}
							</Tag>
						</div>
					</DetailRow>
					<DetailRow label="资源表">
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="text-sm">{row.resourceLabel}</span>
							<Tag translate="no" variant="outline" className="font-mono text-xs">
								{row.resource}
							</Tag>
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
								<Tag translate="no" variant="outline" className="font-mono text-xs">
									{row.column}
								</Tag>
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
								<Tag translate="no" variant="outline" className="font-mono text-xs">
									{row.pluginKey}
								</Tag>
							</div>
						) : (
							<span className="text-sm text-muted-foreground">不用插件</span>
						)}
					</DetailRow>
					<DetailRow label="说明">
						<span className="text-sm">{row.remark || "—"}</span>
					</DetailRow>
					{/* 创建 / 更新时间由 DetailDialog 的 meta 统一渲染 —— 别在这里重复(files-detail 同款坑) */}
				</div>
			) : null}
		</DetailDialog>
	);
}
