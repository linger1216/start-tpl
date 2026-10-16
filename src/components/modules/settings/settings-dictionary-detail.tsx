import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { EnabledTag } from "#/components/modules/shared/table-kit";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
import type { SettingsDictRow } from "./settings-dictionary-table";

/**
 * 字典详情(只读)。
 *
 * 清单页的「字典项」只抽样前几项,这里把**整份字典项与全部列**摊开。
 * 字段与 `sys_dict` 一一对应,不放派生字段。
 */
export function SettingsDictionaryDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: SettingsDictRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: SettingsDictRow) => void;
}) {
	return (
		<DetailDialog
			open={open}
			meta={{ createdAt: row?.createTime ?? null, updatedAt: row?.updateTime ?? null }}
			onOpenChange={onOpenChange}
			title={`字典详情 · ${row?.name ?? ""}`}
			description={<span className="font-mono">{row?.code ?? ""}</span>}
			tag={row ? <EnabledTag status={row.status} /> : null}
			onEdit={() => row && onEdit(row)}
		>
			{row ? (
				<>
					<div className="flex flex-col gap-0">
						<DetailRow label="ID">
							<span className="font-mono text-xs">{row.id}</span>
						</DetailRow>
						<DetailRow label="字典名称">
							<span className="text-sm font-medium">{row.name}</span>
						</DetailRow>
						<DetailRow label="字典编码">
							<span className="font-mono text-xs">{row.code}</span>
						</DetailRow>
						{/* 项数是派生值:用「N 项」胶囊,和下面那份真实清单对得上 */}
						<DetailRow label="项数">
							<Tag variant="secondary" className="tabular-nums text-xs">
								{row.items.length} 项
							</Tag>
						</DetailRow>
						<DetailRow label="说明">
							<span className="text-sm">{row.remark || "—"}</span>
						</DetailRow>
					</div>
					<div className="space-y-1.5">
						<div className="text-xs font-medium text-muted-foreground">字典项(顺序即下拉顺序)</div>
						{row.items.length === 0 ? (
							<p className="text-sm text-muted-foreground">(还没有项)</p>
						) : (
							<ol className="space-y-1">
								{row.items.map((item, index) => (
									<li
										key={item.value}
										className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs"
									>
										<span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
											{index + 1}
										</span>
										<span className="font-mono text-xs text-muted-foreground">{item.value}</span>
										<span className="truncate text-foreground">{item.label}</span>
									</li>
								))}
							</ol>
						)}
					</div>
				</>
			) : null}
		</DetailDialog>
	);
}
