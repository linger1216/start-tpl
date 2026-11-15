/**
 * 一次性迁移:`sys_notification.payload` 里的 `path` / `level` → 真列。
 *
 * **背景**:这两项原先塞在 `payload` JSON 里(每条通知都可能带),读侧要 `JSON.parse` + 正则重校验 +
 * 兜底,前端还得靠 `...payloadOf()` 展开成行字段。升成列之后可索引、可直接读。
 *
 * **幂等**:可重复执行 —— 只处理「列还是空的、但 payload 里有值」的行。
 *
 * **用法**:
 *   pnpm exec dotenv -e .env.local -- npx tsx scripts/migrate-notice-path-level.ts --dry-run
 *   pnpm exec dotenv -e .env.local -- npx tsx scripts/migrate-notice-path-level.ts
 *
 * `--dry-run` 只打印将要改哪些行,不写库。
 */
import { eq, sql } from "drizzle-orm";
import { sysNotification } from "../src/db/data-base-schema.ts";
import { db, dmPool } from "../src/db/index.ts";
import { safeNoticePath } from "../src/lib/notice-path.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 500;

type Row = { id: string; path: string | null; level: string; payload: string | null };

/** `payload` 是 `text` 里的 JSON。解析不了就当没有(与读侧旧行为一致:坏数据不影响列表)。 */
function fieldsOf(raw: string | null): { path: unknown; level: unknown } {
	if (!raw) return { path: undefined, level: undefined };
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return { path: undefined, level: undefined };
		const bag = value as Record<string, unknown>;
		return { path: bag.path, level: bag.level };
	} catch {
		return { path: undefined, level: undefined };
	}
}

/** 从 `payload` 里摘掉这两个键(其余特有字段原样保留) */
function payloadWithoutPathLevel(raw: string | null): string | null {
	if (!raw) return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return raw;
		const { path: _p, level: _l, ...rest } = value as Record<string, unknown>;
		return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
	} catch {
		return raw;
	}
}

let scanned = 0;
let pathFilled = 0;
let levelFilled = 0;
let payloadTrimmed = 0;

try {
	let cursor = "";
	for (;;) {
		const rows = (await db
			.select({
				id: sysNotification.id,
				path: sysNotification.path,
				level: sysNotification.level,
				payload: sysNotification.payload,
			})
			.from(sysNotification)
			.where(cursor ? sql`${sysNotification.id} > ${cursor}` : sql`1 = 1`)
			.orderBy(sysNotification.id)
			.limit(BATCH)) as Row[];

		if (rows.length === 0) break;
		cursor = rows[rows.length - 1]?.id ?? "";
		scanned += rows.length;

		for (const row of rows) {
			const fromPayload = fieldsOf(row.payload);
			if (fromPayload.path === undefined && fromPayload.level === undefined) continue;

			// 列上已有值就不覆盖 —— 迁移跑过之后新写入的通知自己填列
			const nextPath = row.path ?? safeNoticePath(fromPayload.path);
			const nextLevel =
				row.level !== "info" || typeof fromPayload.level !== "string" ? row.level : (fromPayload.level as string);
			const nextPayload = payloadWithoutPathLevel(row.payload);

			const pathChanged = nextPath !== row.path;
			const levelChanged = nextLevel !== row.level;
			const payloadChanged = nextPayload !== row.payload;
			if (!pathChanged && !levelChanged && !payloadChanged) continue;

			if (pathChanged) pathFilled += 1;
			if (levelChanged) levelFilled += 1;
			if (payloadChanged) payloadTrimmed += 1;

			if (DRY_RUN) {
				console.log(`[dry] ${row.id}  path=${row.path ?? "∅"} → ${nextPath ?? "∅"}  level=${row.level} → ${nextLevel}`);
				continue;
			}
			await db
				.update(sysNotification)
				.set({ path: nextPath, level: nextLevel, payload: nextPayload })
				.where(eq(sysNotification.id, row.id));
		}
	}

	console.log(
		`${DRY_RUN ? "[dry-run] " : ""}扫描 ${scanned} 行 · 补 path ${pathFilled} · 补 level ${levelFilled} · 清理 payload ${payloadTrimmed}`,
	);
	if (DRY_RUN) console.log("这是预演,没有写库。去掉 --dry-run 再跑一次才会真改。");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
