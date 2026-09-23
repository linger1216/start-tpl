import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import type { SettingsDictRow } from "./settings-dictionary-types";

export type SettingsDictCallbacks = {
	onEdit: (row: SettingsDictRow) => void;
	onToggle: (row: SettingsDictRow) => void;
	onDelete: (row: SettingsDictRow) => void;
};

/**
 * 字段管理表格(字典列表)—— `sys_dict` 一行一个字典。
 * 「字典项」列只展示前几项做抽样,完整内容在编辑弹窗里看。
 */
export function SettingsDictionaryTable({
	rows,
	busyId,
	callbacks,
}: {
	rows: readonly SettingsDictRow[];
	busyId: string | null;
	callbacks: SettingsDictCallbacks;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="min-w-40">字典名称</TableHead>
					<TableHead className="min-w-44">字典编码</TableHead>
					<TableHead className="min-w-[18rem]">字典项(label = value)</TableHead>
					<TableHead className="min-w-20">项数</TableHead>
					<TableHead className="min-w-24">状态</TableHead>
					<TableHead className="min-w-56">说明</TableHead>
					<TableHead className="min-w-44">操作</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.length === 0 ? (
					<TableRow>
						<TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
							还没有字典。点右上角「新建字典」建一个(例:档案类型 entity_category)。
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<TableRow key={row.id}>
							<TableCell className="text-[13px] font-medium text-foreground">{row.name}</TableCell>
							<TableCell translate="no" className="font-mono text-[12px] text-muted-foreground">
								{row.code}
							</TableCell>
							<TableCell>
								<div className="flex flex-wrap items-center gap-1">
									{row.items.slice(0, 4).map((item) => (
										<Badge key={item.value} variant="outline" className="gap-1 text-[11.5px]">
											{item.label}
											<span translate="no" className="font-mono text-[10.5px] text-muted-foreground">
												{item.value}
											</span>
										</Badge>
									))}
									{row.items.length > 4 ? (
										<span className="text-[11.5px] text-muted-foreground">等 {row.items.length} 项</span>
									) : null}
									{row.items.length === 0 ? <span className="text-[12px] text-muted-foreground">—</span> : null}
								</div>
							</TableCell>
							<TableCell className="tabular-nums text-[12.5px] text-muted-foreground">{row.items.length}</TableCell>
							<TableCell>
								<Badge variant={row.status === 1 ? "secondary" : "outline"} className="text-[11.5px]">
									{row.status === 1 ? "启用" : "停用"}
								</Badge>
							</TableCell>
							<TableCell>
								<span className="line-clamp-2 max-w-64 text-[12.5px] text-muted-foreground" title={row.remark ?? ""}>
									{row.remark || "—"}
								</span>
							</TableCell>
							<TableCell>
								<div className="flex flex-wrap items-center gap-3">
									<ActionButton aria-label={`编辑字典 ${row.name}`} onClick={() => callbacks.onEdit(row)}>
										编辑
									</ActionButton>
									<ActionButton
										aria-label={row.status === 1 ? `停用字典 ${row.name}` : `启用字典 ${row.name}`}
										title={row.status === 1 ? "停用这个字典" : "启用这个字典"}
										onClick={() => callbacks.onToggle(row)}
									>
										{row.status === 1 ? "停用" : "启用"}
									</ActionButton>
									<ActionButton
										tone="danger"
										aria-label={`删除字典 ${row.name}`}
										disabled={busyId === row.id}
										onClick={() => callbacks.onDelete(row)}
									>
										删除
									</ActionButton>
								</div>
							</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
