import { z } from "zod";
import { isRecord } from "#/lib/task/json";

export const MAX_ATTACHMENTS = 20;

/** `sys_file.id` 的列宽 —— 附件 id 一律按它校验 */
const FILE_ID_LENGTH = 32;

/**
 * 任务**链接块** —— `tc_task.payload` 的内容区形状(**与后端 zod schema 同一份真源**)。
 *
 * 一块 = 一个 URL(没有标题 / 说明等附加字段,填起来就一个输入框)。
 * 站内还是站外**不存库**:渲染时按 host 判定(见 `isInternalUrl`)—— 相对路径算站内,
 * 绝对 URL 的 host(含端口)与当前页面一致也算站内。
 *
 * 判别联合的 `linkBlockSchema` 就是权威形状(后端入参校验 + 前端类型都从它来)。
 * 读取时过滤无法识别的数据(见 `parseBlock`)。
 */
const linkBlockSchema = z.object({
	kind: z.literal("link"),
	/** 站内路径(`/settings/users?q=x`)或外部网址(`https://…`) */
	url: z.string().max(2000),
});

/** 链接区上限 —— zod 校验、截断、界面计数共用 */
export const MAX_LINKS = 30;

/** `tc_task.payload` 的入参形状(任务创建 / 编辑都走它) */
export const taskPayloadSchema = z.object({
	/** 场景标签:内核不解释,由业务自己认 */
	type: z.string().max(64).optional(),
	/** 链接区(有序块)。空数组 = 没有链接 */
	links: z.array(linkBlockSchema).max(MAX_LINKS).optional(),
	/** 附件区:`sys_file.id` 列表(与 `tc_comment.attachments` 同形) */
	attachments: z.array(z.string().min(1).max(FILE_ID_LENGTH)).max(MAX_ATTACHMENTS).optional(),
});

export type TaskLinkBlock = z.infer<typeof linkBlockSchema>;
export type TaskPayload = z.infer<typeof taskPayloadSchema>;
/** 附件(服务端 join `sys_file` 后的形状;编辑态新传的还没 size 时可缺省) */
export type TaskAttachment = { id: string; name: string; size: number; contentType?: string | null };

/**
 * 站内链接判定:**相对路径**,或绝对 URL 的 `host`(含端口)与当前页面一致。
 * 服务端渲染时拿不到 `window`,一律当站外(站内链接在 SSR 阶段也只是少个 target,不影响正确性)。
 */
/** 链接的站内/站外口径(图标由调用方选,这里只给判据与文案)—— 编辑区与详情区共用 */
export function linkTargetOf(url: string): { internal: boolean; label: "站内" | "站外" } {
	const internal = isInternalUrl(url);
	return { internal, label: internal ? "站内" : "站外" };
}

export function isInternalUrl(url: string): boolean {
	if (url.startsWith("/")) return true;
	try {
		const target = new URL(url);
		return typeof window !== "undefined" && target.host === window.location.host;
	} catch {
		return false;
	}
}

/** URL 形状是否可用:站内路径(以 `/` 开头)或 http(s) 网址 */
function isUsableUrl(url: string): boolean {
	return url.startsWith("/") || /^https?:\/\//i.test(url);
}

/** 新加一块的初始值 */
export function blankBlock(): TaskLinkBlock {
	return { kind: "link", url: "" };
}

/**
 * **容错解析**一块 —— 认不出来就返回 `null`。
 */
export function parseBlock(raw: unknown): TaskLinkBlock | null {
	if (!isRecord(raw)) return null;
	if (raw.kind !== "link") return null;
	const url = typeof raw.url === "string" ? raw.url.trim() : "";
	return isUsableUrl(url) ? { kind: "link", url } : null;
}

/** 把 `payload.links`(unknown)解析成链接块;未知 / 坏块直接丢弃 */
export function parseBlocks(raw: unknown): TaskLinkBlock[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(parseBlock).filter((block): block is TaskLinkBlock => block !== null);
}

/**
 * 规范化 payload —— trim / 去空块 / 去重附件 / 截断超量;**服务端为准**(前端只是提前挡)。
 * 全空返回 `null`(库里存 NULL,而不是存一个空壳对象)。
 */
export function normalizePayload(input: TaskPayload | null | undefined): TaskPayload | null {
	if (!input) return null;
	const links: TaskLinkBlock[] = [];
	for (const block of input.links ?? []) {
		if (!isRecord(block) || block.kind !== "link") continue;
		const url = typeof block.url === "string" ? block.url.trim() : "";
		// 同 URL 只留一条;空 / 形状不对的丢掉
		if (!isUsableUrl(url) || links.some((item) => item.url === url)) continue;
		links.push({ kind: "link", url });
		if (links.length >= MAX_LINKS) break;
	}
	const attachments = [...new Set((input.attachments ?? []).map((id) => id.trim()).filter(Boolean))].slice(
		0,
		MAX_ATTACHMENTS,
	);
	const type = input.type?.trim() || undefined;
	if (links.length === 0 && attachments.length === 0 && !type) return null;
	return {
		...(type ? { type } : {}),
		...(links.length > 0 ? { links } : {}),
		...(attachments.length > 0 ? { attachments } : {}),
	};
}
