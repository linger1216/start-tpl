import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pasteReportGrid, taskReportSchema, validateTaskReport } from "../src/lib/task/report-spec.ts";

describe("任务填报结构", () => {
	for (const kind of ["OBJECT", "TABLE"] as const) {
		it(`${kind} 支持手机号、邮箱及多个附件并校验数据`, () => {
			const schema = taskReportSchema.parse({
				id: "contact",
				kind,
				fields: [
					{ id: "phone", label: "手机号", type: "phone", required: true },
					{ id: "email", label: "邮箱", type: "email" },
					{ id: "files", label: "附件", type: "attachment", required: true },
				],
			});
			const value = { phone: "13812345678", email: "test@example.com", files: ["file-a", "file-b"] };
			assert.deepEqual(validateTaskReport(schema, kind === "TABLE" ? [value] : value), []);
			const invalid = { phone: "123", email: "no-at", files: ["file-a", "file-a"] };
			assert.deepEqual(
				validateTaskReport(schema, kind === "TABLE" ? [invalid] : invalid).map((issue) => issue.field),
				["phone", "email", "files"],
			);
		});
	}
	const schema = taskReportSchema.parse({
		id: "inspection",
		kind: "TABLE",
		fields: [
			{ id: "name", label: "名称", type: "text", required: true },
			{ id: "needed", label: "需要整改", type: "select", options: ["是", "否"] },
			{ id: "date", label: "整改日期", type: "date", requiredWhen: { field: "needed", equals: "是" } },
			{ id: "min", label: "下限", type: "decimal" },
			{ id: "max", label: "上限", type: "decimal" },
			{ id: "level", label: "等级", type: "select", options: ["高", "低"] },
		],
		rules: [{ left: "min", op: "lte", right: "max", message: "下限不能超过上限" }],
	});
	it("校验必填、条件、跨字段、选项与行号", () => {
		assert.deepEqual(
			validateTaskReport(schema, [{ name: "甲", needed: "是", date: "2024-02-29", min: 1, max: 2, level: "高" }]),
			[],
		);
		const issues = validateTaskReport(schema, [
			{ name: "", needed: "是", date: "2023-02-29", min: 3, max: 2, level: "其他" },
		]);
		assert.deepEqual(
			issues.map((issue) => issue.field),
			["name", "date", "level", "min"],
		);
		assert.ok(issues.every((issue) => issue.row === 0));
	});
	it("拒绝重复字段、未知字段、错误行与多选重复", () => {
		assert.equal(
			taskReportSchema.safeParse({
				id: "x",
				kind: "OBJECT",
				fields: [
					{ id: "a", label: "A", type: "text" },
					{ id: "a", label: "B", type: "text" },
				],
			}).success,
			false,
		);
		assert.equal(validateTaskReport(schema, [{ name: "甲", extra: "x" }])[0]?.field, "extra");
		assert.ok(validateTaskReport(schema, []).length);
		const multiple = taskReportSchema.parse({
			id: "x",
			kind: "OBJECT",
			fields: [{ id: "a", label: "A", type: "multiselect", options: ["甲"] }],
		});
		assert.equal(validateTaskReport(multiple, { a: ["甲", "甲"] }).length, 1);
	});
	it("整块粘贴按起始格铺开，超出表格范围的部分丢弃", () => {
		const rows = [
			{ name: "甲", needed: null, date: null, min: null, max: null, level: null },
			{ name: "乙", needed: null, date: null, min: null, max: null, level: null },
		];
		const next = pasteReportGrid(schema, rows, 0, 0, "丙\t是\t2024-01-02\n丁\t否\t2024-02-03\textra");
		assert.equal(next[0]?.name, "丙");
		assert.equal(next[0]?.needed, "是");
		assert.equal(next[1]?.date, "2024-02-03");
		assert.equal(rows[0]?.name, "甲", "原数组不被修改");
		// 行数不够时只写能落下的行
		assert.equal(pasteReportGrid(schema, rows.slice(0, 1), 0, 0, "甲\n乙")[0]?.name, "甲");
		assert.equal(pasteReportGrid(schema, rows, 0, 0, "甲\n乙").length, 2);
	});
});

describe("填报字段类型:手机 / 邮箱 / 附件 / 数组", () => {
	const schema = taskReportSchema.parse({
		id: "contact",
		kind: "TABLE",
		fields: [
			{ id: "phone", label: "手机", type: "phone" },
			{ id: "mail", label: "邮箱", type: "email" },
			{ id: "files", label: "附件", type: "attachment" },
			{
				id: "contacts",
				label: "联系人",
				type: "array",
				itemFields: [
					{ id: "name", label: "姓名", type: "text", required: true },
					{ id: "tel", label: "电话", type: "phone" },
				],
			},
		],
	});
	it("合法值通过", () => {
		assert.deepEqual(
			validateTaskReport(schema, [
				{ phone: "13800138000", mail: "a@b.com", files: ["f1"], contacts: [{ name: "张三", tel: "13900139000" }] },
			]),
			[],
		);
	});
	it("手机号 / 邮箱 / 附件格式不对要报错", () => {
		const issues = validateTaskReport(schema, [{ phone: "12345", mail: "nope", files: ["f1", "f1"] }]);
		assert.deepEqual(
			issues.map((issue) => issue.field),
			["phone", "mail", "files"],
		);
	});
	it("数组元素逐项校验:必填与类型(一次只报第一条)", () => {
		const typeIssue = validateTaskReport(schema, [{ contacts: [{ name: "张三", tel: "abc" }] }]);
		assert.ok(typeIssue.some((issue) => issue.message.includes("第 1 项「电话」")));
		const requiredIssue = validateTaskReport(schema, [{ contacts: [{}] }]);
		assert.ok(requiredIssue.some((issue) => issue.message.includes("第 1 项「姓名」必填")));
		// 元素多于 1 个时,能定位到具体第几项
		const secondIssue = validateTaskReport(schema, [{ contacts: [{ name: "张三" }, { name: "" }] }]);
		assert.ok(secondIssue.some((issue) => issue.message.includes("第 2 项「姓名」必填")));
	});
	it("数组元素不得携带模板未声明的字段", () => {
		const issues = validateTaskReport(schema, [{ contacts: [{ name: "张三", hidden: "不应保存" }] }]);
		assert.equal(issues.length, 1);
		assert.match(issues[0].message, /未知字段/);
	});
	it("数组必须配元素字段;非数组字段不能带元素字段", () => {
		assert.equal(
			taskReportSchema.safeParse({ id: "x", kind: "TABLE", fields: [{ id: "a", label: "A", type: "array" }] }).success,
			false,
		);
		assert.equal(
			taskReportSchema.safeParse({
				id: "x",
				kind: "TABLE",
				fields: [{ id: "a", label: "A", type: "text", itemFields: [{ id: "b", label: "B", type: "text" }] }],
			}).success,
			false,
		);
	});
});
