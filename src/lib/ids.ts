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
import { nanoid } from "nanoid";

/**
 * **主键**(无意义短串)—— 21 位 URL 安全随机串,不携带任何业务信息。
 *
 * 用在"表要一个 id,但业务不关心它是什么"的列上(如 `sys_para.id`)。
 * 与下面的编号是两回事:编号给人看(可打印可对账、允许改),主键只用来定位行。
 * nanoid 在 Node 与浏览器里都能跑(内部用 `crypto.getRandomValues`),但**不要拿它当业务键用** ——
 * 业务键(如字典编码)必须是人能写进配置里的稳定字符串。
 */
export function newId(): string {
	return nanoid();
}

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
 * 同一秒要发两个编号时,由调用方把 `when` 往后顺延 1 秒。
 */
export function formatCode(prefix: string, when: Date = new Date()): string {
	const date = `${pad(when.getFullYear() % 100)}${pad(when.getMonth() + 1)}${pad(when.getDate())}`;
	const time = `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
	return `${prefix}-${date}-${time}`;
}
