import assert from "node:assert/strict";
import { test } from "node:test";
import { formatParaJson } from "../src/lib/para-spec.ts";

test("格式化 JSON 时保留数字精度、转义字符和空容器", () => {
	const input =
		'{"large":9007199254740993,"decimal":1.234567890123456789,"text":"a \\"b\\"","empty":[],"nested":{"x":1e400}}';
	assert.equal(
		formatParaJson(input),
		'{\n  "large": 9007199254740993,\n  "decimal": 1.234567890123456789,\n  "text": "a \\"b\\"",\n  "empty": [],\n  "nested": {\n    "x": 1e400\n  }\n}',
	);
	assert.throws(() => formatParaJson("{"));
});
