import { RotateCcw, TableProperties } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SearchSelect } from "#/components/ui/search-select";
import { SHEET_PARSE_DEFAULTS, SHEET_ROW_MAX, type SheetParseOptions } from "#/lib/excel";

/**
 * 表格解析选项条 —— 指定「表头行 / 业务字段行 / 数据起始行」(都是 **1 基的 Excel 行号**)。
 *
 * 默认对应最常见的三段式台账:第 1 行中文列名、第 2 行业务字段名(`name` / `creditCode`)、
 * 第 3 行起是数据。业务字段行可以留空(点「无」)= 单行表头的文件。
 *
 * 三个输入受控,改动后由调用方**重新解析**当前文件(保留文件本体,不重新选文件)。
 * 纯 UI 件:`SheetParseOptions` 类型与默认值都在 `#/lib/excel`,本文件不含解析逻辑。
 */
export function SheetParseOptionsBar({
	value,
	onChange,
	disabled = false,
	sheetNames = [],
}: {
	value: SheetParseOptions;
	onChange: (next: SheetParseOptions) => void;
	disabled?: boolean;
	/** 文件里的工作表清单(多于一个才显示选择器);来自解析结果 */
	sheetNames?: string[];
}) {
	const isDefault =
		value.headerRow === SHEET_PARSE_DEFAULTS.headerRow &&
		value.fieldRow === SHEET_PARSE_DEFAULTS.fieldRow &&
		value.dataRow === SHEET_PARSE_DEFAULTS.dataRow &&
		!value.sheetName;

	/** 工作表选择:多 sheet 文件才有意义(单 sheet 不占位置) */
	const sheetPicker =
		sheetNames.length > 1 ? (
			<div className="flex items-center gap-1.5">
				<Label className="text-[12px] text-muted-foreground">工作表</Label>
				<SearchSelect
					value={value.sheetName ?? sheetNames[0]}
					onValueChange={(next) => onChange({ ...value, sheetName: next ?? null })}
					options={sheetNames.map((name) => ({ value: name, label: name }))}
					triggerClassName="h-7 w-40 text-[12.5px]"
				/>
			</div>
		) : null;

	const rowInput = (key: "headerRow" | "dataRow", label: string, hint: string, className = "w-16") => (
		<div className="flex items-center gap-1.5">
			<Label className="text-[12px] text-muted-foreground">{label}</Label>
			<Input
				type="number"
				min={1}
				max={SHEET_ROW_MAX}
				value={value[key]}
				disabled={disabled}
				aria-label={`${label}(第几行)`}
				className={`${className} h-7 px-2 text-[12.5px] tabular-nums`}
				title={hint}
				onChange={(event) => {
					const raw = event.target.value;
					if (raw === "") return;
					const next = Number(raw);
					if (Number.isNaN(next)) return;
					onChange({ ...value, [key]: Math.min(SHEET_ROW_MAX, Math.max(1, Math.round(next))) });
				}}
			/>
			<span className="text-[11.5px] text-muted-foreground">行</span>
		</div>
	);

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-secondary/60 px-2.5 py-2">
			<span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
				<TableProperties className="size-3.5" />
				表格行号
			</span>

			{sheetPicker}

			{rowInput("headerRow", "表头", "列名(中文名)所在行,默认第 1 行")}
			{rowInput("dataRow", "数据起始", "数据从第几行开始,默认第 3 行", "w-20")}

			<div className="flex items-center gap-1.5">
				<Label className="text-[12px] text-muted-foreground">业务字段</Label>
				{value.fieldRow === null ? (
					<span className="rounded-md border border-dashed border-border px-2 py-[3px] text-[12px] text-muted-foreground">
						无
					</span>
				) : (
					<Input
						type="number"
						min={1}
						max={SHEET_ROW_MAX}
						value={value.fieldRow}
						disabled={disabled}
						aria-label="业务字段行(第几行)"
						className="h-7 w-16 px-2 text-[12.5px] tabular-nums"
						title="业务字段名(如 name / creditCode)所在行,默认第 2 行"
						onChange={(event) => {
							const raw = event.target.value;
							if (raw === "") {
								onChange({ ...value, fieldRow: null });
								return;
							}
							const next = Number(raw);
							if (Number.isNaN(next)) return;
							onChange({ ...value, fieldRow: Math.min(SHEET_ROW_MAX, Math.max(1, Math.round(next))) });
						}}
					/>
				)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					className="h-7 px-1.5 text-[11.5px]"
					title="文件只有表头一行(业务字段靠表头括号或手工填)"
					onClick={() => {
						// 设成「无」= 单行表头文件,数据紧跟表头;但只在数据起始行还是默认值时才顺手改,
						// 不覆盖用户自己填过的行号
						if (value.fieldRow !== null) {
							const nextDataRow = value.dataRow === SHEET_PARSE_DEFAULTS.dataRow ? value.headerRow + 1 : value.dataRow;
							onChange({ ...value, fieldRow: null, dataRow: nextDataRow });
							return;
						}
						onChange({ ...value, fieldRow: SHEET_PARSE_DEFAULTS.fieldRow });
					}}
				>
					{value.fieldRow === null ? "设回第 2 行" : "无"}
				</Button>
			</div>

			{!isDefault ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					className="h-7 gap-1 px-1.5 text-[11.5px]"
					onClick={() => onChange({ ...SHEET_PARSE_DEFAULTS })}
				>
					<RotateCcw className="size-3" />
					恢复默认(1/2/3)
				</Button>
			) : null}
		</div>
	);
}
