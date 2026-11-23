import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createTtlCache, globalEyeSignature, readGlobalEyeConfig, toGlobalEyeTreeRows } from "../src/lib/global-eye.ts";

describe("全球眼:登录签名(5 次 MD5)", () => {
	it("顺序 / 拼接与 Python 版一致", () => {
		assert.equal(globalEyeSignature("admin", "123456", "realm-A", "rk-123"), "763006119ce85f878f36310606533f5c");
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
		assert.equal(byId.get("o1")?.parentId, null);
		assert.equal(byId.get("d1")?.parentId, "o1");
		assert.equal(byId.get("c1")?.parentId, "d1");
		assert.equal(byId.get("c1")?.online, true);
	});

	it("通道没有设备字段时退化到组织;缺 id 的节点被跳过", () => {
		const rows = toGlobalEyeTreeRows({
			orgs: [{ id: "o1", name: "组织" }],
			devices: [],
			channels: [{ channelId: "c1", orgCode: "o1", isOnline: false }, { name: "没有 id 的通道" }],
		});
		const byId = new Map(rows.map((row) => [row.id, row]));
		assert.equal(byId.get("c1")?.parentId, "o1");
		assert.equal(rows.length, 2);
	});
});

describe("全球眼:TTL 缓存", () => {
	it("并发只加载一次;TTL 内命中;force 绕过", async () => {
		let calls = 0;
		const deferred: { resolve?: () => void } = {};
		const cache = createTtlCache<number>();
		const loader = () =>
			new Promise<number>((resolve) => {
				calls += 1;
				deferred.resolve = () => resolve(calls);
			});

		const first = cache.get(loader, 60_000);
		const concurrent = cache.get(loader, 60_000);
		assert.equal(calls, 1);
		deferred.resolve?.();
		assert.equal(await first, 1);
		assert.equal(await concurrent, 1);

		assert.equal(await cache.get(loader, 60_000), 1);
		assert.equal(calls, 1);

		const forced = cache.get(loader, 60_000, true);
		deferred.resolve?.();
		assert.equal(await forced, 2);
	});
});

describe("全球眼:配置读取", () => {
	const saved: Record<string, string | undefined> = {};
	const keys = ["GLOBALEYE_URL", "GLOBALEYE_USERNAME", "GLOBALEYE_PASSWORD"];
	before(() => {
		for (const key of keys) saved[key] = process.env[key];
	});
	after(() => {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it("缺 URL / 用户名 / 密码时抛错", () => {
		delete process.env.GLOBALEYE_URL;
		delete process.env.GLOBALEYE_USERNAME;
		delete process.env.GLOBALEYE_PASSWORD;
		assert.throws(() => readGlobalEyeConfig(), /缺全球眼配置/);
	});

	it("URL 非法时抛错", () => {
		process.env.GLOBALEYE_URL = "not a url";
		process.env.GLOBALEYE_USERNAME = "u";
		process.env.GLOBALEYE_PASSWORD = "p";
		assert.throws(() => readGlobalEyeConfig(), /GLOBALEYE_URL 不是合法地址/);
	});

	it("从 URL 取 base(协议 + 主机 + 端口)", () => {
		process.env.GLOBALEYE_URL = "https://10.0.0.1:8282/whatever";
		process.env.GLOBALEYE_USERNAME = "u";
		process.env.GLOBALEYE_PASSWORD = "p";
		assert.equal(readGlobalEyeConfig().base, "https://10.0.0.1:8282");
	});
});
