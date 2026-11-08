import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { writeSheet, writeTemplate } from "../src/lib/excel.ts";

XLSX.set_fs(fs);

test("Excel 导出保留表头、数字和多值字段，导入模板只有表头", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "stack-excel-test-"));
	try {
		const columns = [
			{ key: "name", label: "名称" },
			{ key: "count", label: "数量" },
			{ key: "tags", label: "标签" },
		] as const;
		assert.equal(
			writeSheet({ columns, rows: [{ name: "示例", count: 3, tags: ["甲", "乙"] }], fileName: path.join(dir, "导出") }),
			1,
		);
		writeTemplate({ columns, fileName: path.join(dir, "模板") });
		const exportName = readdirSync(dir).find((name) => name.startsWith("导出-"));
		assert.ok(exportName);
		const book = XLSX.read(readFileSync(path.join(dir, exportName)), { type: "buffer" });
		assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }), [
			["名称", "数量", "标签"],
			["示例", 3, "甲、乙"],
		]);
		const template = XLSX.read(readFileSync(path.join(dir, "模板.xlsx")), { type: "buffer" });
		assert.deepEqual(XLSX.utils.sheet_to_json(template.Sheets[template.SheetNames[0]], { header: 1 }), [
			["名称", "数量", "标签"],
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
