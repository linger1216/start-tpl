import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pasteReportGrid, taskReportSchema, validateTaskReport } from "../src/lib/task-report-spec.ts";

describe("任务填报结构", () => {
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
