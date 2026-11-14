import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkingDay, shiftToWorkingDay, WORKDAY_DATA_LAST_YEAR, workdayKnown } from "../src/lib/workday.ts";

const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min);

test("工作日:周末不是、调休上班的周末是、法定节假日不是", () => {
	assert.equal(isWorkingDay(at(2026, 11, 16)), true, "周一:工作日");
	assert.equal(isWorkingDay(at(2026, 11, 14)), false, "周六:不是");
	assert.equal(isWorkingDay(at(2026, 11, 15)), false, "周日:不是");
	// 2026 国庆假期
	assert.equal(isWorkingDay(at(2026, 10, 1)), false, "国庆:不是工作日");
	assert.equal(isWorkingDay(at(2026, 10, 7)), false, "假期最后一天");
	assert.equal(isWorkingDay(at(2026, 10, 8)), true, "放假回来的第一个工作日");
	// 调休补班(库里的年数据)
	assert.equal(isWorkingDay(at(2026, 1, 4)), true, "补元旦的周日要上班");
	assert.equal(isWorkingDay(at(2026, 10, 10)), true, "补国庆的周六要上班");
});

test("越过内置年数据的日期只按周末判断,并如实标记「数据没覆盖」", () => {
	assert.equal(workdayKnown(at(2026, 11, 16)), true);
	assert.equal(workdayKnown(at(2027, 1, 4)), false, `内置数据只到 ${WORKDAY_DATA_LAST_YEAR}`);
	assert.equal(isWorkingDay(at(2027, 1, 2)), false, "2027 的周六仍按周末算");
	assert.equal(isWorkingDay(at(2027, 1, 4)), true);
});

test("shiftToWorkingDay:跨周末与长假往后找,并保留时分秒", () => {
	assert.equal(shiftToWorkingDay(at(2026, 11, 13, 9, 30)).toISOString(), at(2026, 11, 16, 9, 30).toISOString());
	// 2026-10-01 是周四,后面整段假期 → 顺延到 10-08
	assert.equal(shiftToWorkingDay(at(2026, 10, 1, 18, 15)).toISOString(), at(2026, 10, 8, 18, 15).toISOString());
});
