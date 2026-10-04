import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { EnabledBadge } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { DetailRow } from "#/components/ui/detail-row";
import { formatLocalMinute } from "#/lib/time";
import type { PluginRow } from "./settings-data-plugins-table";

/**
 * 值域插件详情(只读)。
 *
 * 自定义插件要能把**完整清单**看完 —— 改了之后,这里就是审计入口;`key/value` 全列、不截断。
 *
 * v2 (m20034):不再有「函数体」段 —— 用户只能建「指定清单」类插件,清单内容存 `output_values` json。
 */
export function SettingsDataPluginsDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: PluginRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: PluginRow) => void;
}) {
	return (
		<DetailDialog
			open={open}
			meta={row}
			onOpenChange={onOpenChange}
			title={`插件详情 · ${row?.label ?? ""}`}
			badge={
				row ? (
					row.kind === "builtin" ? (
						<Badge variant="outline" className="text-xs">
							内置
						</Badge>
					) : (
						<EnabledBadge status={row.status} />
					)
				) : null
			}
			onEdit={() => row && onEdit(row)}
			editDisabled={row?.kind === "builtin"}
		>
			{row ? (
				<div className="flex flex-col gap-0">
					<DetailRow label="标识">
						<span translate="no" className="font-mono text-xs">
							{row.pluginKey}
						</span>
					</DetailRow>
					<DetailRow label="实现">{row.kind === "builtin" ? "内置(写在代码里)" : "自定义指定清单"}</DetailRow>
					<DetailRow label="说明">
						<span className="text-sm">{row.remark || "—"}</span>
					</DetailRow>
					<DetailRow label="创建时间">{formatLocalMinute(row.createdAt) || "—"}</DetailRow>
					<DetailRow label="更新时间">{formatLocalMinute(row.updatedAt) || "—"}</DetailRow>
					{row.kind === "custom" ? (
						<div className="space-y-1.5 pt-2">
							<div className="text-xs font-medium text-muted-foreground">输出值({row.outputValues.length} 行)</div>
							{row.outputValues.length === 0 ? (
								<p className="text-xs text-muted-foreground">清单是空的 —— 用了它的规则会取到 0 行。</p>
							) : (
								<div className="overflow-hidden rounded-lg border border-border bg-muted">
									<div className="grid grid-cols-[1fr_2fr] border-b border-border bg-muted/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
										<span>key</span>
										<span>value</span>
									</div>
									{row.outputValues.map((it, idx) => (
										<div
											// biome-ignore lint/suspicious/noArrayIndexKey: 只读视图;清单内容稳定,不重排
											key={`detail-item-row-${idx}`}
											className="grid grid-cols-[1fr_2fr] border-b border-border/50 px-3 py-1.5 text-xs last:border-b-0"
										>
											<span translate="no" className="truncate font-mono">
												{it.key}
											</span>
											<span translate="no" className="truncate font-mono">
												{it.value}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					) : null}
				</div>
			) : null}
		</DetailDialog>
	);
}
