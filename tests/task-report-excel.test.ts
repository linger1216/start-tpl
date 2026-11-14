import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { createReportWorkbook, previewReportWorkbook } from "../src/lib/task/report-excel.ts";
import { taskReportSchema } from "../src/lib/task/report-spec.ts";

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
	it("附件字段导出后可作为机器数据导入", async () => {
		const form = taskReportSchema.parse({
			id: "files",
			kind: "OBJECT",
			fields: [
				{ id: "phone", label: "手机号", type: "phone" },
				{ id: "files", label: "附件", type: "attachment" },
			],
		});
		const original = { phone: "13812345678", files: ["-file-a", "file-b"] };
		const encoded = createReportWorkbook(form, original).toString("base64");
		const result = await previewReportWorkbook(form, encoded);
		assert.deepEqual(result.issues, []);
		assert.deepEqual(result.value, original);
		const legacy = workbook([
			["手机号", "附件"],
			["13812345678", "file-a;file-b"],
		]);
		assert.deepEqual((await previewReportWorkbook(form, legacy.toString("base64"))).value, {
			phone: "13812345678",
			files: ["file-a", "file-b"],
		});
	});
	it("模板与数据往返，错误行定位到原 Excel 行", async () => {
		const encoded = createReportWorkbook(schema, [{ name: "甲", quantity: 2 }]).toString("base64");
		const preview = await previewReportWorkbook(schema, encoded);
		assert.deepEqual(preview.value, [{ name: "甲", quantity: 2 }]);
		assert.deepEqual(preview.issues, []);
		const invalid = workbook([["名称", "数量"], [], ["乙", "abc"]]);
		const result = await previewReportWorkbook(schema, invalid.toString("base64"));
		assert.equal(result.issues[0].excelRow, 3);
		assert.equal(result.issues[0].field, "quantity");
	});
	it("表头按字段名称匹配,对不上就报错", async () => {
		const chinese = workbook([
			["名称", "数量"],
			["甲", "3"],
		]).toString("base64");
		assert.deepEqual((await previewReportWorkbook(schema, chinese)).value, [{ name: "甲", quantity: 3 }]);
		const wrongHeader = workbook([
			["name", "quantity"],
			["名称", "数量"],
		]).toString("base64");
		await assert.rejects(() => previewReportWorkbook(schema, wrongHeader), /表头/);
		// 表头对不上模板字段:直接报错,不猜
		const unknown = workbook([
			["列一", "列二"],
			["甲", "3"],
		]).toString("base64");
		await assert.rejects(() => previewReportWorkbook(schema, unknown), /表头/);
	});
	it("拒绝损坏文件、找不到「填报」的多表文件、公式、超大解压数据", async () => {
		await assert.rejects(() => previewReportWorkbook(schema, Buffer.from("invalid").toString("base64")));
		// 多张表但没有名为「填报」的那张 → 报错,不去瞎猜一张
		await assert.rejects(
			() => previewReportWorkbook(schema, workbook([["名称", "数量"]], 2).toString("base64")),
			/找不到「填报」/,
		);
		const book = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			["名称", "数量"],
			["甲", 1],
		]);
		sheet.B2 = { t: "n", f: "1+1", v: 2 };
		XLSX.utils.book_append_sheet(book, sheet, "sheet");
		await assert.rejects(
			() =>
				previewReportWorkbook(
					schema,
					(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64"),
				),
			/公式/,
		);
		const bomb = workbook([["名称", "数量"], ...Array.from({ length: 700 }, () => ["x".repeat(32700), 1])]);
		await assert.rejects(() => previewReportWorkbook(schema, bomb.toString("base64")), /超过|限制/);
	});
	it("危险文本导出为安全字符串", () => {
		const book = XLSX.read(createReportWorkbook(schema, [{ name: "=1+1", quantity: 1 }]), { type: "buffer" });
		// 表头只有一行(中文名),数据从第 2 行起
		const cell = book.Sheets[book.SheetNames[0]].A2;
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

describe("父任务导出:父子所有填报数据", () => {
	const form = taskReportSchema.parse({
		id: "report",
		kind: "OBJECT",
		fields: [
			{ id: "town", label: "街镇", type: "text" },
			{ id: "quantity", label: "数量", type: "integer" },
		],
	});

	it("表单填报:父任务那份进「填报」,每个已保存的子任务一行进「子任务填报」", () => {
		const book = XLSX.read(
			createReportWorkbook(
				form,
				{ town: "父镇", quantity: 1 },
				{
					readable: true,
					parentLayout: true,
					children: [
						{ owner: "张三", payload: { town: "甲镇", quantity: 2 } },
						{ owner: "李四", payload: { town: "乙镇", quantity: 3 } },
					],
				},
			),
			{ type: "buffer" },
		);
		assert.deepEqual(book.SheetNames, ["父任务填报(可读)", "父任务填报", "子任务填报(可读)", "子任务填报"]);
		const grids = book.SheetNames.map((name) =>
			XLSX.utils.sheet_to_json<string[]>(book.Sheets[name] ?? {}, { header: 1 }),
		);
		const own = [
			["街镇", "数量"],
			["父镇", 1],
		];
		const children = [
			["执行人", "街镇", "数量"],
			["张三", "甲镇", 2],
			["李四", "乙镇", 3],
		];
		assert.deepEqual(grids[0], own, "父任务填报(可读)");
		assert.deepEqual(grids[1], own, "父任务填报");
		assert.deepEqual(grids[2], children, "子任务填报(可读)");
		assert.deepEqual(grids[3], children, "子任务填报");
	});

	it("没有子任务(或表格填报)时不附加那张表 —— 第一张表仍可直接导回来", () => {
		const book = XLSX.read(createReportWorkbook(form, { town: "父镇", quantity: 1 }), { type: "buffer" });
		assert.deepEqual(book.SheetNames, ["填报"]);
	});
});

describe("可读导出:给人看的那张表", () => {
	const form = taskReportSchema.parse({
		id: "report",
		kind: "OBJECT",
		fields: [
			{ id: "town", label: "街镇", type: "text" },
			{ id: "tags", label: "标签", type: "multiselect", options: ["甲", "乙"] },
			{ id: "proof", label: "材料", type: "attachment" },
			{
				id: "people",
				label: "人员",
				type: "array",
				itemFields: [
					{ id: "name", label: "姓名", type: "text" },
					{ id: "pic", label: "照片", type: "attachment" },
				],
			},
		],
	});

	const gridOf = (book: XLSX.WorkBook, sheet: string) =>
		XLSX.utils.sheet_to_json<string[]>(book.Sheets[sheet] ?? {}, { header: 1, defval: "" });
	const cell = (book: XLSX.WorkBook, sheet: string, row = 1, column = 0) => gridOf(book, sheet)[row]?.[column] ?? "";

	it("附件写文件名、数组写成条目、多选顿号分隔;机器表仍是 id 与 JSON", () => {
		const book = XLSX.read(
			createReportWorkbook(
				form,
				{
					town: "七宝镇",
					tags: ["甲", "乙"],
					proof: ["f1", "f2"],
					people: [
						{ name: "张三", pic: ["f3"] },
						{ name: "李四", pic: [] },
					],
				},
				{ readable: true, fileNames: { f1: "报告.pdf", f2: "照片.png", f3: "证件.jpg" } },
			),
			{ type: "buffer" },
		);
		assert.equal(cell(book, "填报(可读)", 1, 0), "七宝镇");
		assert.equal(cell(book, "填报(可读)", 1, 1), "甲、乙");
		assert.equal(cell(book, "填报(可读)", 1, 2), "报告.pdf、照片.png");
		assert.equal(cell(book, "填报(可读)", 1, 3), "1) 姓名:张三，照片:证件.jpg；2) 姓名:李四，照片:");
		assert.equal(cell(book, "填报", 1, 2), "f1;f2");
		assert.equal(JSON.parse(cell(book, "填报", 1, 3)).length, 2);
	});

	it("缺文件名的附件退回 id,不吐占位符", () => {
		const book = XLSX.read(createReportWorkbook(form, { proof: ["f9"] }, { readable: true }), { type: "buffer" });
		assert.equal(cell(book, "填报(可读)", 1, 2), "f9");
	});

	it("导入认「填报」那张(可读表排在最前也不影响)", async () => {
		const file = createReportWorkbook(form, { town: "甲镇", tags: ["甲"] }, { readable: true });
		const parsed = await previewReportWorkbook(form, file.toString("base64"));
		assert.deepEqual(parsed.value, { town: "甲镇", tags: ["甲"], proof: null, people: null });
	});

	it("多表但里面没有「填报」→ 明确报错,不瞎认一张", async () => {
		const book = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["街镇"], ["甲镇"]]), "可读");
		XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["街镇"], ["乙镇"]]), "别的");
		const file = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
		await assert.rejects(() => previewReportWorkbook(form, file.toString("base64")), /找不到「填报」/);
	});
});

describe("父任务导出的四张表", () => {
	const table = taskReportSchema.parse({
		id: "report",
		kind: "TABLE",
		fields: [{ id: "town", label: "街镇", type: "text" }],
	});

	it("表格填报:子任务那两张按它自己那份行铺开,首列是执行人", () => {
		const book = XLSX.read(
			createReportWorkbook(table, [{ town: "甲镇" }, { town: "乙镇" }], {
				readable: true,
				parentLayout: true,
				children: [
					{ owner: "张三", payload: [{ town: "甲镇" }] },
					{ owner: "李四", payload: [{ town: "乙镇" }, { town: "丙镇" }] },
				],
			}),
			{ type: "buffer" },
		);
		assert.deepEqual(book.SheetNames, ["父任务填报(可读)", "父任务填报", "子任务填报(可读)", "子任务填报"]);
		const child = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[3] ?? ""] ?? {}, { header: 1 });
		assert.deepEqual(child, [
			["执行人", "街镇"],
			["张三", "甲镇"],
			["李四", "乙镇"],
			["李四", "丙镇"],
		]);
	});

	it("导入认「父任务填报」那张(父任务导出改完能导回父任务)", async () => {
		const file = createReportWorkbook(table, [{ town: "甲镇" }], {
			readable: true,
			parentLayout: true,
			children: [{ owner: "张三", payload: [{ town: "甲镇" }] }],
		});
		const parsed = await previewReportWorkbook(table, file.toString("base64"));
		assert.deepEqual(parsed.value, [{ town: "甲镇" }]);
	});

	it("有子任务但一个都没保存:只有父任务那一对(没有子任务可列)", () => {
		const book = XLSX.read(createReportWorkbook(table, [{ town: "甲镇" }], { readable: true, parentLayout: true }), {
			type: "buffer",
		});
		assert.deepEqual(book.SheetNames, ["父任务填报(可读)", "父任务填报"]);
	});
});

describe("日期口径:机器表存统一格式,可读表给本地时间,导入认本地写法", () => {
	const dated = taskReportSchema.parse({
		id: "report",
		kind: "OBJECT",
		fields: [
			{ id: "day", label: "日期", type: "date" },
			{ id: "moment", label: "时间", type: "datetime" },
		],
	});
	const iso = new Date(2026, 10, 14, 10, 23, 45).toISOString();

	it("可读表把 ISO 折成「YYYY-MM-DD HH:mm:ss」,机器表仍是 ISO(导入要认它)", () => {
		const book = XLSX.read(createReportWorkbook(dated, { day: "2026-11-14", moment: iso }, { readable: true }), {
			type: "buffer",
		});
		const grid = (index: number) =>
			XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[index] ?? ""] ?? {}, { header: 1 });
		assert.equal(grid(0)[1]?.[1], "2026-11-14 10:23:45", "可读表:本地时间");
		assert.equal(grid(0)[1]?.[0], "2026-11-14");
		assert.equal(grid(1)[1]?.[1], iso, "机器表:ISO 原样(能被校验接受)");
	});

	it("导入:人填的本地写法与 Excel 日期序列号都折成统一口径", async () => {
		const serial = Math.round((Date.UTC(2026, 10, 14) - Date.UTC(1899, 11, 30)) / 86_400_000);
		const book = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			book,
			XLSX.utils.aoa_to_sheet([
				["日期", "时间"],
				[serial, "2026-11-14 10:23"],
			]),
			"填报",
		);
		const parsed = await previewReportWorkbook(
			dated,
			XLSX.write(book, { type: "buffer", bookType: "xlsx" }).toString("base64"),
		);
		assert.deepEqual(parsed.value, { day: "2026-11-14", moment: new Date(2026, 10, 14, 10, 23).toISOString() });
		assert.deepEqual(parsed.issues, []);
	});

	it("导入:日期写成 2026/11/14 也认;写不出日期就报校验错,不悄悄丢", async () => {
		const book = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			book,
			XLSX.utils.aoa_to_sheet([
				["日期", "时间"],
				["2026/11/14", "昨天"],
			]),
			"填报",
		);
		const parsed = await previewReportWorkbook(
			dated,
			XLSX.write(book, { type: "buffer", bookType: "xlsx" }).toString("base64"),
		);
		assert.equal((parsed.value as { day?: string }).day, "2026-11-14");
		assert.equal((parsed.value as { moment?: string }).moment, "昨天", "认不出的日期保留原文,不悄悄当空值");
		assert.deepEqual(
			parsed.issues.map((issue) => issue.field),
			["moment"],
		);
	});
});
