/**
 * DM(达梦)连接管理 + db 工厂。
 *
 *   createDmDatabase({ url }, schema)
 *     dm://user:password@host:port → dmdb pool → bindDmExec → drizzleDm → MySqlDatabase
 *
 * 返回的 db 与 mysql2 那条线**同型**(都基于 MySqlDatabase),所以 routers / pages 零改动。
 *
 * ── 关于「登录加密」这件事(踩过一次,这里写清楚) ──────────────────────────────
 * 达梦的**登录握手**用 DES-CFB 加密。DES 在 OpenSSL 3(Node ≥17)里被移进 legacy provider 且
 * 默认不加载,于是 dmdb 建会话密码器就报 `ERR_OSSL_EVP_UNSUPPORTED`,达梦只回
 * `[6071] 消息加密失败`,而连接池那条 Promise 既不 resolve 也不 reject ——
 * **症状是「连不上、但没有任何报错」**,极难排查。
 *
 * 两条路:
 *   A. `loginEncrypt=false`(本项目的选择):完全不碰 DES,**不需要任何 Node 启动开关**。
 *      代价:登录凭证不再走那段加密 —— 但那本来就是 56 位 DES,对真攻击者约等于没有;
 *      而备选方案是把整个 Node 进程的弱算法全开,影响面更大。跨不可信网络请走 SSL(sslPath)。
 *   B. 开着登录加密 + `NODE_OPTIONS=--openssl-legacy-provider`(注意 **pnpm 不认 .npmrc 的
 *      `node-options`**,实测;只能 shell/CI 层给或脚本内联)。
 *
 * 所以:**URL 里没显式写 `loginEncrypt` 时,这里自动补 `loginEncrypt=false`** ——
 * 让"忘了写就挂住"这个坑不可能再复发。想显式打开加密也得写 `loginEncrypt=true`(会告警提示)。
 */
import dmdb from "dmdb";

import { log } from "#/lib/logger";
import { type DmPreparedQueryHKT, type DmQueryResultHKT, drizzleDm } from "./session";
import { bindDmExec, type DmPool } from "./translate";

interface DmConfig {
	/** dm://user:password@host:port[?schema=xxx][&loginEncrypt=false] */
	url: string;
	poolMax?: number;
	poolTimeout?: number;
}

function parseDmUrl(url: string): { user: string; password: string; host: string } {
	const m = url.match(/^dm:\/\/(.+?):(.+)@(.+:\d+)(\?.*)?$/);
	if (!m) throw new Error(`[dm] DM_URL 格式应是 dm://user:password@host:port[?schema=xxx],实际收到: ${url}`);
	const [, user = "", password = "", host = ""] = m;
	return { user, password, host };
}

/**
 * 没写 `loginEncrypt` 就补 `=false`(原因见文件头);显式写 true 时给一条告警,
 * 因为那条路需要 `--openssl-legacy-provider`,否则会静默挂住。
 */
function withLoginEncryptDefault(url: string): string {
	const explicit = url.match(/[?&]loginEncrypt=([^&]*)/i);
	if (explicit) {
		if (/^(true|1|yes)$/i.test(explicit[1] ?? "")) {
			log("warn", "dm.login_encrypt_on", {
				hint: "开着登录加密需要 NODE_OPTIONS=--openssl-legacy-provider(DES-CFB 属 legacy 算法);先跑 `pnpm check:legacy` 确认当前 Node 支不支持,否则连接会静默挂住",
			});
		}
		return url;
	}
	log("info", "dm.login_encrypt_defaulted", {
		hint: "URL 未指定 loginEncrypt,自动按 false 处理(避开 OpenSSL 3 的 DES 限制)",
	});
	return `${url}${url.includes("?") ? "&" : "?"}loginEncrypt=false`;
}

let warnedMissingSchema = false;

export function createDmDatabase<TFullSchema extends Record<string, unknown> = Record<string, never>>(
	config: DmConfig,
	schema?: TFullSchema,
) {
	parseDmUrl(config.url); // 只做格式校验
	if (!/[?&]schema=/i.test(config.url) && !warnedMissingSchema) {
		warnedMissingSchema = true;
		log("warn", "dm.no_schema_param", {
			hint: "URL 没带 ?schema=<模式>;表不在登录用户的默认模式下时会报「无效的表或视图名」。表在 eg 模式就写 ?schema=eg",
		});
	}

	// 让 dmdb 把这两类按字符串返回,因为 drizzle/mysql-core 的解码器是按「驱动给字符串」写的:
	//  · CLOB → 默认回 Lob 对象,而 text 解码器要字符串
	//  · DATE → 默认回 Date 对象,而 datetime 解码器会调 `value.replace(" ","T")`
	// ⚠️ 这两行曾经在改动中丢失过,症状是 24/29 用例失败(value.replace is not a function / BigInt)。
	dmdb.fetchAsString = [dmdb.CLOB, dmdb.DATE];

	// dmdb 的 PoolAttributes.connectString 就是完整的 dm:// 串(凭证 + 各属性都在里面)
	const rawPool = dmdb.createPool({
		connectString: withLoginEncryptDefault(config.url),
		poolMax: config.poolMax ?? 4,
		poolTimeout: config.poolTimeout ?? 60,
		outFormat: dmdb.OUT_FORMAT_OBJECT,
	} as unknown as Parameters<typeof dmdb.createPool>[0]);

	// `createPool()` 返回 **Promise<Pool>**(dmdb 异步建池)。不在模块加载期 await(避免 top-level await),
	// 而是把它当 Promise 传下去,第一次查询时才 await —— 见 bindDmExec。
	const pool = Promise.resolve(rawPool) as unknown as Promise<DmPool>;

	const exec = bindDmExec(pool);
	const db = drizzleDm<TFullSchema>({ exec, pool, schema });

	return { db, pool, exec };
}

export { drizzleDm, type DmPool, type DmPreparedQueryHKT, type DmQueryResultHKT };
