/**
 * **时间处理只在这里做** —— 全项目的时间格式化/解析都调用本模块。
 *
 * 为什么必须收口(踩过的坑):
 *  - `Date.prototype.toISOString()` 输出的是 **UTC**。把它当"给人看的时间"用,在 UTC+8 下会**差 8 小时**;
 *    这个 bug 真实出现过两次:一次让增量窗口把整批数据滤掉(同步一条都拉不到),一次让界面上的时间提前 8 小时。
 *  - 各处自己写 `String(n).padStart(2, "0")` 拼字符串,迟早各写各的格式(有的到分、有的到秒)。
 *
 * 规矩:
 *  - **给人看**用 `formatLocalDateTime` / `formatLocalMinute`(本地时区,`YYYY-MM-DD HH:mm:ss` / `…HH:mm`);
 *  - **给机器传**(接口参数、游标)用 `formatLocalDateTime`(与 MySQL `datetime` 同语义)或 `toISOString`(跨系统 ISO-8601);
 *  - **落库前**要 Date 就传 `Date` 对象,交给驱动按连接时区处理,不要自己拼字符串。
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** 取值:Date / 可解析字符串 / null 都能吃;无效返回 null */
function asDate(value: Date | string | number | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** 本地 `YYYY-MM-DD HH:mm:ss` —— 给人看、也给 MySQL 传 */
export function formatLocalDateTime(value: Date | string | number | null | undefined): string {
	const date = asDate(value);
	if (!date) return "";
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 本地 `YYYY-MM-DD HH:mm` —— 列表列宽有限时用 */
export function formatLocalMinute(value: Date | string | number | null | undefined): string {
	const text = formatLocalDateTime(value);
	return text ? text.slice(0, 16) : "";
}

/** 本地 `YYYY-MM-DD` */
export function formatLocalDate(value: Date | string | number | null | undefined): string {
	const date = asDate(value);
	if (!date) return "";
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地 `YYYY-MM-DDTHH:mm` —— `<input type="datetime-local">` 的 `value`(直接 slice ISO 会拿到 UTC) */
export function toLocalMinuteInput(value: Date | string | number | null | undefined): string {
	const text = formatLocalDateTime(value);
	return text ? `${text.slice(0, 10)}T${text.slice(11, 16)}` : "";
}

/**
 * 人写的本地日期时间 → 落库的 ISO-8601;`YYYY-MM-DD HH:mm[:ss]` / `T` 分隔 / `/` 分隔都认,
 * 也吃 Excel 的日期序列号(带小数的时间也在里面);认不出返回 null。
 */
export function parseLocalDateTime(text: string | number | null | undefined): string | null {
	if (text === null || text === undefined || text === "") return null;
	if (typeof text === "number" && Number.isFinite(text)) {
		// Excel 序列号:整数部分是天,小数部分是当天时间(时区无关的"墙上时间",按本地时间还原)
		if (text <= 0 || text > 2_958_465) return null;
		const days = Math.floor(text);
		const msOfDay = Math.round((text - days) * 86_400_000);
		const base = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
		const date = new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0);
		date.setTime(date.getTime() + msOfDay);
		return date.toISOString();
	}
	const matched = /^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(text));
	if (!matched) {
		// 已经是带时区的 ISO(接口 / 老数据),原样认下来
		const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(String(text));
		return iso && !Number.isNaN(Date.parse(String(text))) ? String(text) : null;
	}
	const [, year, month, day, hour, minute, second] = matched;
	const date = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second ?? 0),
		0,
	);
	// 溢出(2026-02-31 这类)会被 Date 悄悄进位,回读一遍对不上就判无效
	if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
	return date.toISOString();
}

/**
 * 人写的日期 / Excel 日期序列号 → `YYYY-MM-DD`;认不出返回 null。
 *
 * Excel 的日期单元格读出来是**序列号**(1899-12-30 起的天数),不是字符串 ——
 * 不折算的话手填的日期在导入时会被判"格式不正确"。
 */
export function parseLocalDateText(value: string | number | null | undefined): string | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "number" && Number.isFinite(value)) {
		// 序列号 → 天数偏移(Excel 把 1900 当闰年,所以基点取 1899-12-30)
		const serial = Math.floor(value);
		if (serial <= 0 || serial > 2_958_465) return null;
		const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
		return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
	}
	const matched = /^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*$/.exec(String(value));
	if (!matched) return null;
	const [, year, month, day] = matched;
	const date = new Date(Number(year), Number(month) - 1, Number(day));
	if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
	return `${year}-${pad(Number(month))}-${pad(Number(day))}`;
}
