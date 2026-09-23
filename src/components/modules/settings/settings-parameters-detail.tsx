import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { PARA_TYPE_META } from "#/lib/para-spec";
import type { ParameterRow } from "./settings-parameters-table";

/**
 * 参数详情(只读)。
 *
 * 为什么要有它:清单页的「当前值」被截断、「说明」只有一行 —— 想看清楚一条参数到底长什么样
 * (完整值、类型口径、能不能改、什么时候改的),得有个地方能完整看一遍。
 * 展示的字段**与 `sys_para` 表一一对应**,不放任何派生字段。
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						参数详情
						<Badge variant="secondary" className="font-mono text-[11px]">
							{row ? PARA_TYPE_META[row.type].label : ""}
						</Badge>
					</DialogTitle>
					<DialogDescription translate="no" className="font-mono text-[12px]">
						{row?.key ?? ""}
					</DialogDescription>
				</DialogHeader>

				{row ? (
					<div className="space-y-4">
						<div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
							<DetailRow label="分组">{row.group || "—"}</DetailRow>
							<DetailRow label="可编辑">
								{row.editable ? (
									<span className="text-foreground">允许(editable = 1)</span>
								) : (
									<span className="text-muted-foreground">代码内置,不可改</span>
								)}
							</DetailRow>
							<DetailRow label="状态">
								{row.status === 1 ? <Badge variant="outline">启用</Badge> : <Badge variant="secondary">停用</Badge>}
							</DetailRow>
							<DetailRow label="更新时间">{row.updatedAt ?? "—"}</DetailRow>
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

						<div className="space-y-1.5">
							<div className="text-[12px] font-medium text-muted-foreground">说明</div>
							<p className="text-[13px] text-foreground">{row.remark || "—"}</p>
						</div>
					</div>
				) : null}

				<DialogFooter className="gap-2">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
					<Button
						disabled={!row?.editable}
						onClick={() => {
							if (!row) return;
							onOpenChange(false);
							onEdit(row);
						}}
					>
						编辑
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
