/**
 * drizzle / mysql2 的错误判定小工具。
 *
 * drizzle 会把底层 mysql2 的错包一层(`cause`),所以判定要看两层,最后再用消息兜底。
 */
const DUPLICATE_CODES = new Set(["ER_DUP_ENTRY", "ER_DUP_KEY", "SQLITE_CONSTRAINT_UNIQUE"]);

export function isDuplicateKeyError(error: unknown): boolean {
	// drizzle 可能把底层错误包好几层(DrizzleQueryError → mysql2 → ...),所以沿 cause 链往下找
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth += 1) {
		const candidate = current as { code?: string; message?: string; cause?: unknown };
		if (candidate.code && DUPLICATE_CODES.has(candidate.code)) return true;
		if (/duplicate entry/i.test(candidate.message ?? "")) return true;
		current = candidate.cause;
	}
	return false;
}

/**
 * 把错误的**真实原因**挖出来(带 cause 链)。
 *
 * 为什么要它:drizzle 会把 mysql 的错包一层,tRPC 再包一层 —— 只取最外层 message
 * 得到的是 "Failed query: insert into …" 这种**没告诉人为什么**的话。
 * 这里沿 cause 链找最具体的 sqlMessage / message,拼成一句人能用的原因。
 */
export function describeError(error: unknown, maxLength = 400): string {
	const parts: string[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth += 1) {
		const candidate = current as { code?: string; sqlMessage?: string; message?: string; cause?: unknown };
		const detail = candidate.sqlMessage?.trim() || candidate.message?.trim();
		if (detail && !parts.includes(detail)) parts.push(candidate.code ? `[${candidate.code}] ${detail}` : detail);
		current = candidate.cause;
	}
	return (parts.join(" ← ") || String(error)).slice(0, maxLength);
}
