/**
 * 任务内容块纯函数回归 —— `normalizePayload`(服务端落库口径)与 `parseBlock`(前端容错渲染口径)。
 * 无副作用、不碰库,所以不用 helpers。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contentSummary, normalizePayload, parseBlock } from "../src/lib/task-content.ts";

describe("normalizePayload", () => {
	it("trim 文本 / 丢弃空块 / 附件去重去空 / 保持顺序", () => {
		const out = normalizePayload({
			content: [
				{ kind: "text", text: "  巡检冷却塔  " },
				{ kind: "text", text: "   " }, // 空文本 → 丢
				{ kind: "ref", path: "  /settings/users  ", title: "  张三  ", query: { q: " 张三 ", "": "x" } },
			],
			attachments: ["f1", " f1 ", "", "f2"],
		});
		assert.ok(out);
		assert.deepEqual(out.content, [
			{ kind: "text", text: "巡检冷却塔" },
			{ kind: "ref", path: "/settings/users", title: "张三", query: { q: "张三" } },
		]);
		assert.deepEqual(out.attachments, ["f1", "f2"]);
	});

	it("非法的 ref / link 被丢掉(路径不以 / 开头、url 不是 http)", () => {
		const out = normalizePayload({
			content: [
				{ kind: "ref", path: "settings/users", title: "缺斜杠" },
				{ kind: "link", url: "ftp://x", title: "非 http" },
				{ kind: "link", url: "https://ok.example", title: "好" },
			],
		});
		assert.deepEqual(out?.content, [{ kind: "link", url: "https://ok.example", title: "好" }]);
	});

	it("全空 → null(库里存 NULL,不存空壳)", () => {
		assert.equal(normalizePayload({ content: [{ kind: "text", text: " " }] }), null);
		assert.equal(normalizePayload(null), null);
	});

	it("表格列去空 key,行只保留列里的键", () => {
		const out = normalizePayload({
			content: [
				{
					kind: "table",
					columns: [
						{ key: " name ", label: "点位" },
						{ key: "", label: "无键" },
					],
					rows: [{ name: "冷却塔", junk: "x" }],
				},
			],
		});
		assert.deepEqual(out?.content, [
			{ kind: "table", columns: [{ key: "name", label: "点位" }], rows: [{ name: "冷却塔" }] },
		]);
	});
});

describe("parseBlock(容错渲染)", () => {
	it("认不出的 kind / 坏数据 → null,交给前端占位", () => {
		assert.equal(parseBlock({ kind: "progress", value: 3 }), null);
		assert.equal(parseBlock(null), null);
		assert.equal(parseBlock({ kind: "text", text: "   " }), null);
		assert.equal(parseBlock({ kind: "table", columns: [] }), null);
	});

	it("合法块原样解析", () => {
		assert.deepEqual(parseBlock({ kind: "text", text: "hi" }), { kind: "text", text: "hi" });
	});

	it("contentSummary 拼接各块摘要", () => {
		assert.equal(
			contentSummary([
				{ kind: "text", text: "巡检" },
				{ kind: "table", columns: [{ key: "a", label: "A" }], rows: [{ a: "1" }] },
				{ kind: "link", url: "https://x.example", title: "规范" },
			]),
			"巡检 · 表格(1 行) · 规范",
		);
	});
});
