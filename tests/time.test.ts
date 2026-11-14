import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatLocalDate,
	formatLocalDateTime,
	formatLocalMinute,
	parseLocalDateText,
	parseLocalDateTime,
	toLocalMinuteInput,
} from "../src/lib/time.ts";

/** 用**本地**构造再转 ISO:期望值不依赖跑测试的时区(与实现同一套口径) */
const localIso = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
	new Date(y, m - 1, d, h, min, s).toISOString();

/** Excel 日期序列号(1899-12-30 起的天数),带当天时间的小数部分 */
const excelSerial = (y: number, m: number, d: number, h = 0, min = 0) => {
	const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
	return days + (h * 60 + min) / 1440;
};

describe("时间一律走本地口径", () => {
	it("formatLocal* 出来的都是本地墙上时间,不是 UTC", () => {
		const iso = localIso(2026, 11, 14, 10, 23, 45);
		assert.equal(formatLocalDateTime(iso), "2026-11-14 10:23:45");
		assert.equal(formatLocalMinute(iso), "2026-11-14 10:23");
		assert.equal(formatLocalDate(iso), "2026-11-14");
		assert.equal(formatLocalDateTime(null), "");
		assert.equal(formatLocalDate("不是时间"), "");
	});

	it("toLocalMinuteInput:datetime-local 输入框要的是本地值(直接 slice ISO 会拿到 UTC)", () => {
		const iso = localIso(2026, 11, 14, 10, 23, 45);
		assert.equal(toLocalMinuteInput(iso), "2026-11-14T10:23");
		assert.equal(toLocalMinuteInput(null), "");
	});

	it("parseLocalDateTime:人写的本地写法 → 统一 ISO;带时区的 ISO 原样认;胡乱写的给 null", () => {
		const expected = localIso(2026, 11, 14, 10, 23);
		assert.equal(parseLocalDateTime("2026-11-14 10:23"), expected);
		assert.equal(parseLocalDateTime("2026-11-14T10:23"), expected);
		assert.equal(parseLocalDateTime("2026/11/14 10:23"), expected);
		assert.equal(parseLocalDateTime("2026-11-14 10:23:00"), expected);
		assert.equal(parseLocalDateTime("2026-11-14T02:23:00.000Z"), "2026-11-14T02:23:00.000Z");
		assert.equal(parseLocalDateTime("2026-02-31 10:00"), null, "溢出的日期不悄悄进位");
		assert.equal(parseLocalDateTime("十四号"), null);
		assert.equal(parseLocalDateTime(""), null);
	});

	it("parseLocalDateTime 也吃 Excel 序列号(含当天时间)", () => {
		assert.equal(parseLocalDateTime(excelSerial(2026, 11, 14, 10, 23)), localIso(2026, 11, 14, 10, 23));
		assert.equal(parseLocalDateTime(0), null);
	});

	it("parseLocalDateText:日期字段认序列号与斜杠写法,认不出给 null", () => {
		assert.equal(parseLocalDateText(excelSerial(2026, 11, 14)), "2026-11-14");
		assert.equal(parseLocalDateText("2026-11-14"), "2026-11-14");
		assert.equal(parseLocalDateText("2026/11/14"), "2026-11-14");
		assert.equal(parseLocalDateText("2026/11/14 08:00"), null, "日期字段不吃带时间的");
		assert.equal(parseLocalDateText("2026-02-31"), null);
		assert.equal(parseLocalDateText(""), null);
	});
});
