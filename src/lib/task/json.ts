/**
 * 稳定序列化(键排序)—— **只用来比**「内容区 / 附件 / 提醒配置有没有变」,别拿去存库。
 * 纯函数、无服务端依赖:router 与 lib 都能用(原先放在 `routers/task/common.ts`,导致 lib 侧想用就得反向依赖)。
 */
export function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const bag = value as Record<string, unknown>;
	const body = Object.keys(bag)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(bag[key])}`)
		.join(",");
	return `{${body}}`;
}

/** JSON 列 / 上报数据里「这条是不是一个对象」—— 之前 10 处各写一遍 `typeof x === "object" && !Array.isArray(x)` */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `tc_log.detail` / `tc_task.payload` 这类 JSON 列读出来可能是任何东西 —— 当袋子读,读不到就当空(绝不抛) */
export function bagOf(detail: unknown): Record<string, unknown> {
	return isRecord(detail) ? detail : {};
}
