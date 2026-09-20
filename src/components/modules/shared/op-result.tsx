import { CheckCircle2, Download, TriangleAlert } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { type ExcelColumn, writeSheet } from "#/lib/excel";

/**
 * 耗时操作的结果反馈 —— 导入 / 同步 / 批处理都长这样:
 * 「计数块 + 失败明细 + 下载错误报告」。
 *
 * 三种操作的成功 / 失败条数与失败明细形状一致,所以只做一套展示件:
 *   · `ResultCounts`  计数块(成功 / 失败 / 新增 / 更新…,只渲染传进来的项);
 *   · `FailureList`   失败明细(最多滚动 240px,右上角可下载错误报告);
 *   · `ResultDialog`  把上面两块装进弹窗(同步这类"独立触发"的场景);
 *     导入这类"嵌在向导里"的场景直接用前两个,不套弹窗。
 */

/** 一行失败记录 —— 有 `cells` 时错误报告会带上该行的原始列 */
export type RowFailure = {
	/** 文件行号 */
	row: number;
	/** 业务主键值 */
	keyValue: string;
	message: string;
	/** 该行的原始列(键与源数据字段一致),用于错误报告「对照原表改完重导」 */
	cells?: Record<string, string>;
};

/** 结果视图(编排壳组装后交给弹窗) */
export type OpResultView = {
	title: string;
	/** 结论一句话 */
	summary: string;
	counts: Array<{ label: string; value: number }>;
	failures?: RowFailure[];
	/** 错误报告文件名前缀(带来源名,如「企业信息-同步」) */
	reportFileName: string;
};

/** 没有原始行的失败(同步)用的兜底列 */
const SOURCE_ERROR_FALLBACK_COLUMNS: ExcelColumn<string>[] = [
	{ key: "row", label: "文件行号", width: 10 },
	{ key: "keyValue", label: "业务主键值", width: 28 },
	{ key: "message", label: "错误原因", width: 48 },
];

/**
 * 失败明细导出成 xlsx。
 *
 * 导入失败时**带上该行的原始列** + 两列「文件行号 / 错误原因」,用户可以直接拿这份报告
 * 对照原表改完重导;同步这类没有原始行的场景退回三列兜底。
 */
export function downloadFailureReport(fileNamePrefix: string, failures: readonly RowFailure[]) {
	// 原始列的列序:按失败行里第一次出现的顺序汇总(保证与文件表头一致)
	const dataColumns: string[] = [];
	for (const failure of failures) {
		for (const key of Object.keys(failure.cells ?? {})) if (!dataColumns.includes(key)) dataColumns.push(key);
	}
	const hasCells = dataColumns.length > 0;
	const columns: ExcelColumn<string>[] = hasCells
		? [
				{ key: "row", label: "文件行号", width: 10 },
				...dataColumns.map((key) => ({ key, label: key, width: Math.min(30, Math.max(12, key.length + 6)) })),
				{ key: "message", label: "错误原因", width: 48 },
			]
		: SOURCE_ERROR_FALLBACK_COLUMNS;
	const rows = hasCells
		? failures.map((failure) => ({ row: failure.row, ...(failure.cells ?? {}), message: failure.message }))
		: failures.map((failure) => ({ row: failure.row, keyValue: failure.keyValue || "—", message: failure.message }));

	writeSheet({
		columns,
		rows,
		fileName: `${fileNamePrefix}-失败明细`,
		sheetName: "失败明细",
	});
}

/** 计数块:成功 / 失败 / 新增 / 更新…(只渲染传进来的项) */
export function ResultCounts({ counts }: { counts: Array<{ label: string; value: number }> }) {
	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{counts.map((count) => (
				<div key={count.label} className="rounded-xl border border-border px-3 py-2">
					<div className="font-heading text-[20px] font-medium leading-none tabular-nums text-foreground">
						{count.value.toLocaleString()}
					</div>
					<div className="mt-1 text-[11.5px] text-muted-foreground">{count.label}</div>
				</div>
			))}
		</div>
	);
}

/** 失败明细(最多滚动 240px;错误报告下载在右上方) */
export function FailureList({ failures, reportFileName }: { failures: readonly RowFailure[]; reportFileName: string }) {
	const keys = useStableKeys(failures.length, "failure");

	if (failures.length === 0) {
		return (
			<p className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--success-fg)]">
				<CheckCircle2 className="size-3.5 shrink-0" />
				没有失败行,全部处理成功。
			</p>
		);
	}
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="flex items-center gap-1.5 text-[12.5px] font-medium text-destructive">
					<TriangleAlert className="size-3.5 shrink-0" />
					失败 {failures.length} 行
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => downloadFailureReport(reportFileName, failures)}
				>
					<Download className="size-3.5" />
					下载错误报告
				</Button>
			</div>
			<div className="max-h-60 min-w-0 overflow-x-auto overflow-y-auto rounded-lg border border-border">
				<table className="w-full text-[12.5px]">
					<thead className="sticky top-0 bg-secondary text-muted-foreground">
						<tr>
							<th className="px-2.5 py-1.5 text-left font-medium">文件行号</th>
							<th className="px-2.5 py-1.5 text-left font-medium">业务主键值</th>
							<th className="px-2.5 py-1.5 text-left font-medium">失败原因</th>
						</tr>
					</thead>
					<tbody>
						{failures.map((failure, index) => (
							<tr key={keys[index]} className="border-t border-border">
								<td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">第 {failure.row} 行</td>
								<td className="max-w-40 truncate px-2.5 py-1.5 text-foreground">{failure.keyValue || "—"}</td>
								<td className="px-2.5 py-1.5 text-destructive">{failure.message}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** 结果弹窗 —— 独立触发的耗时操作(同步 / 批处理)用它 */
export function ResultDialog({
	open,
	onOpenChange,
	result,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	result: OpResultView | null;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{result?.title ?? "操作结果"}</DialogTitle>
					<DialogDescription>{result?.summary ?? ""}</DialogDescription>
				</DialogHeader>
				{result ? (
					// min-w-0:DialogContent 是 grid,这一层是 grid item;失败明细表列多时要能横向滚动
					<div className="min-w-0 space-y-3">
						<ResultCounts counts={result.counts} />
						<FailureList failures={result.failures ?? []} reportFileName={result.reportFileName} />
					</div>
				) : null}
				<DialogFooter>
					<Button type="button" onClick={() => onOpenChange(false)}>
						知道了
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
