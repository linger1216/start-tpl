/**
 * **后端结构化日志**(唯一出口)。底层 pino 10,外面一层薄包装 —— 所有调用点
 * 仍然 `import { logger } from "#/lib/logger"`,形态与之前一致。
 *
 * 为什么用 pino 而不是手写 JSON:
 *  - 标准化的 JSON 行 + 性能高(异步 write、零分配路径);
 *  - 内置 `level` / `redact` / `timestamp` 三大常用件,不用自己维护;
 *  - `destination` 可注入(测试 `setLogSink` / `collectLogs` 直接复用 pino 的写法)。
 *
 * 约定:`event` 用 `域.动作` 命名(`trpc.ok` / `sync.finish` / `rule.batch` …),
 * 告警与错误用 `warn` / `error`,`debug` 用来记"高频但排查时要看"的入口。
 */
import pino, { type Logger as PinoLogger } from "pino";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

export type LogLine = { ts: string; level: LogLevel; event: string } & LogFields;

/** 需要脱敏的字段名(子串匹配,大小写不敏感);同时给 pino redact 用 */
const SECRET_KEY_PATTERN = /(token|secret|password|passwd|authorization|cookie|apikey|api_key|credential)/i;
const REDACT_PATHS = [
	"*.token",
	"*.secret",
	"*.password",
	"*.passwd",
	"*.authorization",
	"*.cookie",
	"*.apikey",
	"*.api_key",
	"*.credential",
];
/** 单条字符串/对象的最大长度(日志是拿来查问题的,不是拿来存数据的) */
const MAX_STRING = 300;
const MAX_FIELDS_DEPTH = 4;

/**
 * 递归脱敏 + 截断;Date 转本地串,函数/undefined 丢掉 —— **保留对外导出**:
 * `tests/logging.test.ts` 直接 import 它做断言,改了它就改测试,所以保持形状。
 */
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

function envLevel(): LogLevel {
	const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
	return (["debug", "info", "warn", "error"] as const).includes(raw as LogLevel) ? (raw as LogLevel) : "info";
}
function envSilent(): boolean {
	return process.env.LOG_SILENT === "1" || process.env.NODE_ENV === "test";
}

/**
 * 日志出口(可替换):pino 接受任何 `{ write(str) }` 当 sink。
 * 默认 = stdout;测试 = `setLogSink` / `collectLogs` 注入内存数组。
 */
type Sink = { write: (line: string) => void };

function stdoutSink(): Sink {
	return {
		write(line: string) {
			if (typeof process !== "undefined" && process.stdout?.write) process.stdout.write(line);
			else console.log(line.trim());
		},
	};
}

/** 构造一个 pino 实例:封掉 base 噪音、把 `msg` 字段名改成 `event`、加 redact */
function buildPino(destination: Sink): PinoLogger {
	return pino(
		{
			base: null,
			level: envSilent() ? "silent" : envLevel(),
			timestamp: () => `,"ts":"${new Date().toISOString()}"`,
			formatters: {
				level: (label: string) => ({ level: label.toLowerCase() }),
			},
			messageKey: "event",
			redact: { paths: REDACT_PATHS, censor: "***" },
		},
		{ write: (chunk: string) => destination.write(`${chunk}\n`) } as unknown as pino.DestinationStream,
	);
}

/** 顶层活动实例;`setLogSink` 重建它(测试换出口用) */
let active: PinoLogger = buildPino(stdoutSink());

/** 换出口(测试用);不传 = 恢复 stdout */
function setLogSink(next?: { write: (line: string) => void }): void {
	active = buildPino(next ? { write: next.write } : stdoutSink());
}

/** 收集到的日志行(测试断言用) */
export function collectLogs(): { lines: LogLine[]; restore: () => void } {
	const lines: LogLine[] = [];
	setLogSink({
		write(line: string) {
			try {
				lines.push(JSON.parse(line.trim()) as LogLine);
			} catch {
				/* 非 JSON 行忽略 */
			}
		},
	});
	return { lines, restore: () => setLogSink() };
}

/**
 * 统一打日志入口 —— **故意不导出**:对外只有下面 `logger.debug/info/warn/error` 一个面,
 * 免得出现"两个都能打日志的 API、调用方各写一半"的分叉(历史上确实同时存在过)。
 *
 * **保留名最后盖**:调用方在 `fields` 里塞了 `ts/level/event` 时,
 * 我们先把它们剥掉再交给 pino,防止覆盖 pino / base 写进去的标准字段(实测踩过:
 * 认证端点想记 `auth.ok`,入参里的 `event: "auth.sign_in"` 把日志自己的事件名顶掉了)。
 */
function log(level: LogLevel, event: string, fields: LogFields = {}): void {
	if (envSilent()) return;
	const {
		ts: _t,
		level: _l,
		event: _e,
		...rest
	} = fields as LogFields & {
		ts?: unknown;
		level?: unknown;
		event?: unknown;
	};
	// pino 第二参 = msg;messageKey 把它写到 `event` 字段
	active[level](rest, event);
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
