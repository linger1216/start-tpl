import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { createReportWorkbook, previewReportWorkbook } from "../src/lib/task-report-excel.ts";
import { taskReportSchema } from "../src/lib/task-report-spec.ts";

const schema = taskReportSchema.parse({
	id: "report",
	kind: "TABLE",
	fields: [
		{ id: "name", label: "名称", type: "text", required: true },
		{ id: "quantity", label: "数量", type: "integer", required: true },
	],
});
function workbook(rows: unknown[][], sheets = 1) {
	const book = XLSX.utils.book_new();
	for (let index = 0; index < sheets; index++)
		XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), `sheet${index}`);
	return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

/**
 * 手搓一个「存储模式」的 zip —— 只为构造 XLSX 里那些**正常导出产不出来**的条目
 * (宏 / 外链 / 嵌入对象 / 带 DOCTYPE 的 XML),让 `inspectArchive` 的每条拒绝分支都有用例。
 * 压缩方法用 0(stored),不需要 deflate。
 */
function zip(entries: Array<{ name: string; text: string }>): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc32 = (buf: Buffer) => {
		let c = 0xffffffff;
		for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const data = Buffer.from(entry.text, "utf8");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += local.length + name.length + data.length;
	}
	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
}

const baseEntries = [{ name: "[Content_Types].xml", text: "<Types/>" }];
const asBase64 = (entries: Array<{ name: string; text: string }>) => zip(entries).toString("base64");

describe("填报 Excel", () => {
	it("模板与数据往返，错误行定位到原 Excel 行", async () => {
		const encoded = createReportWorkbook(schema, [{ name: "甲", quantity: 2 }]).toString("base64");
		const preview = await previewReportWorkbook(schema, encoded);
		assert.deepEqual(preview.value, [{ name: "甲", quantity: 2 }]);
		assert.deepEqual(preview.issues, []);
		const invalid = workbook([["name", "quantity"], ["名称", "数量"], [], ["乙", "abc"]]);
		const result = await previewReportWorkbook(schema, invalid.toString("base64"));
		assert.equal(result.issues[0].excelRow, 4);
		assert.equal(result.issues[0].field, "quantity");
	});
	it("支持列映射且不接受重复列", async () => {
		const encoded = workbook([
			["列一", "列二"],
			["名称", "数量"],
			["甲", "3"],
		]).toString("base64");
		assert.ok((await previewReportWorkbook(schema, encoded)).mappingError);
		assert.deepEqual((await previewReportWorkbook(schema, encoded, { name: 0, quantity: 1 })).value, [
			{ name: "甲", quantity: 3 },
		]);
		assert.ok((await previewReportWorkbook(schema, encoded, { name: 0, quantity: 0 })).mappingError);
	});
	it("拒绝损坏文件、多工作表、公式、超大解压数据", async () => {
		await assert.rejects(() => previewReportWorkbook(schema, Buffer.from("invalid").toString("base64")));
		await assert.rejects(
			() =>
				previewReportWorkbook(
					schema,
					workbook(
						[
							["name", "quantity"],
							["名称", "数量"],
						],
						2,
					).toString("base64"),
				),
			/单个/,
		);
		const book = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			["name", "quantity"],
			["名称", "数量"],
			["甲", 1],
		]);
		sheet.B3 = { t: "n", f: "1+1", v: 2 };
		XLSX.utils.book_append_sheet(book, sheet, "sheet");
		await assert.rejects(
			() =>
				previewReportWorkbook(
					schema,
					(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64"),
				),
			/公式/,
		);
		const bomb = workbook([
			["name", "quantity"],
			["名称", "数量"],
			...Array.from({ length: 700 }, () => ["x".repeat(32700), 1]),
		]);
		await assert.rejects(() => previewReportWorkbook(schema, bomb.toString("base64")), /超过|限制/);
	});
	it("危险文本导出为安全字符串", () => {
		const book = XLSX.read(createReportWorkbook(schema, [{ name: "=1+1", quantity: 1 }]), { type: "buffer" });
		const cell = book.Sheets[book.SheetNames[0]].A3;
		assert.equal(cell.f, undefined);
		assert.equal(cell.v, "'=1+1");
	});
	it("拒绝宏、外链、嵌入对象与外部实体", async () => {
		await assert.rejects(
			() => previewReportWorkbook(schema, asBase64([...baseEntries, { name: "xl/vbaProject.bin", text: "x" }])),
			/不允许/,
		);
		await assert.rejects(
			() =>
				previewReportWorkbook(
					schema,
					asBase64([...baseEntries, { name: "xl/externalLinks/externalLink1.xml", text: "<x/>" }]),
				),
			/不允许/,
		);
		await assert.rejects(
			() =>
				previewReportWorkbook(schema, asBase64([...baseEntries, { name: "xl/embeddings/oleObject1.bin", text: "x" }])),
			/不允许/,
		);
		await assert.rejects(
			() =>
				previewReportWorkbook(
					schema,
					asBase64([
						...baseEntries,
						{ name: "xl/workbook.xml", text: '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><workbook/>' },
					]),
				),
			/不支持/,
		);
		await assert.rejects(
			() =>
				previewReportWorkbook(
					schema,
					asBase64([...baseEntries, { name: "xl/workbook.xml", text: '<x TargetMode="External"/>' }]),
				),
			/不支持/,
		);
	});
});
