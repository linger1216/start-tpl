/**
 * **全系统编号的统一口径** —— 一个编号 = `前缀-YYMMDD-HHMMSS`(如 `ENT-260920-153045`)。
 *
 * 为什么统一成时间戳(而不是自增序号):
 *  - **可读**:一眼看出什么时候建的;
 *  - **天然唯一**:不需要维护序号表,也不会有"删了记录后编号被复用、继承旧账本"的问题;
 *  - **同秒撞**:`nextIdByTime` 把时间顺延 1 秒重试即解决。
 *
 * 编号(对外可见、可打印可对账)与主键(内部 id)是两回事:主键用 `nanoid` 这类无意义短串,
 * 编号给人看。**不要拿编号当主键** —— 业务上迟早要允许改它。
 *
 * 本文件是**纯函数**,不引 DB / 不引 React —— 客户端拿它做占位提示格式说明也能用。
 * 需要"撞了就顺延"的生成器在各自的服务端调用点(它们才知道去哪儿查重)。
 */

/**
 * 各业务对象编号的前缀 —— **派生新项目时改成自己的**。
 *
 * 用 `as const` 是为了让 `formatCode(ID_PREFIX.X, …)` 拿到字面量类型;
 * 只放真正对外可见的编号,临时前缀直接给 `formatCode("TMP", …)` 也行。
 */
export const ID_PREFIX = {
	/** 档案 / 主数据 */
	ENTITY: "ENT",
	/** 导入批次 */
	BATCH: "BAT",
	/** 操作流水 */
	LOG: "LOG",
} as const;

/** 编号格式说明(界面占位提示 / 文档用) */
export const ID_PATTERN = `${ID_PREFIX.ENTITY}-YYMMDD-HHMMSS`;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * `前缀-YYMMDD-HHMMSS`。**只负责格式化,不保证唯一** ——
 * 同一秒要发两个编号时,由调用方把 `when` 往后顺延 1 秒(见 `nextIdByTime`)。
 */
export function formatCode(prefix: string, when: Date = new Date()): string {
	const date = `${pad(when.getFullYear() % 100)}${pad(when.getMonth() + 1)}${pad(when.getDate())}`;
	const time = `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
	return `${prefix}-${date}-${time}`;
}

/**
 * 从"现在"开始找一个没被占用的编号:`isTaken` 说占了就把时间顺延 1 秒重试。
 *
 * 调用方手上已经有一份"已占用集合"时用它(不必再打库);要靠数据库判重时,
 * 用 `insert` 撞唯一键后重试的路子更省事。
 */
export function nextIdByTime(prefix: string, isTaken: (code: string) => boolean, maxBumps = 600): string {
	const base = Date.now();
	for (let bump = 0; bump < maxBumps; bump += 1) {
		const candidate = formatCode(prefix, new Date(base + bump * 1000));
		if (!isTaken(candidate)) return candidate;
	}
	throw new Error(`${prefix} 编号连续被占 ${maxBumps} 次,请检查系统时间`);
}
