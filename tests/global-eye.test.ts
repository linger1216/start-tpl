import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
	globalEyeSignature,
	isHlsPlaylist,
	readGlobalEyeConfig,
	rewriteHlsPlaylist,
	signGlobalEyeTarget,
	toGlobalEyeProxyUrl,
	toGlobalEyeTreeRows,
	verifyGlobalEyeTarget,
} from "../src/lib/global-eye.ts";

/**
 * 全球眼 —— **纯函数**回归(不联网)。
 *
 * 协议本身(HTTP)靠人工按 `doc/全球眼视频.md` 冒烟;这里守住最容易写错、也最难肉眼发现的两处:
 * ① 登录签名(5 次 MD5)的**顺序与拼接**;② 平铺目录 → 树的**父子字段映射**。
 */
describe("全球眼:登录签名(5 次 MD5)", () => {
	it("顺序 / 拼接与 Python 版逐字一致", () => {
		// 期望值由独立的 node:crypto 实现算出(与源端口径一致,Python `get_sign` 同款)
		const expected = "763006119ce85f878f36310606533f5c";
		assert.equal(globalEyeSignature("admin", "123456", "realm-A", "rk-123"), expected);
		assert.equal(globalEyeSignature("admin", "123456", "realm-A", "rk-123").length, 32);
	});

	it("realm / randomKey 变化会改变结果", () => {
		const base = globalEyeSignature("admin", "123456", "realm-A", "rk-123");
		assert.notEqual(globalEyeSignature("admin", "123456", "realm-B", "rk-123"), base);
		assert.notEqual(globalEyeSignature("admin", "123456", "realm-A", "rk-999"), base);
	});
});

describe("全球眼:目录拼树", () => {
	it("组织 / 设备 / 通道的父子关系与字段映射", () => {
		const rows = toGlobalEyeTreeRows({
			orgs: [{ id: "o1", name: "上海公司", parentId: "" }],
			devices: [{ deviceCode: "d1", name: "录像机", parentId: "o1" }],
			channels: [{ channelId: "c1", channelName: "大门", deviceCode: "d1", isOnline: true }],
		});
		const byId = new Map(rows.map((row) => [row.id, row]));

		// 根组织的 parentId 归一成 null(`""` 不是已存在的组织)
		assert.equal(byId.get("o1")?.parentId, null);
		assert.equal(byId.get("o1")?.kind, "org");
		// 设备挂在组织下
		assert.equal(byId.get("d1")?.parentId, "o1");
		assert.equal(byId.get("d1")?.kind, "device");
		// 通道挂在设备下,带在线状态与完整原始字段
		assert.equal(byId.get("c1")?.parentId, "d1");
		assert.equal(byId.get("c1")?.kind, "channel");
		assert.equal(byId.get("c1")?.online, true);
		assert.deepEqual(byId.get("c1")?.raw, { channelId: "c1", channelName: "大门", deviceCode: "d1", isOnline: true });
	});

	it("通道没有设备字段时退化到组织;没有可用 id 的节点被跳过", () => {
		const rows = toGlobalEyeTreeRows({
			orgs: [{ id: "o1", name: "组织" }],
			devices: [],
			channels: [{ channelId: "c1", orgCode: "o1", isOnline: false }, { name: "没有 id 的通道" }],
		});
		const byId = new Map(rows.map((row) => [row.id, row]));
		assert.equal(byId.get("c1")?.parentId, "o1");
		assert.equal(byId.get("c1")?.online, false);
		assert.equal(rows.length, 2, "缺 id 的通道被跳过");
	});
});

describe("全球眼:配置读取", () => {
	const saved: Record<string, string | undefined> = {};
	const keys = ["GLOBALEYE_HOST", "GLOBALEYE_USERNAME", "GLOBALEYE_PASSWORD", "GLOBALEYE_SCHEME", "GLOBALEYE_PORT"];
	before(() => {
		for (const key of keys) saved[key] = process.env[key];
	});
	after(() => {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it("缺 host / 用户名 / 密码时抛中文错误", () => {
		delete process.env.GLOBALEYE_HOST;
		delete process.env.GLOBALEYE_USERNAME;
		delete process.env.GLOBALEYE_PASSWORD;
		assert.throws(() => readGlobalEyeConfig(), /缺全球眼配置/);
	});

	it("配齐后拼出 base(默认 https / 8282)", () => {
		process.env.GLOBALEYE_HOST = "10.0.0.1";
		process.env.GLOBALEYE_USERNAME = "u";
		process.env.GLOBALEYE_PASSWORD = "p";
		delete process.env.GLOBALEYE_SCHEME;
		delete process.env.GLOBALEYE_PORT;
		const config = readGlobalEyeConfig();
		assert.equal(config.base, "https://10.0.0.1:8282");
		assert.equal(config.streamScheme, "HLS");
	});
});

describe("全球眼:播放代理", () => {
	it("签名可验证,篡改即失效", () => {
		const target = "https://media.example.com/live/index.m3u8?token=abc";
		const signature = signGlobalEyeTarget(target);
		assert.ok(verifyGlobalEyeTarget(target, signature));
		assert.equal(verifyGlobalEyeTarget(target, "0".repeat(signature.length)), false);
		assert.equal(verifyGlobalEyeTarget(`${target}x`, signature), false);
	});

	it("toGlobalEyeProxyUrl 带可校验的 u / s", () => {
		const target = "https://media.example.com/live/index.m3u8";
		const url = new URL(toGlobalEyeProxyUrl(target), "https://app.local");
		assert.equal(url.pathname, "/api/globaleye/stream");
		const u = url.searchParams.get("u");
		const s = url.searchParams.get("s");
		assert.equal(u, target);
		assert.ok(u && s);
		assert.ok(verifyGlobalEyeTarget(u, s));
	});

	it("改写 HLS:相对 / 绝对分片与 URI 属性都换成代理地址", () => {
		const base = "https://media.example.com/live/index.m3u8";
		const input = [
			"#EXTM3U",
			"#EXT-X-VERSION:3",
			'#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
			"#EXTINF:10,",
			"seg1.ts",
			"#EXTINF:10,",
			"https://media.example.com/live/seg2.ts",
		].join("\n");
		const lines = rewriteHlsPlaylist(input, base).split("\n");

		// 普通标签原样保留
		assert.equal(lines[0], "#EXTM3U");
		assert.equal(lines[1], "#EXT-X-VERSION:3");
		// 密钥属性里的 URI 被改写
		const keyMatch = lines[2].match(/URI="([^"]+)"/);
		assert.ok(keyMatch);
		assert.equal(
			new URL(keyMatch[1], "https://app.local").searchParams.get("u"),
			"https://media.example.com/live/key.bin",
		);
		// 相对分片
		assert.equal(
			new URL(lines[4], "https://app.local").searchParams.get("u"),
			"https://media.example.com/live/seg1.ts",
		);
		// 绝对分片
		assert.equal(
			new URL(lines[6], "https://app.local").searchParams.get("u"),
			"https://media.example.com/live/seg2.ts",
		);
	});

	it("isHlsPlaylist 认 content-type 与扩展名", () => {
		assert.equal(isHlsPlaylist("application/vnd.apple.mpegurl", "/x"), true);
		assert.equal(isHlsPlaylist(undefined, "/live/index.m3u8"), true);
		assert.equal(isHlsPlaylist("video/mp2t", "/live/seg1.ts"), false);
	});
});
