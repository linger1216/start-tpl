/**
 * 按 DATABASE_URL 自动选驱动:
 *   dm://...             → 达梦(dmdb + rewriteForDm,见 ./dm/)
 *   mysql:// / mysql2:// → MySQL(原 mysql2)
 *
 * 导出的 `db` **只有一种类型**(mysql2 那条线的类型):两条线底层都是 drizzle 的
 * `MySqlDatabase` + 同一个 schema,所以达梦实例结构上就是它的替身 —— 这样 routers、
 * 页面、测试一行都不用改,类型也不会退化成联合类型。
 *
 * ⚠️ 达梦分支需要 `NODE_OPTIONS=--openssl-legacy-provider`(dmdb 用了老 OpenSSL 算法)。
 *    `.npmrc` 里加 `node-options=--openssl-legacy-provider` 可以一劳永逸。
 */
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";

import { log } from "#/lib/logger";
import { createDmDatabase } from "./dm/index.ts";
import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is not set. Run `cp .env.example .env.local` and fill in your connection string (mysql://... 或 dm://...).",
	);
}

// 捕获成 string(上面已经校验过非空)—— 放闭包里用,TS 才能保持收窄,不必写 `!`
const url: string = databaseUrl;
const isDm = url.startsWith("dm://");

/**
 * 启动时把「当前连的是哪个方言 / 哪个目标」打一行日志。
 *
 * 为什么要它:换了 `DATABASE_URL` 但**没重启进程**时,服务会继续连旧库
 * (Vite 的 env 热重启不会重跑 dotenv),症状是"账号/数据莫名其妙找不到" ——
 * 这个信息已经骗过我们两次,日志里一眼可辨最省事。
 * **不打印凭据**:只留方言 + 主机端口 + 库名/模式。
 */
function describeConn(raw: string): string {
	try {
		const parsed = new URL(raw);
		const parts = [parsed.host, parsed.pathname.replace(/^\//, "")];
		const schema = parsed.searchParams.get("schema");
		if (schema) parts.push(`schema=${schema}`);
		return parts.filter(Boolean).join(" · ");
	} catch {
		return "(连接串无法解析)";
	}
}
log("info", "db.dialect", { dialect: isDm ? "dm(达梦)" : "mysql", target: describeConn(url) });

function buildMysqlDb() {
	return drizzleMysql(url, { schema, mode: "default" });
}
type AppDb = ReturnType<typeof buildMysqlDb>;

const dm = isDm ? createDmDatabase({ url }, schema) : undefined;

export const db: AppDb = (dm ? dm.db : buildMysqlDb()) as unknown as AppDb;

/** 达梦分支的连接池句柄(MySQL 分支为 undefined)—— 测试收尾时 `await dmPool.close()` */
export const dmPool = dm ? { close: async () => (await dm.pool).close() } : undefined;
