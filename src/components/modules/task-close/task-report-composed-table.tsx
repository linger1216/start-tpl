import { ReportValueView } from "#/components/modules/task-close/report-readonly";
import {
	fieldColMinWidth,
	fieldColWidth,
	type ReportData,
	type Value,
} from "#/components/modules/task-close/report-types";
import { cn } from "#/lib/utils";

/** 组合视图的一张只读表:标量字段成列,数组字段换行 + 缩进挂在行下面。 */
export function ComposedTable({
	taskId,
	scalarFields,
	arrayFields,
	rows,
	files,
	showOwner,
}: {
	taskId: string;
	scalarFields: ReportData["template"]["schema"]["fields"];
	arrayFields: ReportData["template"]["schema"]["fields"];
	rows: ReportData["composed"];
	files: ReportData["files"];
	showOwner: boolean;
}) {
	const columnCount = Math.max(1, scalarFields.length + (showOwner ? 2 : 0));
	return (
		<div className="min-w-0 max-h-[65vh] overflow-auto rounded-md border border-border">
			<table className="w-max min-w-full border-collapse text-left text-sm">
				<colgroup>
					{showOwner ? (
						<>
							<col style={{ width: 128 }} />
							<col style={{ width: 112 }} />
						</>
					) : null}
					{scalarFields.map((field) => (
						<col key={field.id} style={{ width: fieldColMinWidth(field) }} />
					))}
				</colgroup>
				{(showOwner || scalarFields.length > 0) && (
					<thead>
						<tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
							{showOwner ? (
								<>
									<th
										scope="col"
										className="sticky top-0 left-0 z-30 w-32 whitespace-nowrap bg-muted/40 px-3 py-2.5 text-left font-medium"
									>
										填报来源
									</th>
									<th
										scope="col"
										className="sticky top-0 z-20 whitespace-nowrap bg-muted/40 px-3 py-2.5 text-left font-medium"
									>
										状态
									</th>
								</>
							) : null}
							{scalarFields.map((field, index) => (
								<th
									key={field.id}
									scope="col"
									className={cn(
										fieldColWidth(field),
										"sticky top-0 z-20 bg-muted/40 px-3 py-2.5 text-left font-medium",
										!showOwner && index === 0 && "left-0 z-30",
									)}
								>
									{field.label}
								</th>
							))}
						</tr>
					</thead>
				)}
				{rows.map((entry, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: 组合行是读时派生、没有稳定 id;只读展示,顺序即身份
					<tbody key={`${entry.owner ?? "own"}-${index}`} className="border-b border-border last:border-b-0">
						{(showOwner || scalarFields.length > 0) && (
							<tr className="align-top">
								{showOwner ? (
									<td
										className={cn(
											"whitespace-nowrap px-3 py-3 text-sm font-medium text-foreground",
											showOwner && "sticky left-0 z-10 bg-background",
										)}
									>
										{entry.owner ? (entry.ownerName ?? "执行人") : "本级填报"}
									</td>
								) : null}
								{showOwner ? (
									<td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
										{entry.status === "pending" ? "待提交" : entry.status === "submitted" ? "已提交" : "本级"}
									</td>
								) : null}
								{scalarFields.map((field) => (
									<td
										key={field.id}
										className={cn(
											"px-3 py-3 break-words",
											!showOwner && field === scalarFields[0] && "sticky left-0 z-10 bg-background",
										)}
									>
										<ReportValueView taskId={taskId} field={field} value={entry.row[field.id] as Value} files={files} />
									</td>
								))}
							</tr>
						)}
						{arrayFields.length > 0 ? (
							<tr>
								<td colSpan={columnCount} className="px-3 pb-3">
									<div className="grid gap-3 rounded-md bg-muted/30 p-3">
										{arrayFields.map((field) => (
											<div key={field.id} className="grid gap-1">
												<span className="text-xs text-muted-foreground">{field.label}</span>
												<ReportValueView
													taskId={taskId}
													field={field}
													value={entry.row[field.id] as Value}
													files={files}
												/>
											</div>
										))}
									</div>
								</td>
							</tr>
						) : null}
					</tbody>
				))}
			</table>
		</div>
	);
}
