import { Eye, Pencil, Trash2 } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { PARA_TYPE, PARA_TYPE_META, type ParaType } from "#/lib/para-spec";

/**
 * 参数清单的一行 —— **字段与 `sys_para` 表一一对应**(+ 代码内置默认值的兜底):
 * `key`→`para_key`、`value`→`para_value`、`type`→`para_type`、`group`→`para_group`、
 * `remark`、`status`、`editable`、`updatedAt`→`update_time`。
 * 表里没有的派生字段(如"是默认值还是已改过")不要加回来 —— 界面上不该出现库里没有的列。
 */
export type ParameterRow = {
	key: string;
	value: string;
	type: ParaType;
	group: string;
	remark: string;
	editable: boolean;
	status: number;
	updatedAt: string | null;
};

/** 类型 → 徽标配色(低饱和语义色,与全局色板一致) */
/** 类型码 → 徽标配色(键必须与 `para_type` 的码一致:1 int / 2 bool / 3 string / 4 json) */
const TYPE_TONE: Record<ParaType, string> = {
	[PARA_TYPE.INT]: "bg-hue-blue-soft text-hue-blue-fg",
	[PARA_TYPE.BOOL]: "bg-hue-teal-soft text-hue-teal-fg",
	[PARA_TYPE.STRING]: "bg-secondary text-foreground",
	[PARA_TYPE.JSON]: "bg-hue-violet-soft text-hue-violet-fg",
};

function previewValue(row: ParameterRow): string {
	if (row.type === PARA_TYPE.JSON) {
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
 * 列只放 `sys_para` 里真有的东西:参数名 / 分组 / 当前值 / 类型 / 说明 / 操作。
 * 「来源:默认值 or 已改过」是**库里没有的派生概念**,已删除 —— 要看它是内置还是自建,
 * 看「说明」列即可(代码内置参数的说明来自 `PARA_DEFAULTS`)。
 */
export function SettingsParametersTable({
	rows,
	onView,
	onEdit,
	onDelete,
}: {
	rows: readonly ParameterRow[];
	/** 详情(只读弹窗)—— 值被截断、说明只有一行时,靠它看全 */
	onView: (row: ParameterRow) => void;
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
						<TableHead className="min-w-[13rem]">操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
								没有参数。跑一次 <span translate="no">pnpm db:seed:paras</span> 会把内置参数落到库里。
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<TableRow key={row.key} className="group/row transition-colors duration-150 hover:bg-hover">
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
									<Badge className={`text-[11px] ${TYPE_TONE[row.type]}`}>{PARA_TYPE_META[row.type].label}</Badge>
								</TableCell>
								<TableCell className="text-[12px] text-muted-foreground">{row.remark}</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										<Button
											variant="outline"
											size="xs"
											aria-label={`查看参数 ${row.key} 详情`}
											className="text-muted-foreground hover:text-foreground"
											onClick={() => onView(row)}
										>
											<Eye className="size-3" />
											详情
										</Button>
										<Button
											variant="outline"
											size="xs"
											disabled={!row.editable}
											aria-label={`编辑参数 ${row.key}`}
											className="text-muted-foreground hover:text-foreground"
											onClick={() => onEdit(row)}
										>
											<Pencil className="size-3" />
											编辑
										</Button>
										<Button
											variant="outline"
											size="xs"
											disabled={!row.editable}
											aria-label={`删除参数 ${row.key}`}
											// 与「详情 / 编辑」一致地给出文字标签:只放图标时,这行操作要 hover 才知道是什么
											className="text-muted-foreground transition-colors duration-150 hover:border-destructive/40 hover:text-destructive"
											onClick={() => onDelete(row)}
										>
											<Trash2 className="size-3" />
											删除
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
