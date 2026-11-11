/**
 * 任务链接块纯函数回归 —— `normalizePayload`(服务端落库口径)、`parseBlock`(前端容错渲染口径)
 * 与 `isInternalUrl`(站内 / 站外判定)。
 * 无副作用、不碰库,所以不用 helpers。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isInternalUrl, linkSummary, normalizePayload, parseBlock } from "../src/lib/task-payload.ts";

describe("normalizePayload", () => {
	it("trim URL / 去重 / 丢弃空与形状不对的 / 附件去重去空", () => {
		const out = normalizePayload({
			links: [
				{ kind: "link", url: "  /settings/users  " },
				{ kind: "link", url: "/settings/users" }, // 重复 → 丢
				{ kind: "link", url: "   " }, // 空 → 丢
				{ kind: "link", url: "not a url" }, // 形状不对 → 丢
				{ kind: "link", url: "https://ok.example" },
			],
			attachments: ["f1", " f1 ", "", "f2"],
		});
		assert.ok(out);
		assert.deepEqual(out.links, [
			{ kind: "link", url: "/settings/users" },
			{ kind: "link", url: "https://ok.example" },
		]);
		assert.deepEqual(out.attachments, ["f1", "f2"]);
	});

	it("全空 → null(库里存 NULL,不存空壳)", () => {
		assert.equal(normalizePayload({ links: [{ kind: "link", url: " " }] }), null);
		assert.equal(normalizePayload(null), null);
	});

	it("老块类型(文字 / 表格 / 内部页面)不再写回库", () => {
		const out = normalizePayload({
			links: [
				{ kind: "link", url: "/ok" },
				// biome-ignore lint/suspicious/noExplicitAny: 模拟老数据
				{ kind: "text", text: "旧文字" } as any,
				// biome-ignore lint/suspicious/noExplicitAny: 模拟老数据
				{ kind: "ref", path: "/settings/users", title: "旧内部页面" } as any,
			],
		});
		assert.deepEqual(out?.links, [{ kind: "link", url: "/ok" }]);
	});
});

describe("parseBlock(容错渲染)", () => {
	it("认不出的 kind / 坏数据 → null,交给前端占位", () => {
		assert.equal(parseBlock({ kind: "progress", value: 3 }), null);
		assert.equal(parseBlock(null), null);
		assert.equal(parseBlock({ kind: "text", text: "旧文字" }), null, "文字块已取消");
		assert.equal(parseBlock({ kind: "table", columns: [] }), null, "表格块已取消");
		assert.equal(parseBlock({ kind: "link", url: "ftp://x" }), null, "非 http(s) 不算链接");
	});

	it("合法链接原样解析;老 ref 块折成链接(不丢内容)", () => {
		assert.deepEqual(parseBlock({ kind: "link", url: "https://x.example" }), {
			kind: "link",
			url: "https://x.example",
		});
		assert.deepEqual(parseBlock({ kind: "ref", path: "/settings/users", query: { q: "张三" } }), {
			kind: "link",
			url: "/settings/users?q=%E5%BC%A0%E4%B8%89",
		});
	});

	it("linkSummary 拼接各条 URL", () => {
		assert.equal(
			linkSummary([
				{ kind: "link", url: "/settings/users" },
				{ kind: "link", url: "https://x.example" },
			]),
			"/settings/users · https://x.example",
		);
	});
});

describe("isInternalUrl", () => {
	it("相对路径算站内,绝对域名算站外", () => {
		assert.equal(isInternalUrl("/settings/users"), true);
		assert.equal(isInternalUrl("/"), true);
		assert.equal(isInternalUrl("https://example.com/a"), false);
		assert.equal(isInternalUrl("not a url"), false);
	});
});
