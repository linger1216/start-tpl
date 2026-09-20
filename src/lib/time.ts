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
 *  - **给机器传**(接口参数、游标)用 `formatLocalSql`(与 MySQL `datetime` 同语义)或 `toISOString`(跨系统 ISO-8601);
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

/** 与 MySQL `datetime` 同语义的字符串(本地时区) —— 给 SQL 参数或游标用 */
export const formatLocalSql = formatLocalDateTime;

/** 当前时刻(集中一处,便于测试替换) */
export function nowLocal(): Date {
	return new Date();
}
