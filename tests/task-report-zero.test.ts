import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportValueView } from "../src/components/modules/task-close/report-readonly";
import { textControlAttrs } from "../src/components/modules/task-close/report-types";

test("数字填报的零值在汇总中显示为 0，空值显示占位符", () => {
	for (const type of ["integer", "decimal"] as const) {
		const field = { id: "number", label: "数量", type, readOnly: false };
		assert.equal(textControlAttrs(field).placeholder, "请输入数字");
		for (const [value, expected] of [
			[0, "0"],
			[null, "—"],
		] as const) {
			const output = renderToStaticMarkup(createElement(ReportValueView, { taskId: "task", field, value, files: [] }));
			assert.equal(output, expected);
		}
	}
});
