import { Plus } from "lucide-react";
import type { ReactNode } from "react";

import { CONTENT_KIND_ICON } from "#/components/modules/task-close/task-content-blocks";
import { ActionButton } from "#/components/ui/action-button";
import { buttonVariants } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { useStableKeys } from "#/hooks/use-stable-keys";
import {
	blankBlock,
	CONTENT_KIND_LABELS,
	CONTENT_KINDS,
	type TaskContentBlock,
	type TaskContentKind,
} from "#/lib/task-content";

/**
 * 内容块的**编辑注册表** —— `kind → Editor`。
 *
 * 与只读注册表(`task-content-blocks.tsx` 的 `VIEWS`)一一对应;「添加内容块」菜单直接读 `CONTENT_KINDS`。
 * 外层(增删 / 上下移)与块类型无关,所以加一种块只需在这里补一个 Editor。
 * 每个 Editor 内部按 `value.kind` 收窄(注册表里统一按联合类型签名,省去函数协变那套)。
 */
type EditorProps = {
	value: TaskContentBlock;
	onChange: (next: TaskContentBlock) => void;
	disabled?: boolean;
};

const EDITORS: Record<TaskContentKind, (props: EditorProps) => ReactNode> = {
	text: TextEditor,
	table: TableEditor,
	ref: RefEditor,
	link: LinkEditor,
};

/**
 * 内容区编辑器 —— 有序块列表:每种块由注册表的 Editor 渲染,外层负责「上移 / 下移 / 删除 / 添加」。
 *
 * 与任务表单的其它字段同形(小卡片 + 行内 `ActionButton`),规则见 `doc/界面约定.md`。
 */
export function TaskContentEditor({
	value,
	onChange,
	disabled,
}: {
	value: TaskContentBlock[];
	onChange: (next: TaskContentBlock[]) => void;
	disabled?: boolean;
}) {
	const blockKeys = useStableKeys(value.length, "tc-block");

	function update(index: number, next: TaskContentBlock) {
		onChange(value.map((block, i) => (i === index ? next : block)));
	}
	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= value.length) return;
		const next = [...value];
		const [moved] = next.splice(index, 1);
		if (moved) next.splice(target, 0, moved);
		onChange(next);
	}
	function remove(index: number) {
		onChange(value.filter((_, i) => i !== index));
	}

	return (
		<div className="space-y-2">
			{value.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
					还没有内容。点下面「添加内容块」。
				</p>
			) : null}
			{value.map((block, index) => {
				const Editor = EDITORS[block.kind];
				const Icon = CONTENT_KIND_ICON[block.kind];
				return (
					<div key={blockKeys[index]} className="space-y-2 rounded-xl border border-border p-2.5">
						<div className="flex items-center justify-between gap-2">
							<span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<Icon className="size-3.5" />
								{CONTENT_KIND_LABELS[block.kind]}
							</span>
							<div className="flex items-center gap-3">
								<ActionButton disabled={disabled || index === 0} onClick={() => move(index, -1)}>
									上移
								</ActionButton>
								<ActionButton disabled={disabled || index === value.length - 1} onClick={() => move(index, 1)}>
									下移
								</ActionButton>
								<ActionButton tone="danger" disabled={disabled} onClick={() => remove(index)}>
									删除
								</ActionButton>
							</div>
						</div>
						<Editor value={block} onChange={(next) => update(index, next)} disabled={disabled} />
					</div>
				);
			})}

			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={disabled || value.length >= 30}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					<Plus className="size-3.5" />
					添加内容块
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{CONTENT_KINDS.map((kind) => {
						const Icon = CONTENT_KIND_ICON[kind];
						return (
							<DropdownMenuItem key={kind} onClick={() => onChange([...value, blankBlock(kind)])}>
								<Icon className="size-4" />
								{CONTENT_KIND_LABELS[kind]}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function TextEditor({ value, onChange, disabled }: EditorProps) {
	if (value.kind !== "text") return null;
	return (
		<Textarea
			rows={3}
			value={value.text}
			disabled={disabled}
			placeholder="写点什么…(可换行)"
			onChange={(event) => onChange({ kind: "text", text: event.target.value })}
		/>
	);
}

function RefEditor({ value, onChange, disabled }: EditorProps) {
	if (value.kind !== "ref") return null;
	return (
		<div className="space-y-1">
			<DetailRow label="标题" htmlFor="tc-ref-title">
				<Input
					id="tc-ref-title"
					className="h-8 text-sm"
					value={value.title}
					disabled={disabled}
					placeholder="这条指向什么,如「用户管理 · 张三」"
					onChange={(event) => onChange({ ...value, title: event.target.value })}
				/>
			</DetailRow>
			<DetailRow label="路径" htmlFor="tc-ref-path">
				<Input
					id="tc-ref-path"
					className="h-8 font-mono text-xs"
					value={value.path}
					disabled={disabled}
					placeholder="/settings/users"
					onChange={(event) => onChange({ ...value, path: event.target.value })}
				/>
			</DetailRow>
			<DetailRow label="查询串" htmlFor="tc-ref-query">
				<Input
					id="tc-ref-query"
					className="h-8 font-mono text-xs"
					value={queryToText(value.query)}
					disabled={disabled}
					placeholder="可空,如 q=张三&status=1"
					onChange={(event) => onChange({ ...value, query: textToQuery(event.target.value) })}
				/>
			</DetailRow>
		</div>
	);
}

function LinkEditor({ value, onChange, disabled }: EditorProps) {
	if (value.kind !== "link") return null;
	return (
		<div className="space-y-1">
			<DetailRow label="标题" htmlFor="tc-link-title">
				<Input
					id="tc-link-title"
					className="h-8 text-sm"
					value={value.title}
					disabled={disabled}
					placeholder="链接名字,如「巡检规范」"
					onChange={(event) => onChange({ ...value, title: event.target.value })}
				/>
			</DetailRow>
			<DetailRow label="网址" htmlFor="tc-link-url">
				<Input
					id="tc-link-url"
					className="h-8 font-mono text-xs"
					value={value.url}
					disabled={disabled}
					placeholder="https://…"
					onChange={(event) => onChange({ ...value, url: event.target.value })}
				/>
			</DetailRow>
			<DetailRow label="说明" htmlFor="tc-link-desc">
				<Input
					id="tc-link-desc"
					className="h-8 text-sm"
					value={value.description ?? ""}
					disabled={disabled}
					placeholder="可空"
					onChange={(event) => onChange({ ...value, description: event.target.value })}
				/>
			</DetailRow>
		</div>
	);
}

/**
 * 表格块编辑器 —— 直接画一张**可编辑的网格**:表头就是「列」(改的就是列名),表体就是「行」。
 *
 * 旧版把「列」和「行」拆成两个各自独立的输入列表,加一列看不出加到哪儿、每个格子还要靠 placeholder 认列;
 * 现在:**新增列**在表头尾部(新列就长在那儿)、**新增行**在表尾,加在哪儿一眼可见。
 *
 * 列的机器 `key`(`col1`…)由代码生成、**不给人填** —— 它只是单元格的索引,手改反而会把已有数据对错位。
 */
function TableEditor({ value, onChange, disabled }: EditorProps) {
	// 钩子必须在早退之前调用:非 table 时按 0 取,随后立刻 return null(注册表只会用对应 kind 渲染它)
	const columnCount = value.kind === "table" ? value.columns.length : 0;
	const rowCount = value.kind === "table" ? value.rows.length : 0;
	const columnKeys = useStableKeys(columnCount, "tc-col");
	const rowKeys = useStableKeys(rowCount, "tc-row");
	if (value.kind !== "table") return null;
	// 收窄后存一份 const —— 闭包(下面的 setLabel 等)里 narrowing 不保留,用 `table` 才拿得到具体类型
	const table = value;

	function setLabel(index: number, label: string) {
		onChange({ ...table, columns: table.columns.map((col, i) => (i === index ? { ...col, label } : col)) });
	}
	function addColumn() {
		onChange({
			...table,
			columns: [...table.columns, { key: nextColumnKey(table.columns), label: `列 ${table.columns.length + 1}` }],
		});
	}
	function removeColumn(index: number) {
		onChange({ ...table, columns: table.columns.filter((_, i) => i !== index) });
	}
	function setCell(rowIndex: number, key: string, cell: string) {
		onChange({ ...table, rows: table.rows.map((row, i) => (i === rowIndex ? { ...row, [key]: cell } : row)) });
	}
	function addRow() {
		onChange({ ...table, rows: [...table.rows, {}] });
	}
	function removeRow(index: number) {
		onChange({ ...table, rows: table.rows.filter((_, i) => i !== index) });
	}

	const canRemoveColumn = !disabled && table.columns.length > 1;

	return (
		<div className="space-y-3">
			<DetailRow label="标题" htmlFor="tc-tbl-caption">
				<Input
					id="tc-tbl-caption"
					className="h-8 text-sm"
					value={table.caption ?? ""}
					disabled={disabled}
					placeholder="可空,如「待巡检点位」"
					onChange={(event) => onChange({ ...table, caption: event.target.value })}
				/>
			</DetailRow>

			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr>
							{table.columns.map((col, index) => (
								<th
									key={columnKeys[index]}
									scope="col"
									className="min-w-40 border-b border-border px-1.5 pt-0.5 pb-1.5 text-left align-top font-normal"
								>
									<div className="flex items-center gap-1.5">
										<Input
											value={col.label}
											aria-label={`第 ${index + 1} 列列名`}
											placeholder="列名"
											className="h-7 min-w-0 flex-1 text-base sm:text-xs"
											disabled={disabled}
											onChange={(event) => setLabel(index, event.target.value)}
										/>
										<ActionButton tone="danger" disabled={!canRemoveColumn} onClick={() => removeColumn(index)}>
											删除
										</ActionButton>
									</div>
								</th>
							))}
							<th className="border-b border-border px-1.5 pt-0.5 pb-1.5 text-left align-top font-normal">
								<ActionButton disabled={disabled || table.columns.length >= 12} onClick={addColumn}>
									新增列
								</ActionButton>
							</th>
						</tr>
					</thead>
					<tbody>
						{table.rows.map((row, rowIndex) => (
							<tr key={rowKeys[rowIndex]}>
								{table.columns.map((col, colIndex) => (
									<td key={columnKeys[colIndex]} className="border-b border-border px-1.5 py-1 align-top">
										<Input
											value={row[col.key] ?? ""}
											aria-label={`第 ${rowIndex + 1} 行「${col.label || col.key}」`}
											placeholder="—"
											className="h-7 min-w-0 text-base sm:text-xs"
											disabled={disabled}
											onChange={(event) => setCell(rowIndex, col.key, event.target.value)}
										/>
									</td>
								))}
								<td className="border-b border-border px-1.5 py-1 align-middle">
									<ActionButton tone="danger" disabled={disabled} onClick={() => removeRow(rowIndex)}>
										删除
									</ActionButton>
								</td>
							</tr>
						))}
						{table.rows.length === 0 ? (
							<tr>
								<td colSpan={table.columns.length + 1} className="px-1.5 pt-2 text-xs text-muted-foreground">
									还没有行。点下面「新增行」。
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>

			<ActionButton disabled={disabled || table.rows.length >= 200} onClick={addRow}>
				新增行
			</ActionButton>
		</div>
	);
}

function nextColumnKey(columns: readonly { key: string }[]): string {
	const used = new Set(columns.map((col) => col.key));
	let n = columns.length + 1;
	while (used.has(`col${n}`)) n += 1;
	return `col${n}`;
}

function queryToText(query?: Record<string, string>): string {
	if (!query) return "";
	return Object.entries(query)
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
}

function textToQuery(text: string): Record<string, string> | undefined {
	const entries = text
		.split("&")
		.map((pair) => pair.trim())
		.filter(Boolean)
		.map((pair): [string, string] => {
			const eq = pair.indexOf("=");
			return eq === -1 ? [pair, ""] : [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
		})
		.filter(([key]) => key.length > 0);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
