/**
 * **后端结构化日志**(唯一出口)。
 *
 * 为什么要一个统一出口,而不是到处 `console.log`:
 *  1. **可查询**:每行是一条 JSON(`ts` / `level` / `event` / 业务字段),`grep '"event":"sync.finish"'`
 *     或 `jq 'select(.sourceId=="SRC-260920-153045")'` 就能把一次同步的前因后果串起来;
 *  2. **有 trace**:tRPC 中间件给每次请求发一个 `traceId` 放进 ctx,内部日志都带上它 ——
 *     一次调用里的所有日志(入口 / 同步 / 规则 / 落库)能按 traceId 串成一条时间线;
 *  3. **不泄密**:落盘前统一脱敏(`token`/`secret`/`password`/`authorization`/`cookie` 一律 `***`,
 *     长字符串截断)—— 凭据只以变量名出现在库里,日志里也不该出现真实值;
 *  4. **可静音 / 可注入**:`LOG_LEVEL` 调级别、`LOG_SILENT=1` 全关、测试用 `setLogSink()` 收流,
 *     所以"日志覆盖率"这件事本身能被用例断言。
 *
 * 约定:`event` 用 `域.动作` 命名(`trpc.ok` / `sync.finish` / `rule.batch` / `entity.import` …),
 * 告警与错误用 `warn` / `error`,`debug` 用来记"高频但排查时要看"的入口(如 list/detail)。
 */
type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

export type LogLine = { ts: string; level: LogLevel; event: string } & LogFields;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 需要脱敏的字段名(大小写不敏感,子串匹配) */
const SECRET_KEY_PATTERN = /(token|secret|password|passwd|authorization|cookie|apikey|api_key|credential)/i;
/** 单条字符串/对象的最大长度(日志是拿来查问题的,不是拿来存数据的) */
const MAX_STRING = 300;
const MAX_FIELDS_DEPTH = 4;

function currentLevel(): LogLevel {
	const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
	return (["debug", "info", "warn", "error"] as const).includes(raw as LogLevel) ? (raw as LogLevel) : "info";
}

function silent(): boolean {
	return process.env.LOG_SILENT === "1" || process.env.NODE_ENV === "test";
}

/** 递归脱敏 + 截断;Date 转本地串,函数/undefined 丢掉 */
export function sanitize(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string")
		return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return String(value);
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "function") return undefined;
	if (depth >= MAX_FIELDS_DEPTH) return "…";
	if (Array.isArray(value)) {
		const head = value.slice(0, 10).map((item) => sanitize(item, depth + 1));
		return value.length > 10 ? [...head, `…(${value.length})`] : head;
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			out[key] = SECRET_KEY_PATTERN.test(key) ? "***" : sanitize(item, depth + 1);
		}
		return out;
	}
	return String(value);
}

/** 日志出口(可替换:测试里收流断言"每次调用都留下了日志") */
type Sink = (line: LogLine) => void;
const defaultSink: Sink = (line) => {
	const text = `${JSON.stringify(line)}\n`;
	// 服务端写 stdout;浏览器环境(tRPC 理论上不会在浏览器跑,但 SSR/水合期可能 import 到)退回落 console
	if (typeof process !== "undefined" && process.stdout?.write) process.stdout.write(text);
	else console.log(text.trim());
};
let sink: Sink = defaultSink;

/** 换出口(测试用);不传参数 = 恢复默认(stdout) */
function setLogSink(next?: Sink): void {
	sink = next ?? defaultSink;
}

/** 收集到的日志行(测试断言用) */
export function collectLogs(): { lines: LogLine[]; restore: () => void } {
	const lines: LogLine[] = [];
	setLogSink((line) => lines.push(line));
	return { lines, restore: () => setLogSink() };
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
	if (silent()) return;
	if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;
	const line = {
		// 字段先铺,`ts` / `level` / `event` 三个**保留名最后盖** ——
		// 否则调用方传一个叫 `event` 的字段就能把日志自己的事件名顶掉(实测踩过:
		// 认证端点想记 `auth.ok`,入参里的 `event: "auth.sign_in"` 把它覆盖了,ok / failed 两个分支看起来一模一样)
		...((sanitize(fields) ?? {}) as LogFields),
		ts: new Date().toISOString(),
		level,
		event,
	} as LogLine;
	sink(line);
}

export const logger = {
	debug: (event: string, fields?: LogFields) => log("debug", event, fields),
	info: (event: string, fields?: LogFields) => log("info", event, fields),
	warn: (event: string, fields?: LogFields) => log("warn", event, fields),
	error: (event: string, fields?: LogFields) => log("error", event, fields),
};

/** traceId:一次 tRPC 调用一个,内部日志带上它就能串成时间线 */
export function newTraceId(): string {
	return `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
