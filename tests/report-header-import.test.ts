import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportFieldsFromHeaders } from "../src/lib/task/report-header-import.ts";

describe("Excel 表头生成填报字段", () => {
	it("清理空表头并保留其余列名", () => {
		const result = reportFieldsFromHeaders([" 姓名 ", "", null, 2026], [], () => "field");
		assert.deepEqual(result.fields, [
			{ id: "field", label: "姓名" },
			{ id: "field_2", label: "2026" },
		]);
		assert.equal(result.skippedLong, 0);
	});

	it("避开现有标识和重复表头生成的标识", () => {
		const result = reportFieldsFromHeaders(["姓名", "姓名"], ["name"], () => "name");
		assert.deepEqual(result.fields, [
			{ id: "name_2", label: "姓名" },
			{ id: "name_3", label: "姓名" },
		]);
	});

	it("跳过超过字段标签长度上限的表头", () => {
		const result = reportFieldsFromHeaders(["x".repeat(101), "有效"], [], () => "field");
		assert.deepEqual(result.fields, [{ id: "field", label: "有效" }]);
		assert.equal(result.skippedLong, 1);
	});
});
