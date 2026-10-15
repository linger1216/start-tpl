import { db } from "#/db";
import { sysLog } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { logger, sanitize } from "#/lib/logger";
import { getParaBool, getParaMap } from "#/lib/sys-para";

/**
 * 审计日志的**纯逻辑**:动作名 / 目标描述 / 该不该记 / 以及「绝不抛错」的写库。
 *
 * 真正挂到链上的是 `integrations/trpc/init.ts` 的 `auditMiddleware` ——
 * 所以「每次写调用都留痕」是**结构性保证**,不靠每个 resolver 记得加。
 * 只记 mutation:否则每次列表刷新、每个缩略图都会写一行,日志会被自己淹掉。
 */

/** 资源词:path 第一段 → 中文名。**查不到就原样保留**,所以漏一个不会丢信息 */
const RESOURCE: Record<string, string> = {
	menu: "菜单",
	dict: "字典",
	para: "参数",
	tag: "标签",
	dept: "部门",
	role: "角色",
	user: "用户",
	file: "文件",
	log: "日志",
};

/** 动作词:path 第二段 → 中文名 */
const ACTION: Record<string, string> = {
	create: "新增",
	update: "修改",
	remove: "删除",
	rename: "重命名",
	sort: "排序",
	move: "移动",
	presign: "上传",
	confirm: "确认上传",
	updatePerms: "保存权限",
	updateMembers: "调整成员",
	resetPassword: "重置密码",
	impersonate: "切换用户",
};

/** 少数拼出来别扭的动作,单独写死 */
const LABEL_OVERRIDES: Record<string, string> = {
	"file.confirm": "确认上传文件",
	"role.updatePerms": "保存角色权限",
};

/** 动作名:`新增角色` / `重命名文件`;加新接口**不用改这里**(逐词翻译即可) */
export function labelOf(path: string): string {
	const override = LABEL_OVERRIDES[path];
	if (override) return override;
	const [resource, ...rest] = path.split(".");
	const resourceText = RESOURCE[resource] ?? resource;
	const actionText = rest.map((segment) => ACTION[segment] ?? segment).join("");
	return actionText ? `${actionText}${resourceText}` : resourceText;
}

/**
 * 从入参里挑「最像主键」的字段拼一句目标描述 —— **尽力而为**。
 *
 * ⚠️ 边界写在这里:要做到「删了哪个文件」这种精确记录,得让每个 resolver 自己标注,
 * 那就丢掉了「零改动挂上去」这个最大好处。真正要精确检索时,再看 `input` 快照。
 */
export function describeTarget(rawInput: unknown): string | null {
	const bag = unwrapInput(rawInput);
	if (!bag) return null;
	const pick = ["id", "ids", "key", "code", "objectKey", "email", "name"].find((key) => bag[key] !== undefined);
	if (!pick) return null;
	const value = bag[pick];
	const text = Array.isArray(value)
		? `${pick}=[${value.slice(0, 5).join(", ")}${value.length > 5 ? ` …共 ${value.length} 个` : ""}]`
		: `${pick}=${String(value)}`;
	return text.length > 255 ? `${text.slice(0, 252)}…` : text;
}

/** tRPC 的 `getRawInput()` 是 `{ json: {...} }`(superjson 包装),这里统一拆一层 */
function unwrapInput(rawInput: unknown): Record<string, unknown> | null {
	if (!rawInput || typeof rawInput !== "object") return null;
	const wrapped = (rawInput as { json?: unknown }).json;
	const bag = (wrapped && typeof wrapped === "object" ? wrapped : rawInput) as Record<string, unknown>;
	return bag;
}

/** 该不该入库:只记 mutation,且跳过高频 UI 偏好写入(见参数 `log.skip_paths`) */
export function shouldAudit(input: { type: string; rawInput: unknown; skipPrefixes: string[] }): boolean {
	if (input.type !== "mutation") return false;
	const bag = unwrapInput(input.rawInput);
	if (!bag) return true;
	const key = typeof bag.key === "string" ? bag.key : "";
	return !input.skipPrefixes.some((prefix) => prefix && key.startsWith(prefix));
}

type AuditConfig = { enabled: boolean; skipPrefixes: string[] };

/**
 * 审计开关与跳过表来自参数管理(`log.enabled` / `log.skip_paths`)。
 * **不在这里重复缓存** —— `sys-para.ts` 的 `getParaMap()` 已有 30 秒缓存,
 * 再加一层只会让参数改动慢一拍(而它本身只是"记一笔"的旁路)。
 */
export async function readAuditConfig(): Promise<AuditConfig> {
	try {
		const [enabled, paraMap] = await Promise.all([getParaBool("log.enabled", true), getParaMap()]);
		return {
			enabled,
			skipPrefixes: (paraMap.get("log.skip_paths") ?? "page.")
				.split(",")
				.map((piece) => piece.trim())
				.filter(Boolean),
		};
	} catch {
		// 参数表都读不到时**宁可记多**(默认开):审计缺记录比多记录严重
		return { enabled: true, skipPrefixes: ["page."] };
	}
}

type AuditEntry = {
	traceId: string;
	path: string;
	label: string;
	type: string;
	operatorId: string | null;
	operatorName: string | null;
	ip: string | null;
	target: string | null;
	status: number;
	errorCode?: string | null;
	errorMessage?: string | null;
	rawInput: unknown;
	durationMs: number;
};

/**
 * 还在飞的审计写入。
 *
 * 审计是 fire-and-forget,所以**写库可能比调用方后续的动作更晚落地** ——
 * 测试的 `after()` 里"先清测试数据、再关连接"会跑在它前面,库里就留下 `__test__…` 的审计残留
 * (实测:每跑一次 `tests/task-close.test.ts` 留 6~8 行,30 分钟的兜底清扫才收)。
 * 用例在删审计行之前 `await flushAuditWrites()` 就把它变成确定的 —— 不要用"睡一会儿再查"来猜。
 */
const inFlight = new Set<Promise<void>>();

/** 等所有还在飞的审计写入落地(测试用;业务不该调它,那会破坏 fire-and-forget) */
export async function flushAuditWrites(): Promise<void> {
	while (inFlight.size > 0) await Promise.all([...inFlight]);
}

/**
 * 写一行审计。**绝不抛** —— 审计写失败只打一条 stdout warn。
 * 调用方一律 fire-and-forget(不 await),业务永远不等审计。
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
	const task = insertAuditRow(entry);
	inFlight.add(task);
	try {
		await task;
	} finally {
		inFlight.delete(task);
	}
}

/** 真正落库的那一步(拆出来只为了能被 `inFlight` 追踪到,行为与原来一字不差) */
async function insertAuditRow(entry: AuditEntry): Promise<void> {
	try {
		const snapshot = JSON.stringify(sanitize(entry.rawInput) ?? null);
		await db.insert(sysLog).values({
			id: newId(),
			trace_id: entry.traceId.slice(0, 32),
			path: entry.path,
			label: entry.label.slice(0, 64),
			type: entry.type,
			operator_id: entry.operatorId,
			operator_name: entry.operatorName,
			ip: entry.ip,
			target: entry.target,
			status: entry.status,
			error_code: entry.errorCode ?? null,
			error_message: entry.errorMessage ? entry.errorMessage.slice(0, 255) : null,
			input: snapshot.length > 2000 ? `${snapshot.slice(0, 2000)}…` : snapshot,
			duration_ms: entry.durationMs,
			created_at: new Date(),
		});
	} catch (error) {
		logger.warn("audit.write_failed", { path: entry.path, message: (error as Error).message });
	}
}
