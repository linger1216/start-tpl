/**
 * 全球眼(中国电信 DSS)协议客户端 —— **仅服务端**。
 *
 * 职责只有三件:登录拿 token(含保活)、取通道树、取通道的 HLS 播放地址。
 * 播放由浏览器用 hls.js 直连(平台 HLS 端点带 CORS)。
 *
 * 配置只有三项:`GLOBALEYE_URL`(含协议与端口)、`GLOBALEYE_USERNAME`、`GLOBALEYE_PASSWORD`。
 */
import { createHash } from "node:crypto";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";

import { logger } from "#/lib/logger";

const AUTH_PATH = "/videoService/accounts/authorize";
const KEEPALIVE_PATH = "/videoService/accounts/token/keepalive";
const DEVICE_TREE_PATH = "/videoService/devicesManager/deviceTree";
const REALMONITOR_PATH = "/videoService/realmonitor/uri";
const CLIENT_TYPE = "winpc";
/** 遍历目录时每种节点都按这三个 typeCode 各查一次 */
const DEVICE_TREE_TYPE_CODES = ["01", "01;1;ALL", "01;0;ALL;ALL"] as const;
/** 取流优先子码流(更轻),拿不到再主码流(有些摄像机没有子码流) */
const STREAM_SUB_TYPES = [1, 0] as const;

const REQUEST_TIMEOUT_MS = 15_000;
const GET_RETRIES = 2;
const KEEPALIVE_MS = 60_000;
const TREE_CACHE_MS = 300_000;

export type Json = Record<string, unknown>;

export type GlobalEyeConfig = { base: string; username: string; password: string };

export function readGlobalEyeConfig(): GlobalEyeConfig {
	const rawUrl = process.env.GLOBALEYE_URL?.trim();
	const username = process.env.GLOBALEYE_USERNAME?.trim();
	const password = process.env.GLOBALEYE_PASSWORD;
	if (!rawUrl || !username || !password) {
		throw new Error("缺全球眼配置:请在 .env.local 填 GLOBALEYE_URL / GLOBALEYE_USERNAME / GLOBALEYE_PASSWORD");
	}
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("GLOBALEYE_URL 不是合法地址(应形如 https://host:port)");
	}
	return { base: url.origin, username, password };
}

/** 32 位小写十六进制 MD5 */
function md5(text: string): string {
	return createHash("md5").update(text, "utf8").digest("hex");
}

/** 登录签名:共五次 MD5(与平台 Java/Python 版一致) */
export function globalEyeSignature(username: string, password: string, realm: string, randomKey: string): string {
	let signature = md5(password);
	signature = md5(username + signature);
	signature = md5(signature);
	signature = md5(`${username}:${realm}:${signature}`);
	signature = md5(`${signature}:${randomKey}`);
	return signature;
}

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

type Result = { result: number; msg: string; data: unknown };

/** 平台把鉴权失败藏在 `data.code = 401`(而 `result` 仍是 0)—— 用它区分"该重新登录" */
class GlobalEyeAuthError extends Error {}

/**
 * 解释一次响应:
 * - 空响应体(如 keepalive 成功)= 成功;
 * - `data.code` 非 0 = 失败(401 视为鉴权失效);
 * - 否则看 `result`。
 */
function interpret(text: string): Result {
	if (!text.trim()) return { result: 0, msg: "", data: null };
	let result: Result;
	try {
		const payload: unknown = JSON.parse(text);
		const record = payload && typeof payload === "object" && "result" in payload ? (payload as Json) : null;
		result = record
			? { result: Number(record.result ?? 0) || 0, msg: String(record.msg ?? ""), data: record.data }
			: { result: 0, msg: "", data: payload };
	} catch {
		throw new Error(`全球眼接口返回非 JSON:${text.slice(0, 200)}`);
	}
	const data = asRecord(result.data);
	const code = Number(data.code ?? 0);
	if (code >= 400) {
		const message = String(data.message ?? "");
		if (code === 401) throw new GlobalEyeAuthError(message || "auth token is invalid");
		throw new Error(message || `全球眼接口返回 code=${code}`);
	}
	if (result.result !== 0) throw new Error(result.msg || `全球眼接口返回 result=${result.result}`);
	return result;
}

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

function rawRequest(
	config: GlobalEyeConfig,
	method: string,
	path: string,
	options: { params?: Record<string, string | number>; headers?: Record<string, string>; json?: unknown },
): Promise<string> {
	const url = new URL(path, config.base);
	for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, String(value));
	const body = options.json === undefined ? null : JSON.stringify(options.json);
	const headers: Record<string, string> = { accept: "application/json", ...(options.headers ?? {}) };
	if (body) headers["content-type"] = "application/json;charset=UTF-8";
	const insecure = (process.env.GLOBALEYE_VERIFY_TLS ?? "") !== "1";

	return new Promise((resolve, reject) => {
		const onResponse = (res: import("node:http").IncomingMessage) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				text += chunk;
			});
			res.on("end", () => resolve(text));
		};
		const req =
			url.protocol === "https:"
				? httpsRequest(url, { method, agent: agentFor(insecure).https, headers }, onResponse)
				: httpRequest(url, { method, agent: agentFor(insecure).http, headers }, onResponse);
		req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("全球眼请求超时")));
		req.on("error", reject);
		if (body) req.write(body);
		req.end();
	});
}

/** 平台接口调用(GET 遇**网络**错误重试;业务错误不重试) */
async function request(
	config: GlobalEyeConfig,
	method: string,
	path: string,
	options: { params?: Record<string, string | number>; headers?: Record<string, string>; json?: unknown } = {},
): Promise<Result> {
	const retries = method === "GET" ? GET_RETRIES : 0;
	let text = "";
	for (let attempt = 0; ; attempt += 1) {
		try {
			text = await rawRequest(config, method, path, options);
			break;
		} catch (error) {
			if (attempt >= retries) throw error;
			await sleep(250 * 2 ** attempt);
		}
	}
	return interpret(text);
}

async function authorize(config: GlobalEyeConfig): Promise<string> {
	const first = await request(config, "POST", AUTH_PATH, {
		json: { userName: config.username, clientType: CLIENT_TYPE, ipAddress: "127.0.0.1" },
	});
	const resData = asRecord(first.data);
	if (!resData.realm) throw new Error("全球眼登录失败(第一步)");

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
			clientType: CLIENT_TYPE,
			ipAddress: "127.0.0.1",
		},
	});
	const token = String(asRecord(second.data).token ?? "");
	if (!token) throw new Error("全球眼登录未返回 token");
	return token;
}

// ── token 单例 + 保活 ─────────────────────────────────────

let cachedToken: string | null = null;
let inflight: Promise<string> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function startKeepalive(config: GlobalEyeConfig): void {
	if (keepaliveTimer) return;
	keepaliveTimer = setInterval(() => {
		const token = cachedToken;
		if (!token) return;
		void request(config, "PUT", KEEPALIVE_PATH, {
			headers: { "X-Subject-Token": token },
			json: { token },
		}).catch((error) => {
			// 保活失败(含 token 失效)⇒ 丢掉缓存,下次调用重新登录
			logger.warn("globaleye.keepalive.failed", { message: error instanceof Error ? error.message : String(error) });
			cachedToken = null;
		});
	}, KEEPALIVE_MS);
	(keepaliveTimer as unknown as { unref?: () => void }).unref?.();
}

async function getToken(): Promise<string> {
	const config = readGlobalEyeConfig();
	if (cachedToken) return cachedToken;
	inflight ??= authorize(config)
		.then((token) => {
			cachedToken = token;
			startKeepalive(config);
			return token;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

function resetToken(): void {
	cachedToken = null;
}

/** 跑一次平台调用;遇到鉴权失效(`data.code = 401`)就重登一次再试 */
async function withAuthRetry<T>(run: (token: string) => Promise<T>): Promise<T> {
	let token = await getToken();
	try {
		return await run(token);
	} catch (error) {
		if (!(error instanceof GlobalEyeAuthError)) throw error;
		resetToken();
		token = await getToken();
		return run(token);
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 通道树 / 播放地址 ─────────────────────────────────────

async function deviceTreeItems(
	config: GlobalEyeConfig,
	token: string,
	nodeId: string,
	typeCode: string,
): Promise<Json[]> {
	const res = await request(config, "GET", DEVICE_TREE_PATH, {
		params: { id: nodeId, nodeType: 1, typeCode, page: 1, pageSize: 1000 },
		headers: { "X-Subject-Token": token },
	});
	const results = asRecord(res.data).results;
	return Array.isArray(results) ? (results as Json[]) : [];
}

export type GlobalEyeTree = { orgs: Json[]; devices: Json[]; channels: Json[] };

/** 遍历组织树,去重返回组织 / 设备 / 通道 */
export function collectGlobalEyeTree(): Promise<GlobalEyeTree> {
	const config = readGlobalEyeConfig();
	return withAuthRetry(async (token) => {
		const orgs: Json[] = [];
		const devices: Json[] = [];
		const channels: Json[] = [];
		const seenOrg = new Set<string>([""]);
		const seenDev = new Set<string>();
		const seenCh = new Set<string>();
		const queue = [""];
		while (queue.length > 0) {
			const orgId = queue.shift() ?? "";
			for (const typeCode of DEVICE_TREE_TYPE_CODES) {
				for (const item of await deviceTreeItems(config, token, orgId, typeCode)) {
					const nodeType = Number(item.nodeType ?? 0);
					if (nodeType === 1) {
						const id = String(item.id ?? "");
						if (id && !seenOrg.has(id)) {
							seenOrg.add(id);
							orgs.push(item);
							queue.push(id);
						}
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
		return { orgs, devices, channels };
	});
}

/** 取一个通道的 HLS 播放地址(浏览器直连) */
export function getGlobalEyeStreamUrl(channelId: string): Promise<string> {
	const config = readGlobalEyeConfig();
	return withAuthRetry(async (token) => {
		for (const subType of STREAM_SUB_TYPES) {
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const res = await request(config, "GET", REALMONITOR_PATH, {
					params: { channelId, subType, scheme: "HLS" },
					headers: { "X-Subject-Token": token },
				});
				const url = String(asRecord(res.data).url ?? "");
				if (url) return url;
				await sleep(250);
			}
		}
		throw new Error("平台暂未返回播放地址(通道可能正被占用或该码流不可用),请稍后重试");
	});
}

/** 极简 TTL 缓存 + 并发去重(进程内) */
export function createTtlCache<T>() {
	let entry: { at: number; value: T } | null = null;
	let inflight: Promise<T> | null = null;
	return {
		async get(loader: () => Promise<T>, ttlMs: number, force = false): Promise<T> {
			if (!force && entry && Date.now() - entry.at < ttlMs) return entry.value;
			inflight ??= loader()
				.then((value) => {
					entry = { at: Date.now(), value };
					return value;
				})
				.finally(() => {
					inflight = null;
				});
			return inflight;
		},
		clear(): void {
			entry = null;
		},
	};
}

const treeCache = createTtlCache<GlobalEyeTree>();

/** 通道树(默认吃缓存;`refresh` = 绕过缓存 + 重新登录) */
export function getGlobalEyeTree(refresh = false): Promise<GlobalEyeTree> {
	if (refresh) resetToken();
	return treeCache.get(() => collectGlobalEyeTree(), TREE_CACHE_MS, refresh);
}

// ── 平铺 → 树(纯函数)────────────────────────────────────

export type GlobalEyeNodeKind = "org" | "device" | "channel";
export type GlobalEyeNodeRow = {
	id: string;
	parentId: string | null;
	name: string;
	sort: number;
	kind: GlobalEyeNodeKind;
	online: boolean | null;
	raw: Json;
};

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value) return value;
		if (typeof value === "number") return String(value);
	}
	return null;
}

/** 平台可能给 true / 1 / "1" / "true" 之一,统一成布尔 */
function onlineValue(value: unknown): boolean {
	if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
	return Boolean(value);
}

export function toGlobalEyeTreeRows(input: GlobalEyeTree): GlobalEyeNodeRow[] {
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
			online: channel.isOnline == null ? null : onlineValue(channel.isOnline),
			raw: channel,
		});
	}
	return rows;
}
