import { z } from "zod";

/**
 * 任务内容块 —— `tc_task.payload` 的**内容区**形状(**与后端 zod schema 同一份真源**)。
 *
 * 为什么是「有序块数组」而不是顶层并列几个字段:
 *  - 一段说明 + 一张表 + 一个链接这种**混合**表达得了;并列字段表达不了。
 *  - 渲染 / 编辑 / 校验 / 摘要都只需要「遍历 + 按 `kind` 查表」,不用在每个消费方写 if-else。
 *
 * 判别联合的 `contentBlockSchema` 就是权威形状(后端入参校验 + 前端类型都从它来)。
 * 但**渲染必须容错**:遇到不认识的 `kind`(老客户端遇到新块)要降级成占位块,不能抛错(见 `parseBlock`)。
 */
export const contentBlockSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("text"), text: z.string().max(5000) }),
	z.object({
		kind: z.literal("table"),
		caption: z.string().max(100).optional(),
		columns: z.array(z.object({ key: z.string().max(64), label: z.string().max(64) })).max(12),
		rows: z.array(z.record(z.string(), z.string().max(500))).max(200),
	}),
	z.object({
		kind: z.literal("ref"),
		path: z.string().max(300),
		query: z.record(z.string(), z.string().max(200)).optional(),
		title: z.string().max(120),
	}),
	z.object({
		kind: z.literal("link"),
		url: z.string().max(2000),
		title: z.string().max(120),
		description: z.string().max(200).optional(),
	}),
]);

/** `tc_task.payload` 的入参形状(任务创建 / 编辑都走它) */
export const taskPayloadSchema = z.object({
	/** 场景标签:内核不解释,由业务自己认 */
	type: z.string().max(64).optional(),
	/** 内容区(有序块)。空数组 = 没有内容 */
	content: z.array(contentBlockSchema).max(30).optional(),
	/** 附件区:`sys_file.id` 列表(与 `tc_comment.attachments` 同形) */
	attachments: z.array(z.string().min(1).max(32)).max(20).optional(),
});

export type TaskContentBlock = z.infer<typeof contentBlockSchema>;
export type TaskContentKind = TaskContentBlock["kind"];
export type TaskPayload = z.infer<typeof taskPayloadSchema>;
/** 附件(服务端 join `sys_file` 后的形状;编辑态新传的还没 size 时可缺省) */
export type TaskAttachment = { id: string; name: string; size: number; contentType?: string | null };

/** 内容块的展示名(「添加内容块」菜单 / 编辑卡片标题共用) */
export const CONTENT_KIND_LABELS: Record<TaskContentKind, string> = {
	text: "文字",
	table: "表格",
	ref: "内部页面",
	link: "外部链接",
};

/** 「添加内容块」菜单的候选顺序 */
export const CONTENT_KINDS: TaskContentKind[] = ["text", "table", "ref", "link"];

/** 每种块加入时的初始值 */
const BLANKS: { [K in TaskContentKind]: () => Extract<TaskContentBlock, { kind: K }> } = {
	text: () => ({ kind: "text", text: "" }),
	table: () => ({ kind: "table", columns: [{ key: "col1", label: "列 1" }], rows: [{}] }),
	ref: () => ({ kind: "ref", path: "/", title: "" }),
	link: () => ({ kind: "link", url: "https://", title: "" }),
};

export function blankBlock<K extends TaskContentKind>(kind: K): Extract<TaskContentBlock, { kind: K }> {
	return BLANKS[kind]();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * **容错解析**一块 —— 认不出来就返回 `null`(调用方渲染占位块)。
 * 校验口径与 `normalizePayload` 一致,但这里**不修改**内容,只判"能不能画"。
 */
export function parseBlock(raw: unknown): TaskContentBlock | null {
	if (!isRecord(raw)) return null;
	switch (raw.kind) {
		case "text": {
			const text = typeof raw.text === "string" ? raw.text : "";
			return text.trim() ? { kind: "text", text } : null;
		}
		case "table": {
			const columns = (Array.isArray(raw.columns) ? raw.columns : [])
				.filter(isRecord)
				.map((col) => ({ key: String(col.key ?? ""), label: String(col.label ?? "") }))
				.filter((col) => col.key.length > 0);
			if (columns.length === 0) return null;
			const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter(isRecord).map((row) => {
				const out: Record<string, string> = {};
				for (const col of columns) out[col.key] = typeof row[col.key] === "string" ? (row[col.key] as string) : "";
				return out;
			});
			const caption = typeof raw.caption === "string" && raw.caption.trim() ? raw.caption : undefined;
			return { kind: "table", ...(caption ? { caption } : {}), columns, rows };
		}
		case "ref": {
			const path = typeof raw.path === "string" ? raw.path : "";
			const title = typeof raw.title === "string" ? raw.title : "";
			if (!path.startsWith("/") || !title.trim()) return null;
			const query = isRecord(raw.query)
				? Object.fromEntries(
						Object.entries(raw.query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
					)
				: undefined;
			return { kind: "ref", path, title, ...(query && Object.keys(query).length ? { query } : {}) };
		}
		case "link": {
			const url = typeof raw.url === "string" ? raw.url : "";
			const title = typeof raw.title === "string" ? raw.title : "";
			if (!/^https?:\/\//i.test(url) || !title.trim()) return null;
			const description = typeof raw.description === "string" && raw.description.trim() ? raw.description : undefined;
			return { kind: "link", url, title, ...(description ? { description } : {}) };
		}
		default:
			return null;
	}
}

/** 把 `payload.content`(unknown)解析成已知块;未知 / 坏块直接丢弃(只读渲染请用 `parseBlock` 以保留占位) */
export function parseBlocks(raw: unknown): TaskContentBlock[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(parseBlock).filter((block): block is TaskContentBlock => block !== null);
}

/** 一块的文字摘要(卡片 / 通知用) */
export function blockSummary(block: TaskContentBlock): string {
	switch (block.kind) {
		case "text":
			return block.text;
		case "table":
			return `${block.caption || "表格"}(${block.rows.length} 行)`;
		case "ref":
		case "link":
			return block.title;
	}
}

/** 内容区的一句话摘要 */
export function contentSummary(raw: unknown, max = 80): string {
	const text = parseBlocks(raw).map(blockSummary).filter(Boolean).join(" · ");
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeBlock(block: TaskContentBlock): TaskContentBlock | null {
	switch (block.kind) {
		case "text": {
			const text = block.text.trim();
			return text ? { kind: "text", text } : null;
		}
		case "table": {
			const columns = block.columns
				.map((col) => ({ key: col.key.trim(), label: col.label.trim() || col.key.trim() }))
				.filter((col) => col.key.length > 0);
			if (columns.length === 0) return null;
			const rows = block.rows.map((row) => {
				const out: Record<string, string> = {};
				for (const col of columns) out[col.key] = (row[col.key] ?? "").toString();
				return out;
			});
			const caption = block.caption?.trim();
			return { kind: "table", ...(caption ? { caption } : {}), columns, rows };
		}
		case "ref": {
			const path = block.path.trim();
			const title = block.title.trim();
			if (!path.startsWith("/") || !title) return null;
			const entries = Object.entries(block.query ?? {})
				.map(([key, value]) => [key.trim(), value.trim()] as const)
				.filter(([key]) => key.length > 0);
			const query = entries.length > 0 ? Object.fromEntries(entries) : undefined;
			return { kind: "ref", path, title, ...(query ? { query } : {}) };
		}
		case "link": {
			const url = block.url.trim();
			const title = block.title.trim();
			if (!/^https?:\/\//i.test(url) || !title) return null;
			const description = block.description?.trim();
			return { kind: "link", url, title, ...(description ? { description } : {}) };
		}
	}
}

/**
 * 规范化 payload —— trim / 去空块 / 去重附件 / 截断超量;**服务端为准**(前端只是提前挡)。
 * 全空返回 `null`(库里存 NULL,而不是存一个空壳对象)。
 */
export function normalizePayload(input: TaskPayload | null | undefined): TaskPayload | null {
	if (!input) return null;
	const content = (input.content ?? [])
		.map(normalizeBlock)
		.filter((block): block is TaskContentBlock => block !== null)
		.slice(0, 30);
	const attachments = [...new Set((input.attachments ?? []).map((id) => id.trim()).filter(Boolean))].slice(0, 20);
	const type = input.type?.trim() || undefined;
	if (content.length === 0 && attachments.length === 0 && !type) return null;
	return {
		...(type ? { type } : {}),
		...(content.length > 0 ? { content } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
	};
}
