import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_TASK_REMINDERS,
	executorReminderEvents,
	executorSummaryOf,
	nodeReminderEvents,
	nodeSummaryOf,
	readTaskReminderConfig,
	reminderSummaryOf,
	taskReminderConfigSchema,
	type WorkdayFilter,
} from "../src/lib/task/reminder-spec.ts";
import { isWorkingDay } from "../src/lib/workday.ts";

/** 真实工作日判据(默认口径);「节假日 / 调休」那些用例自己注入假日历 */
const realCalendar = { isWorkday: isWorkingDay };

const pad = (value: number) => String(value).padStart(2, "0");
/** 本地 `M-D HH:mm` —— 断言用,与跑测试的时区无关 */
const stamp = (at: Date) => `${at.getMonth() + 1}-${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

/**
 * 假日历 —— 测试**不依赖真实节假日数据**:周末之外还能指定「这天放假」「这天补班」。
 * 真实的年数据由 `tests/workday.test.ts` 单独验。
 */
function fakeCalendar({
	holidays = [],
	workdays = [],
}: {
	holidays?: string[];
	workdays?: string[];
} = {}): WorkdayFilter {
	const key = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return (date) => {
		const day = key(date);
		if (workdays.includes(day)) return true;
		if (holidays.includes(day)) return false;
		return date.getDay() !== 0 && date.getDay() !== 6;
	};
}

describe("提醒配置", () => {
	it("默认值:截止提醒默认关,节点未查看默认 1 小时站内", () => {
		assert.deepEqual(taskReminderConfigSchema.parse(undefined), DEFAULT_TASK_REMINDERS);
		assert.equal(DEFAULT_TASK_REMINDERS.executor.cadence, "off");
		assert.deepEqual(DEFAULT_TASK_REMINDERS.node, { afterMinutes: 60, channels: ["in_app"] });
	});

	it("校验:时间写法、窗口范围、开着就得选方式、节点时长范围", () => {
		const base = {
			executor: { cadence: "daily", time: "09:00", daysBefore: 3, channels: ["in_app"] },
			node: { afterMinutes: 60, channels: ["in_app"] },
		};
		assert.equal(taskReminderConfigSchema.safeParse(base).success, true);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, executor: { ...base.executor, time: "9:00" } }).success,
			false,
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, executor: { ...base.executor, time: "24:00" } }).success,
			false,
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, executor: { ...base.executor, daysBefore: 0 } }).success,
			false,
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, executor: { ...base.executor, daysBefore: 91 } }).success,
			false,
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, executor: { ...base.executor, channels: [] } }).success,
			false,
			"开着提醒却没选方式",
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({
				...base,
				executor: { cadence: "off", time: "09:00", daysBefore: 3, channels: [] },
			}).success,
			true,
			"关着的时候不要求方式",
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, node: { afterMinutes: 0, channels: ["in_app"] } }).success,
			false,
		);
		assert.equal(
			taskReminderConfigSchema.safeParse({ ...base, node: { afterMinutes: null, channels: [] } }).success,
			true,
			"节点关着的时候不要求方式",
		);
	});

	it("旧结构(offsets 数组)读成默认的「关」,不抛异常", () => {
		const legacy = {
			executor: { offsets: [60, 180], channels: ["in_app"] },
			node: { offsets: [60], channels: ["in_app"] },
		};
		assert.deepEqual(readTaskReminderConfig(legacy), DEFAULT_TASK_REMINDERS);
		assert.deepEqual(readTaskReminderConfig(null), DEFAULT_TASK_REMINDERS);
		assert.equal(
			readTaskReminderConfig({
				executor: { cadence: "daily", time: "10:00", daysBefore: 2, channels: ["email"] },
				node: { afterMinutes: null, channels: [] },
			}).executor.time,
			"10:00",
		);
	});
});

describe("执行人截止提醒的展开", () => {
	const due = at(2026, 11, 20, 18, 0); // 周五 18:00
	const now = at(2026, 11, 1, 0, 0);
	const daily = { cadence: "daily" as const, time: "09:00", daysBefore: 6, channels: ["in_app" as const] };

	it("每天一次:窗口内每个工作日一次,周末自动跳过", () => {
		// 窗口从 11-14(六) 起 → 14 / 15 是周末,跳过
		assert.deepEqual(
			executorReminderEvents(daily, due, now, realCalendar).map((event) => stamp(event.at)),
			["11-16 09:00", "11-17 09:00", "11-18 09:00", "11-19 09:00", "11-20 09:00"],
		);
	});

	it("每天一次:法定节假日跳过,调休上班的周末照常", () => {
		const calendar = fakeCalendar({ holidays: ["2026-11-17"], workdays: ["2026-11-14"] });
		assert.deepEqual(
			executorReminderEvents(daily, due, now, { isWorkday: calendar }).map((event) => stamp(event.at)),
			["11-14 09:00", "11-16 09:00", "11-18 09:00", "11-19 09:00", "11-20 09:00"],
		);
	});

	it("每周一次:从窗口起点起每 7 天,落在非工作日顺延到下一个工作日", () => {
		const weekly = { cadence: "weekly" as const, time: "09:00", daysBefore: 7, channels: ["in_app" as const] };
		assert.deepEqual(
			executorReminderEvents(weekly, due, now, realCalendar).map((event) => stamp(event.at)),
			["11-13 09:00", "11-20 09:00"],
		);
		// 起点那天放假 → 顺延到 11-16(一);下一拍仍按原节奏落在 11-20
		const calendar = fakeCalendar({ holidays: ["2026-11-13"] });
		assert.deepEqual(
			executorReminderEvents(weekly, due, now, { isWorkday: calendar }).map((event) => stamp(event.at)),
			["11-16 09:00", "11-20 09:00"],
		);
	});

	it("只排未来,且落点不能晚于截止", () => {
		const rule = { cadence: "daily" as const, time: "09:00", daysBefore: 3, channels: ["in_app" as const] };
		// 截止是当天 00:00 → 截止那天 09:00 已经晚了,只剩前三天
		assert.deepEqual(
			executorReminderEvents(rule, at(2026, 11, 20, 0, 0), now, realCalendar).map((event) => stamp(event.at)),
			["11-17 09:00", "11-18 09:00", "11-19 09:00"],
		);
		assert.deepEqual(
			executorReminderEvents(rule, due, at(2026, 11, 18, 12, 0), realCalendar).map((event) => stamp(event.at)),
			["11-19 09:00", "11-20 09:00"],
			"已经过去的时刻不再排",
		);
	});

	it("关掉就是空;offset 是「离截止还有几分钟」", () => {
		assert.deepEqual(
			executorReminderEvents({ cadence: "off", time: "09:00", daysBefore: 3, channels: [] }, due, now, realCalendar),
			[],
		);
		const events = executorReminderEvents(
			{ cadence: "daily", time: "09:00", daysBefore: 1, channels: ["in_app"] },
			due,
			now,
			realCalendar,
		);
		assert.deepEqual(
			events.map((event) => stamp(event.at)),
			["11-19 09:00", "11-20 09:00"],
			"窗口起点(截止前 1 天)那天也在窗口里",
		);
		assert.equal(events[0]?.offset, 1980, "11-19 09:00 距 11-20 18:00 是 33 小时");
	});
});

describe("节点未查看提醒的展开", () => {
	it("关掉 = 空;默认 1 小时一次", () => {
		assert.deepEqual(
			nodeReminderEvents({ afterMinutes: null, channels: [] }, at(2026, 11, 18, 9, 0), at(2026, 11, 1), realCalendar),
			[],
		);
		const events = nodeReminderEvents(
			{ afterMinutes: 60, channels: ["in_app"] },
			at(2026, 11, 18, 9, 0),
			at(2026, 11, 1),
			realCalendar,
		);
		assert.deepEqual(
			events.map((event) => [stamp(event.at), event.offset]),
			[["11-18 10:00", 60]],
		);
		assert.deepEqual(
			nodeReminderEvents(
				{ afterMinutes: 60, channels: ["in_app"] },
				at(2026, 11, 18, 9, 0),
				at(2026, 11, 19),
				realCalendar,
			),
			[],
			"已经过去了就不排",
		);
	});

	it("落在非工作日 → 顺延到下一个工作日的同一时刻", () => {
		// 周五 18:00 + 1 天 = 周六 18:00 → 顺延到 11-23(一) 18:00
		assert.deepEqual(
			nodeReminderEvents(
				{ afterMinutes: 1440, channels: ["in_app"] },
				at(2026, 11, 20, 18, 0),
				at(2026, 11, 1),
				realCalendar,
			).map((event) => stamp(event.at)),
			["11-23 18:00"],
		);
		// 工作日内的时刻原样
		assert.deepEqual(
			nodeReminderEvents(
				{ afterMinutes: 240, channels: ["in_app"] },
				at(2026, 11, 20, 18, 0),
				at(2026, 11, 1),
				realCalendar,
			).map((event) => stamp(event.at)),
			["11-20 22:00"],
		);
	});
});

describe("人话措辞", () => {
	it("两块各一句,meta 用短版", () => {
		const config = taskReminderConfigSchema.parse({
			executor: { cadence: "daily", time: "09:00", daysBefore: 3, channels: ["in_app", "email"] },
			node: { afterMinutes: 60, channels: ["in_app"] },
		});
		assert.match(executorSummaryOf(config.executor), /截止前 3 天起,每天 09:00/);
		assert.match(executorSummaryOf(config.executor), /调休上班日照常/);
		assert.match(nodeSummaryOf(config.node), /1 小时/);
		assert.equal(reminderSummaryOf(config), "截止前 3 天起每天 09:00(工作日);未查看 1 小时后提醒");
		const off = taskReminderConfigSchema.parse({
			executor: { cadence: "off", time: "09:00", daysBefore: 3, channels: [] },
			node: { afterMinutes: null, channels: [] },
		});
		assert.equal(reminderSummaryOf(off), "截止提醒已关闭;未查看提醒已关闭");
		assert.match(executorSummaryOf(off.executor), /已关闭/);
	});
});
