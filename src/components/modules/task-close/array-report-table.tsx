import type { ReactNode } from "react";
import { fieldColWidth, type ReportFieldLike, type Value } from "#/components/modules/task-close/report-types";
import { cn } from "#/lib/utils";

/** 数组填报编辑和只读视图共用表格结构。 */
export function ArrayReportTable({
	items,
	itemKeys,
	fields,
	renderCell,
	renderAction,
	editable = false,
}: {
	items: Array<Record<string, Value>>;
	itemKeys: string[];
	fields: ReportFieldLike[];
	renderCell: (item: Record<string, Value>, field: ReportFieldLike, index: number) => ReactNode;
	renderAction?: (index: number) => ReactNode;
	editable?: boolean;
}) {
	return (
		<div className="min-w-0 overflow-x-auto">
			<table className="w-full border-collapse text-left text-sm">
				<thead>
					<tr className="border-b border-border text-xs text-muted-foreground">
						<th
							scope="col"
							className={cn("w-10 whitespace-nowrap px-2 py-1 font-normal", editable && "border-r border-border/60")}
						>
							序号
						</th>
						{fields.map((field) => (
							<th
								key={field.id}
								scope="col"
								className={cn(fieldColWidth(field), "px-2 py-1 font-normal", editable && "border-r border-border/60")}
							>
								{field.label}
								{editable && field.required ? " *" : ""}
							</th>
						))}
						{renderAction ? (
							<th scope="col" className="w-16 whitespace-nowrap px-2 py-1 font-normal">
								操作
							</th>
						) : null}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{items.map((item, index) => (
						<tr key={itemKeys[index]} className="align-top">
							<td
								className={cn(
									"whitespace-nowrap px-2 py-1 text-xs tabular-nums text-muted-foreground",
									editable && "border-r border-border/60",
								)}
							>
								{index + 1}
							</td>
							{fields.map((field) => (
								<td
									key={field.id}
									className={cn("px-2 py-1", editable ? "border-r border-border/60 last:border-r-0" : "break-words")}
								>
									{renderCell(item, field, index)}
								</td>
							))}
							{renderAction ? <td className="px-2 py-1">{renderAction(index)}</td> : null}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
