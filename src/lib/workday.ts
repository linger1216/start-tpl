/**
 * **工作日口径只在这里定义**(全站:截止提醒的排期与预览都走它)。
 *
 * 依赖 `chinese-workday` 的内置年数据:周末 / 法定节假日不是工作日,**调休上班的周末是工作日**。
 *
 * ⚠️ 那个库的年数据是**写死的**,只覆盖到 `WORKDAY_DATA_LAST_YEAR`;之后的日期它退回「只看周末」,
 * 于是法定节假日会被当工作日。所以**每年要升级一次 `chinese-workday`** ——
 * 升级点就是这里(同时改 `WORKDAY_DATA_LAST_YEAR`)与 `doc/task-close.md` 的提醒一节。
 */
import { isWorkday } from "chinese-workday";

/** 库内置数据覆盖到的最后一年(超过它就只剩周末规则,预览里要提示) */
export const WORKDAY_DATA_LAST_YEAR = 2026;

/** 本地日期键 `YYYY-MM-DD`。工作日按**本地日期**判断,与 `lib/time.ts` 同一口径 */
function localDayKey(value: Date): string {
	const pad = (input: number) => String(input).padStart(2, "0");
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** 是不是工作日(含调休上班的周末) */
export function isWorkingDay(value: Date): boolean {
	return isWorkday(localDayKey(value));
}

/** 这个日期是否落在节假日数据集内;超出范围时只有周末规则,别假装算得准 */
export function workdayKnown(value: Date): boolean {
	return value.getFullYear() <= WORKDAY_DATA_LAST_YEAR;
}

/**
 * 下一个工作日(**保留时分秒**)。跨长假也能走过去 —— 内部最多找 15 天,
 * 找不到(数据异常)就原样返回 +1 天那次结果,不无限循环。
 */
export function shiftToWorkingDay(value: Date): Date {
	const next = new Date(value);
	for (let i = 0; i < 15; i += 1) {
		next.setDate(next.getDate() + 1);
		if (isWorkingDay(next)) return next;
	}
	return next;
}

/**
 * `after` 之后最近的**工作日的 `hour:minute`**(当天那个点还没过就用当天)。
 *
 * 用在「迟到的提醒」上:worker 因为挂掉 / 被误触发,直到周末才来送货时,
 * 把这条挪到下一个工作日的**计划时刻**,而不是把提醒倒在周末。
 */
export function nextWorkingDayAt(after: Date, hour: number, minute: number): Date {
	const at = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
	let cursor = at(after);
	if (cursor.getTime() <= after.getTime())
		cursor = at(new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1));
	for (let i = 0; i < 15 && !isWorkingDay(cursor); i += 1)
		cursor = at(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1));
	return cursor;
}
