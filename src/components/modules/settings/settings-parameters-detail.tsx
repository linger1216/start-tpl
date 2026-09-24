import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Badge } from "#/components/ui/badge";
import { DetailRow } from "#/components/ui/detail-row";
import { PARA_TYPE_META } from "#/lib/para-spec";
import type { ParameterRow } from "./settings-parameters-table";

/**
 * 参数详情(只读)。
 *
 * 为什么要有它:清单页的「当前值」被截断、「说明」只有一行 —— 想看清楚一条参数到底长什么样
 * (完整值、类型口径、能不能改、什么时候改的),得有个地方能完整看一遍。
 * 展示的字段**与 `sys_para` 表一一对应**(10 列一个不少),不放任何派生字段。
 */
export function SettingsParametersDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	/** null = 没有选中行(关闭态) */
	row: ParameterRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: ParameterRow) => void;
}) {
	return (
		<DetailDialog
			open={open}
			meta={row}
			onOpenChange={onOpenChange}
			title={`参数详情 · ${row?.key ?? ""}`}
			badge={
				row ? (
					<>
						<Badge variant="secondary" className="font-mono text-[11px]">
							{PARA_TYPE_META[row.type].label}
						</Badge>
						<Badge variant={row.status === 1 ? "secondary" : "outline"} className="text-[11px]">
							{row.status === 1 ? "启用" : "停用"}
						</Badge>
					</>
				) : null
			}
			onEdit={() => row && onEdit(row)}
			editDisabled={!row?.editable}
		>
			{row ? (
				<>
					{/* 字段直接内联写:哪一行要特殊渲染(徽章 / 完整 JSON / 自定义块)就地决定,不经过"字段声明"这层 */}
					<div className="flex flex-col gap-0">
						<DetailRow label="ID">
							<span className="font-mono text-[12px]">{row.id}</span>
						</DetailRow>
						<DetailRow label="参数名">
							<span className="font-mono text-[12px]">{row.key}</span>
						</DetailRow>
						<DetailRow label="类型">{PARA_TYPE_META[row.type].label}</DetailRow>
						<DetailRow label="分组">{row.group || "—"}</DetailRow>
						<DetailRow label="可编辑">{row.editable ? "允许(editable = 1)" : "代码内置,不可改"}</DetailRow>
						<DetailRow label="说明">
							<span className="text-[13px]">{row.remark || "—"}</span>
						</DetailRow>
					</div>
					<div className="space-y-1.5">
						<div className="text-[12px] font-medium text-muted-foreground">当前值</div>
						{/* 完整值:不截断、不折行丢字,长 JSON 也能整段看完并复制 */}
						<pre
							translate="no"
							className="max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all text-foreground"
						>
							{row.value === "" ? "(空)" : row.value}
						</pre>
					</div>
				</>
			) : null}
		</DetailDialog>
	);
}
