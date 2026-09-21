import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { CONFIG_TYPE_META, type ConfigType } from "#/lib/sys-config";

export type ParameterRow = {
	key: string;
	value: string;
	defaultValue: string;
	type: ConfigType;
	group: string;
	remark: string;
	editable: boolean;
	overridden: boolean;
	updatedAt: string | null;
};

/** 类型 → 徽标配色(低饱和语义色,与全局色板一致) */
const TYPE_TONE: Record<ConfigType, string> = {
	string: "bg-secondary text-foreground",
	int: "bg-[color:var(--hue-blue-soft)] text-[color:var(--hue-blue-fg)]",
	bool: "bg-[color:var(--hue-teal-soft)] text-[color:var(--hue-teal-fg)]",
	json: "bg-[color:var(--hue-violet-soft)] text-[color:var(--hue-violet-fg)]",
	array: "bg-[color:var(--hue-amber-soft)] text-[color:var(--hue-amber-fg)]",
	map: "bg-[color:var(--hue-rose-soft)] text-[color:var(--hue-rose-fg)]",
};

function previewValue(row: ParameterRow): string {
	if (row.type === "json" || row.type === "array" || row.type === "map") {
		try {
			return JSON.stringify(JSON.parse(row.value), null, 0);
		} catch {
			return row.value;
		}
	}
	return row.value;
}

/**
 * 参数清单 —— 每一行**自带说明**(参数最容易变成"不敢改的谜")。
 * 「来源」列区分"默认值"与"已改过",免得人分不清哪个是代码内置、哪个是自己调的。
 */
export function SettingsParametersTable({
	rows,
	onEdit,
	onDelete,
}: {
	rows: readonly ParameterRow[];
	onEdit: (row: ParameterRow) => void;
	onDelete: (row: ParameterRow) => void;
}) {
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="min-w-[14rem]">参数名</TableHead>
						<TableHead className="min-w-[8rem]">分组</TableHead>
						<TableHead className="min-w-[12rem]">当前值</TableHead>
						<TableHead className="min-w-[6rem]">类型</TableHead>
						<TableHead className="min-w-[22rem]">说明</TableHead>
						<TableHead className="min-w-[7rem]">来源</TableHead>
						<TableHead className="min-w-[8rem]">操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
								没有参数。跑一次 <span translate="no">pnpm db:seed:configs</span> 会把内置参数落到库里。
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<TableRow
								key={row.key}
								className="group/row transition-colors duration-150 hover:bg-[color:var(--af-hover)]"
							>
								<TableCell translate="no" className="font-mono text-[12px] text-foreground">
									{row.key}
								</TableCell>
								<TableCell>
									<Badge variant="secondary" className="text-[11.5px]">
										{row.group}
									</Badge>
								</TableCell>
								<TableCell
									translate="no"
									title={previewValue(row)}
									className="max-w-[16rem] truncate font-mono text-[12.5px] font-medium text-foreground"
								>
									{previewValue(row)}
								</TableCell>
								<TableCell>
									<Badge className={`text-[11px] ${TYPE_TONE[row.type]}`}>{CONFIG_TYPE_META[row.type].label}</Badge>
								</TableCell>
								<TableCell className="text-[12px] text-muted-foreground">{row.remark}</TableCell>
								<TableCell>
									{row.overridden ? (
										<Badge variant="outline" className="text-[11px]">
											已改过
										</Badge>
									) : (
										<Badge variant="outline" className="text-[11px] text-muted-foreground">
											默认值
										</Badge>
									)}
								</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										<Button
											variant="outline"
											size="xs"
											disabled={!row.editable}
											aria-label={`修改参数 ${row.key}`}
											className="text-muted-foreground hover:text-foreground"
											onClick={() => onEdit(row)}
										>
											<Pencil className="size-3" />
											修改
										</Button>
										<Button
											variant="outline"
											size="xs"
											disabled={!row.editable}
											aria-label={`删除参数 ${row.key}`}
											className="text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-destructive group-hover/row:opacity-100 focus-visible:opacity-100"
											onClick={() => onDelete(row)}
										>
											<Trash2 className="size-3" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
