import type { LucideIcon } from "lucide-react";
import { ExternalLink, FileQuestion, FileText, Link2, Table2 } from "lucide-react";
import type { ReactNode } from "react";

import { useStableKeys } from "#/hooks/use-stable-keys";
import { parseBlock, type TaskContentBlock, type TaskContentKind } from "#/lib/task-content";

/** 每种块的图标(「添加内容块」菜单与只读渲染共用一份) */
export const CONTENT_KIND_ICON: Record<TaskContentKind, LucideIcon> = {
	text: FileText,
	table: Table2,
	ref: Link2,
	link: ExternalLink,
};

/**
 * 内容块的**只读渲染注册表** —— `kind → (block) => ReactNode`。
 *
 * 加一种块:在 `TaskContentBlock` 联合里加一支 + 这里加一条视图,别的消费方(列表 / 详情)零改动。
 * 每个视图内部按 `value.kind` 收窄(比函数签名协变/逆变那套更省心,也不会写出假设性的错误)。
 */
const VIEWS: Record<TaskContentKind, (block: TaskContentBlock) => ReactNode> = {
	text: (block) =>
		block.kind === "text" ? (
			<p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{block.text}</p>
		) : null,
	table: (block) => (block.kind === "table" ? <TableView block={block} /> : null),
	ref: (block) =>
		block.kind === "ref" ? <TaskRefLink path={block.path} query={block.query} title={block.title} /> : null,
	link: (block) =>
		block.kind === "link" ? (
			<a
				href={block.url}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex flex-wrap items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
			>
				<ExternalLink className="size-3.5 shrink-0" />
				{block.title}
				{block.description ? <span className="text-muted-foreground">· {block.description}</span> : null}
			</a>
		) : null,
};

/**
 * 内容区只读渲染 —— 遍历 `payload.content`,按 `kind` 查表。
 *
 * **容错**:认不出的块(未知 `kind` / 脏数据)渲染成占位,不抛错、也不吞掉其余块 ——
 * 前后端可以独立演进。
 */
export function TaskContentBlocks({ content }: { content: unknown }) {
	const items = Array.isArray(content) ? content : [];
	// 块没有 id;用「按位置稳定」的 key(内容变化不重建),别用下标(会被 noArrayIndexKey 拦下)
	const keys = useStableKeys(items.length, "tc-view");
	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">（没有内容）</p>;
	}
	return (
		<div className="space-y-3">
			{items.map((raw, index) => {
				const block = parseBlock(raw);
				if (!block) return <UnknownBlock key={keys[index]} raw={raw} />;
				return <div key={keys[index]}>{VIEWS[block.kind](block)}</div>;
			})}
		</div>
	);
}

/** 内部页面引用 —— 用普通 `<a href>`:对任意路由都稳,不依赖类型化路由表(代价是一次整页跳转) */
function TaskRefLink({ path, query, title }: { path: string; query?: Record<string, string>; title: string }) {
	const qs = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : "";
	return (
		<a
			href={`${path}${qs}`}
			className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
		>
			<Link2 className="size-3.5 shrink-0" />
			{title}
		</a>
	);
}

function TableView({ block }: { block: Extract<TaskContentBlock, { kind: "table" }> }) {
	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			{block.caption ? (
				<div className="border-b border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
					{block.caption}
				</div>
			) : null}
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border bg-secondary/20 text-left text-xs text-muted-foreground">
						{block.columns.map((col) => (
							<th key={col.key} className="px-3 py-1.5 font-medium">
								{col.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{block.rows.length === 0 ? (
						<tr>
							<td colSpan={block.columns.length} className="px-3 py-2 text-muted-foreground">
								无数据
							</td>
						</tr>
					) : (
						block.rows.map((row, index) => (
							// 行无 id;内容只读、无重排,按位置当 key 足够(react/noArrayIndexKey 由本地 key 规避)
							<tr key={rowKey(block, index)} className="border-b border-border last:border-0">
								{block.columns.map((col) => (
									<td key={col.key} className="px-3 py-1.5 align-top">
										{row[col.key]?.trim() ? row[col.key] : <span className="text-muted-foreground">—</span>}
									</td>
								))}
							</tr>
						))
					)}
				</tbody>
			</table>
		</div>
	);
}

/** 行 key:列值拼一个稳定的串(同内容同行 → 同 key);空行退回下标。仅用于 React key,不影响数据 */
function rowKey(block: Extract<TaskContentBlock, { kind: "table" }>, index: number): string {
	const cell = block.columns.map((col) => block.rows[index]?.[col.key] ?? "").join("\u0000");
	return cell.trim() ? `${index}-${cell}` : `row-${index}`;
}

function UnknownBlock({ raw }: { raw: unknown }) {
	const kind = raw && typeof raw === "object" && "kind" in raw ? String((raw as { kind: unknown }).kind) : "未知";
	return (
		<div className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
			<FileQuestion className="size-3.5 shrink-0" />
			不支持的内容块（{kind}）
		</div>
	);
}
