/**
 * 全球眼视频平台(中国电信 DSS)协议客户端 —— **仅服务端**。
 *
 * 由 `temp/china_net_video_help.py`(Java `ChinaNetVideoHelp` 的移植)逐条复刻:
 *
 *   POST /videoService/accounts/authorize          两次握手登录,取 token(5 次 MD5 签名)
 *   PUT  /videoService/accounts/token/keepalive    保活
 *   POST /videoService/accounts/unauthorize        注销
 *   GET  /videoService/devicesManager/deviceTree   组织 / 设备 / 通道目录
 *   GET  /videoService/realmonitor/uri             实时监视 URI(取流地址)
 *
 * 四条设计口径:
 *  ① **不引入运行时依赖**:用 `node:https` / `node:http` / `node:crypto`(平台常是自签证书,
 *     所以用一个 `rejectUnauthorized:false` 的 Agent,而不是全局关掉 TLS 校验);
 *  ② **token 在 web 进程内单例 + 自调度保活**:并发调用复用同一次登录,首次调用成功后起一个
 *     `setInterval` 定时 keepalive(`unref()`,不阻止进程退出);keepalive 失败即清空 token,
 *     下一次调用自动重新登录;
 *  ③ **凭据只从 env 读**:模块从不把 token / 密码返回给上层以外的地方;
 *  ④ **播放地址走本服务代理**:平台取流地址不带 CORS 头,浏览器(hls.js)跨域读不了它的 m3u8 /
 *     分片。所以 `getGlobalEyeStreamUrl` 下发的是**本服务**的 `/api/globaleye/stream?...`(带 HMAC 签名),
 *     由 `openGlobalEyeStream` + `rewriteHlsPlaylist` 在同源下拉取并改写播放列表 —— 顺带绕过自签证书。
 *
 * ⚠️ 这个文件只能在服务端 import(引了 `node:https`)。router / 代理路由不会被客户端打包,所以安全 ——
 * 但**不要**在客户端组件里 import 它(会把 node 内置模块拖进浏览器包)。
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

import { logger } from "#/lib/logger";

const AUTH_PATH = "/videoService/accounts/authorize";
const KEEPALIVE_PATH = "/videoService/accounts/token/keepalive";
const DEVICE_TREE_PATH = "/videoService/devicesManager/deviceTree";
const REALMONITOR_PATH = "/videoService/realmonitor/uri";
const FIX_CLIENT_TYPE = "winpc";
/** 一次 deviceTree 能拿的目录量(照 Python 的 `pageSize`) */
const DEVICE_TREE_PAGE_SIZE = 1000;
/** 遍历组织树时每种节点都按这三个 typeCode 各查一次(照 Python `collect`) */
const DEVICE_TREE_TYPE_CODES = ["01", "01;1;ALL", "01;0;ALL;ALL"] as const;

/** 接口返回的 `data` 是一个任意 JSON 对象(字段随接口而定) */
export type Json = Record<string, unknown>;

export type GlobalEyeConfig = {
	base: string;
	username: string;
	password: string;
	clientIp: string;
	insecureTls: boolean;
	streamScheme: string;
	subType: number;
	keepaliveSeconds: number;
};

/** 读环境变量并校验关键项;缺 host / 用户名 / 密码时抛一句能直接照做的中文错误 */
export function readGlobalEyeConfig(): GlobalEyeConfig {
	const host = process.env.GLOBALEYE_HOST?.trim();
	const username = process.env.GLOBALEYE_USERNAME?.trim();
	const password = process.env.GLOBALEYE_PASSWORD;
	if (!host || !username || !password) {
		throw new Error("缺全球眼配置:请在 .env.local 填 GLOBALEYE_HOST / GLOBALEYE_USERNAME / GLOBALEYE_PASSWORD");
	}
	const scheme = (process.env.GLOBALEYE_SCHEME?.trim() || "https").toLowerCase() === "http" ? "http" : "https";
	const port = process.env.GLOBALEYE_PORT?.trim() || "8282";
	return {
		base: `${scheme}://${host}:${port}`,
		username,
		password,
		clientIp: process.env.GLOBALEYE_CLIENT_IP?.trim() || "127.0.0.1",
		insecureTls: (process.env.GLOBALEYE_INSECURE_TLS ?? "true") !== "false",
		streamScheme: process.env.GLOBALEYE_STREAM_SCHEME?.trim() || "HLS",
		subType: Number(process.env.GLOBALEYE_SUB_TYPE ?? "0") || 0,
		keepaliveSeconds: Number(process.env.GLOBALEYE_KEEPALIVE_SECONDS ?? "120") || 0,
	};
}

/** 32 位小写十六进制 MD5(对应 Java `Md5Utils.encrypt`) */
function md5(text: string): string {
	return createHash("md5").update(text, "utf8").digest("hex");
}

/**
 * 登录签名 —— **共计算五次 MD5**(与 Python `get_sign` / Java `getSign` 逐字一致)。
 * 抽成纯函数便于单测(不联网)。
 */
export function globalEyeSignature(username: string, password: string, realm: string, randomKey: string): string {
	let signature = md5(password);
	signature = md5(username + signature);
	signature = md5(signature);
	signature = md5(`${username}:${realm}:${signature}`);
	signature = md5(`${signature}:${randomKey}`);
	return signature;
}

/** 接口的 `data` 可能是 JSON 字符串或已是对象,统一成对象(对应 Python `_to_dict`) */
function asRecord(value: unknown): Json {
	if (value === null || value === undefined) return {};
	if (typeof value === "string") {
		try {
			return asRecord(JSON.parse(value));
		} catch {
			return {};
		}
	}
	if (typeof value === "object") return value as Json;
	return { value };
}

/** 归一化后的接口响应(对应 Java `Result`:`result === 0` 表示成功) */
type GlobalEyeResult = { result: number; msg: string; data: unknown };

function normalize(payload: unknown): GlobalEyeResult {
	if (payload && typeof payload === "object" && "result" in payload) {
		const record = payload as Json;
		return { result: Number(record.result ?? 0) || 0, msg: String(record.msg ?? ""), data: record.data };
	}
	return { result: 0, msg: "", data: payload };
}

// ── HTTP ─────────────────────────────────────────────────

const agentCache = new Map<boolean, { http: HttpAgent; https: HttpsAgent }>();

function agentFor(insecureTls: boolean) {
	let entry = agentCache.get(insecureTls);
	if (!entry) {
		entry = {
			http: new HttpAgent({ keepAlive: true }),
			https: new HttpsAgent({ keepAlive: true, rejectUnauthorized: !insecureTls }),
		};
		agentCache.set(insecureTls, entry);
	}
	return entry;
}

/** 底层请求的返回:状态 / 响应头 / 未消费的流(调用方决定读成文本还是透传) */
export type GlobalEyeRawResponse = {
	status: number;
	headers: IncomingHttpHeaders;
	stream: IncomingMessage;
};

/**
 * 发一次请求、拿到**未消费**的响应(读文本 / 透传二进制都靠它)。
 *
 * 只走 `node:http` / `node:https`,不用 `fetch` —— 因为需要**按请求**关闭 TLS 校验
 * (`fetch` 在 Node 里没有按请求 agent 的口子)。
 */
function openRaw(
	config: GlobalEyeConfig,
	method: string,
	url: URL,
	headers: Record<string, string>,
	body: string | null,
): Promise<GlobalEyeRawResponse> {
	return new Promise((resolve, reject) => {
		const isHttps = url.protocol === "https:";
		const onResponse = (res: IncomingMessage) =>
			resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res });
		const req = isHttps
			? httpsRequest(url, { method, agent: agentFor(config.insecureTls).https, headers }, onResponse)
			: httpRequest(url, { method, agent: agentFor(config.insecureTls).http, headers }, onResponse);
		req.on("error", reject);
		if (body) req.write(body);
		req.end();
	});
}

/** 把流读成 utf8 文本(代理路由改写播放列表时也要用) */
export async function readStreamText(stream: IncomingMessage): Promise<string> {
	stream.setEncoding("utf8");
	let text = "";
	for await (const chunk of stream) text += chunk;
	return text;
}

/** 发一次接口请求并归一化响应(JSON) */
async function request(
	config: GlobalEyeConfig,
	method: string,
	path: string,
	options: { params?: Record<string, string | number>; headers?: Record<string, string>; json?: unknown } = {},
): Promise<GlobalEyeResult> {
	const url = new URL(path, config.base);
	if (options.params) {
		for (const [key, value] of Object.entries(options.params)) {
			if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
		}
	}
	const body = options.json === undefined ? null : JSON.stringify(options.json);
	const headers: Record<string, string> = {
		accept: "application/json",
		...(options.headers ?? {}),
	};
	if (body) headers["content-type"] = "application/json;charset=UTF-8";

	const raw = await openRaw(config, method, url, headers, body);
	const text = await readStreamText(raw.stream);

	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error(`全球眼接口返回非 JSON:${text.slice(0, 200)}`);
	}
	return normalize(payload);
}

/** 两次握手登录,返回 token */
async function authorize(config: GlobalEyeConfig): Promise<string> {
	const first = await request(config, "POST", AUTH_PATH, {
		json: { userName: config.username, clientType: FIX_CLIENT_TYPE, ipAddress: config.clientIp },
	});
	if (first.result !== 0 || first.data == null) throw new Error(first.msg || "全球眼登录失败(第一步)");
	const resData = asRecord(first.data);

	const second = await request(config, "POST", AUTH_PATH, {
		json: {
			userName: config.username,
			signature: globalEyeSignature(
				config.username,
				config.password,
				String(resData.realm ?? ""),
				String(resData.randomKey ?? ""),
			),
			randomKey: resData.randomKey,
			encryptType: resData.encryptType,
			clientType: FIX_CLIENT_TYPE,
			ipAddress: config.clientIp,
		},
	});
	if (second.result !== 0 || second.data == null) throw new Error(second.msg || "全球眼登录失败(第二步)");
	const token = String(asRecord(second.data).token ?? "");
	if (!token) throw new Error("全球眼登录未返回 token");
	return token;
}

function keepAlive(config: GlobalEyeConfig, token: string): Promise<GlobalEyeResult> {
	return request(config, "PUT", KEEPALIVE_PATH, { headers: { "X-Subject-Token": token }, json: { token } });
}

async function deviceTreeItems(
	config: GlobalEyeConfig,
	token: string,
	nodeId: string,
	typeCode: string,
): Promise<Json[]> {
	const res = await request(config, "GET", DEVICE_TREE_PATH, {
		params: {
			id: nodeId,
			nodeType: 1,
			typeCode,
			page: 1,
			pageSize: DEVICE_TREE_PAGE_SIZE,
		},
		headers: { "X-Subject-Token": token },
	});
	const results = asRecord(res.data).results;
	return Array.isArray(results) ? (results as Json[]) : [];
}

// ── token 单例 + 保活 ─────────────────────────────────────

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

/** 首次登录成功后起一个 keepalive 定时器(`unref()`,不阻止进程退出) */
function startKeepalive(config: GlobalEyeConfig): void {
	if (keepaliveTimer || config.keepaliveSeconds <= 0) return;
	keepaliveTimer = setInterval(() => {
		const token = cachedToken;
		if (!token) return;
		void keepAlive(config, token)
			.then((res) => {
				if (res.result !== 0) {
					logger.warn("globaleye.keepalive.failed", { msg: res.msg });
					cachedToken = null; // 下次调用重新登录
				}
			})
			.catch((error) => {
				logger.warn("globaleye.keepalive.error", {
					message: error instanceof Error ? error.message : String(error),
				});
				cachedToken = null;
			});
	}, config.keepaliveSeconds * 1000);
	(keepaliveTimer as unknown as { unref?: () => void }).unref?.();
}

/** 取(必要时创建)token;并发调用共享同一次登录 */
export async function getGlobalEyeToken(force = false): Promise<string> {
	const config = readGlobalEyeConfig();
	if (force) cachedToken = null;
	if (cachedToken) return cachedToken;
	if (!inflight) {
		inflight = authorize(config)
			.then((token) => {
				cachedToken = token;
				startKeepalive(config);
				return token;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

// ── 目录 / 通道 ───────────────────────────────────────────

/** 遍历组织树,返回去重后的组织 / 设备 / 通道(照 Python `collect`) */
export async function collectGlobalEyeTree(): Promise<{ orgs: Json[]; devices: Json[]; channels: Json[] }> {
	const config = readGlobalEyeConfig();
	const token = await getGlobalEyeToken();
	const orgs: Json[] = [];
	const devices: Json[] = [];
	const channels: Json[] = [];
	const seenOrg = new Set<string>();
	const seenDev = new Set<string>();
	const seenCh = new Set<string>();
	const queue: string[] = [""];
	while (queue.length > 0) {
		const orgId = queue.shift() ?? "";
		if (seenOrg.has(orgId)) continue;
		seenOrg.add(orgId);
		for (const typeCode of DEVICE_TREE_TYPE_CODES) {
			const items = await deviceTreeItems(config, token, orgId, typeCode);
			for (const item of items) {
				const nodeType = Number(item.nodeType ?? 0);
				if (nodeType === 1) {
					const id = String(item.id ?? "");
					if (id && !orgs.some((org) => String(org.id) === id)) orgs.push(item);
					if (id && !seenOrg.has(id)) queue.push(id);
				} else if (nodeType === 2) {
					const key = String(item.deviceCode ?? item.id ?? "");
					if (key && !seenDev.has(key)) {
						seenDev.add(key);
						devices.push(item);
					}
				} else if (nodeType === 3) {
					const key = String(item.channelId ?? item.id ?? "");
					if (key && !seenCh.has(key)) {
						seenCh.add(key);
						channels.push(item);
					}
				}
			}
		}
	}
	logSampleOnce({ orgs, devices, channels });
	return { orgs, devices, channels };
}

/**
 * 取一个通道的实时播放地址(HLS)。
 *
 * 返回值里的 `url` 是**本服务的代理地址**(`/api/globaleye/stream?...`,带 HMAC 签名),
 * 不是平台原始地址 —— 平台的播放列表不带 CORS 头,浏览器跨域读不了,必须由本服务代理转发。
 */
export async function getGlobalEyeStreamUrl(
	channelId: string,
): Promise<{ url: string; scheme: string; subType: number }> {
	const config = readGlobalEyeConfig();
	const token = await getGlobalEyeToken();
	const res = await request(config, "GET", REALMONITOR_PATH, {
		params: { channelId, subType: config.subType, scheme: config.streamScheme },
		headers: { "X-Subject-Token": token },
	});
	if (res.result !== 0) throw new Error(res.msg || `取流失败(result=${res.result})`);
	const upstreamUrl = String(asRecord(res.data).url ?? "");
	if (!upstreamUrl) throw new Error("取流接口未返回播放地址");
	return { url: toGlobalEyeProxyUrl(upstreamUrl), scheme: config.streamScheme, subType: config.subType };
}

// ── 播放代理(HLS 同源转发)───────────────────────────────

/** 代理路由的路径(与 `routes/api.globaleye.stream.ts` 对应) */
export const GLOBAL_EYE_PROXY_PATH = "/api/globaleye/stream";

/** 签名密钥:优先用 better-auth 的密钥;没有就退到一把进程内随机值(重启会换,只在本地兜底) */
let fallbackSecret: string | null = null;
function proxySecret(): string {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (secret) return secret;
	fallbackSecret ??= createHash("sha256").update(String(Math.random())).digest("hex");
	return fallbackSecret;
}

/** 对目标地址做 HMAC-SHA256 签名(截 32 位)—— 代理只接受本服务签过的地址,防开放代理 / SSRF */
export function signGlobalEyeTarget(target: string): string {
	return createHmac("sha256", proxySecret()).update(target).digest("hex").slice(0, 32);
}

/** 校验签名(常数时间比较) */
export function verifyGlobalEyeTarget(target: string, signature: string): boolean {
	const expected = signGlobalEyeTarget(target);
	const encoder = new TextEncoder();
	const a = encoder.encode(expected);
	const b = encoder.encode(signature);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** 把平台取流地址包成**本服务**的代理地址(相对路径,浏览器按当前 origin 解析) */
export function toGlobalEyeProxyUrl(target: string): string {
	const params = new URLSearchParams({ u: target, s: signGlobalEyeTarget(target) });
	return `${GLOBAL_EYE_PROXY_PATH}?${params.toString()}`;
}

/**
 * 拉取上游(跟随最多 5 次重定向),返回状态 / 响应头 / 未消费的流 + **最终地址**。
 * 最终地址很重要:HLS 播放列表里的相对分片地址要按"重定向之后"的地址解析。
 */
export async function openGlobalEyeStream(
	target: string,
	headers: Record<string, string> = {},
): Promise<GlobalEyeRawResponse & { finalUrl: string }> {
	const config = readGlobalEyeConfig();
	let url = new URL(target);
	let response: GlobalEyeRawResponse | null = null;
	for (let hop = 0; hop < 5; hop += 1) {
		response = await openRaw(config, "GET", url, headers, null);
		const location = response.headers.location;
		if (response.status >= 300 && response.status < 400 && location) {
			response.stream.resume(); // 丢弃重定向响应体
			url = new URL(location, url);
			continue;
		}
		break;
	}
	if (!response) throw new Error("取流上游无响应");
	return { ...response, finalUrl: url.toString() };
}

/**
 * 改写 HLS 播放列表:把每条 URI(分片 / 子播放列表)与 `URI="…"` 属性(密钥 / 初始化段)
 * 都换成**本服务的代理地址**,这样浏览器只会请求同源,不再触发跨域。
 */
export function rewriteHlsPlaylist(text: string, baseUrl: string): string {
	const base = new URL(baseUrl);
	return text
		.split("\n")
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return line;
			if (trimmed.startsWith("#")) {
				// EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA 里的 URI="…"
				return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
					return `URI="${toGlobalEyeProxyUrl(new URL(uri, base).toString())}"`;
				});
			}
			// 裸行 = 分片或子播放列表地址(可能是相对路径)
			return toGlobalEyeProxyUrl(new URL(trimmed, base).toString());
		})
		.join("\n");
}

/** 判断一份响应是不是 HLS 播放列表(按 content-type 或扩展名) */
export function isHlsPlaylist(contentType: string | undefined, targetPath: string): boolean {
	if ((contentType ?? "").toLowerCase().includes("mpegurl")) return true;
	return targetPath.toLowerCase().endsWith(".m3u8");
}

/** 把上游 Node 流转成 web 流(给 `Response` 透传二进制分片用) */
export function toWebStream(stream: IncomingMessage): ReadableStream<Uint8Array> {
	return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

// ── 拼树(纯函数,便于单测)───────────────────────────────

export type GlobalEyeNodeKind = "org" | "device" | "channel";

/** 喂给 `lib/tree` 的 `buildTree` 的行:id / parentId 是树字段,其余是业务字段 */
export type GlobalEyeNodeRow = {
	id: string;
	parentId: string | null;
	name: string;
	sort: number;
	kind: GlobalEyeNodeKind;
	online: boolean | null;
	/** 通道的**完整原始字段** —— 右侧详情面板直接遍历它展示 */
	raw: Json;
};

/** 取第一个非空字符串(平台的父级字段名不统一,按优先级兜) */
function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value) return value;
		if (typeof value === "number") return String(value);
	}
	return null;
}

/**
 * 把三份平铺列表拼成 `buildTree` 能吃的行。
 *
 * 父子字段是 **best-effort**:平台不同版本字段名不一(设备父级可能是 `parentId` / `orgCode`,
 * 通道父级可能是 `deviceId` / `deviceCode` / `orgCode`)。解析不出父级时 `parentId = null`,
 * 由 `buildTree` 提升为一级 —— 宁可平铺,也不能整枝消失。
 */
export function toGlobalEyeTreeRows(input: { orgs: Json[]; devices: Json[]; channels: Json[] }): GlobalEyeNodeRow[] {
	const rows: GlobalEyeNodeRow[] = [];
	let sort = 0;
	const orgIds = new Set(input.orgs.map((org) => String(org.id ?? "")));
	for (const org of input.orgs) {
		const id = String(org.id ?? "");
		if (!id) continue;
		const parent = firstString(org.parentId);
		rows.push({
			id,
			parentId: parent && orgIds.has(parent) ? parent : null,
			name: String(org.name ?? org.orgName ?? id),
			sort: sort++,
			kind: "org",
			online: null,
			raw: org,
		});
	}
	for (const device of input.devices) {
		const id = firstString(device.deviceCode, device.id);
		if (!id) continue;
		rows.push({
			id,
			parentId: firstString(device.parentId, device.orgCode, device.orgId),
			name: String(device.name ?? device.deviceName ?? id),
			sort: sort++,
			kind: "device",
			online: null,
			raw: device,
		});
	}
	for (const channel of input.channels) {
		const id = firstString(channel.channelId, channel.id);
		if (!id) continue;
		rows.push({
			id,
			parentId: firstString(channel.deviceId, channel.deviceCode, channel.orgCode, channel.parentId),
			name: String(channel.channelName ?? channel.name ?? id),
			sort: sort++,
			kind: "channel",
			online: channel.isOnline == null ? null : Boolean(channel.isOnline),
			raw: channel,
		});
	}
	return rows;
}

// ── 一次性样本日志(帮助核对字段映射)─────────────────────

let sampleLogged = false;

function logSampleOnce(input: { orgs: Json[]; devices: Json[]; channels: Json[] }): void {
	if (sampleLogged) return;
	sampleLogged = true;
	logger.debug("globaleye.sample", {
		orgKeys: Object.keys(input.orgs[0] ?? {}),
		deviceKeys: Object.keys(input.devices[0] ?? {}),
		channelKeys: Object.keys(input.channels[0] ?? {}),
	});
}
