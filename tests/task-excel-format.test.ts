import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { mergeTaskExcelWorkbooks } from "../src/lib/task/report-excel";

test("Excel 汇总保留模板文件及数据行格式", async () => {
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		book,
		XLSX.utils.aoa_to_sheet([
			["名称", "数量"],
			["样例", 1],
		]),
		"填报",
	);
	XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["说明"]]), "说明");
	const raw = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
	const templateZip = await JSZip.loadAsync(raw);
	const originalSheet = await templateZip.file("xl/worksheets/sheet1.xml")?.async("string");
	assert.ok(originalSheet);
	templateZip.file(
		"xl/worksheets/sheet1.xml",
		originalSheet
			.replace('<row r="2">', '<row r="2" ht="25" customHeight="1">')
			.replace('<c r="A2"', '<c r="A2" s="1"'),
	);
	const template = await templateZip.generateAsync({ type: "nodebuffer" });
	const child = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		child,
		XLSX.utils.aoa_to_sheet([
			["名称", "数量"],
			["甲", 0],
			["乙", 3],
		]),
		"填报",
	);
	const result = await mergeTaskExcelWorkbooks(
		template,
		[XLSX.write(child, { type: "buffer", bookType: "xlsx" }) as Buffer],
		"填报",
		2,
	);
	const outputZip = await JSZip.loadAsync(result);
	const outputSheet = await outputZip.file("xl/worksheets/sheet1.xml")?.async("string");
	assert.match(outputSheet ?? "", /r="A3" s="1"/);
	assert.match(outputSheet ?? "", /r="3" ht="25" customHeight="1"/);
	assert.equal(
		await outputZip.file("xl/worksheets/sheet2.xml")?.async("string"),
		await templateZip.file("xl/worksheets/sheet2.xml")?.async("string"),
	);
	const parsed = XLSX.read(result, { type: "buffer" });
	assert.deepEqual(XLSX.utils.sheet_to_json(parsed.Sheets.填报, { header: 1 }), [
		["名称", "数量"],
		["甲", 0],
		["乙", 3],
	]);
});
