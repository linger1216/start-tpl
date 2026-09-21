/**
 * 系统参数(`sys_config`)—— 运维口径不写死在代码里。
 *
 * 为什么单独一层:保留天数、同步开关这类东西**改一次不该发一次版**;
 * 而任务/执行器又要频繁读它 —— 所以这里带一个 30 秒内存缓存,避免每批执行都查库。
 */
import { eq } from "drizzle-orm";

import { db } from "#/db";
import { sysConfig } from "#/db/data-base-schema";

export type ConfigType = "string" | "int" | "bool" | "json" | "array" | "map";

/** 类型 → 中文名 + 录入提示(参数页 / 表单共用,不要在页面里另写) */
export const CONFIG_TYPE_META: Record<ConfigType, { label: string; hint: string }> = {
	string: { label: "文本", hint: "任意文本" },
	int: { label: "整数", hint: "整数,不能为负" },
	bool: { label: "开关", hint: "只能填 true / false" },
	json: { label: "JSON", hint: "合法的 JSON(对象或数组均可)" },
	array: { label: "数组", hint: 'JSON 数组,如 ["a","b"]' },
	map: { label: "映射", hint: 'JSON 对象,如 {"k":"v"}' },
};

/** 代码内置的默认参数(库里没有时用这些,并作为"参数管理"页的初始清单) */
export const CONFIG_DEFAULTS: Record<string, { value: string; type: ConfigType; group: string; remark: string }> = {
	"raw.retention.soft_days": {
		value: "90",
		type: "int",
		group: "raw 保留",
		remark: "已抽取的数据超过多少天先软删除(不在界面出现、不参与治理)",
	},
	"raw.retention.hard_days": {
		value: "180",
		type: "int",
		group: "raw 保留",
		remark: "软删除之后再超过多少天物理删除",
	},
	"raw.retention.batch_size": {
		value: "2000",
		type: "int",
		group: "raw 保留",
		remark: "清理任务每批处理多少行(分批,避免长事务锁表)",
	},
	"cleanup.enabled": {
		value: "false",
		type: "bool",
		group: "raw 保留",
		remark: "是否开启定时清理。默认关闭:自动删数据必须显式打开,也可随时点「立即清理」",
	},
	"cleanup.interval_hours": {
		value: "24",
		type: "int",
		group: "raw 保留",
		remark: "定时清理的间隔(小时)",
	},
	"sync.enabled": {
		value: "false",
		type: "bool",
		group: "对接同步",
		remark: "是否开启定时同步。默认关闭:先把某个源手动跑通再打开",
	},
	"sync.interval_minutes": {
		value: "30",
		type: "int",
		group: "对接同步",
		remark: "定时同步的间隔(分钟)",
	},
	"sync.overlap_seconds": {
		value: "300",
		type: "int",
		group: "对接同步",
		remark: "增量窗口向前重叠多少秒 —— 防止边界上的数据被漏掉",
	},
};

const CACHE_TTL_MS = 30_000;
let cache: { at: number; map: Map<string, string> } | null = null;

/** 读全部参数(库里的值覆盖默认值);带 30 秒缓存 */
export async function getConfigMap(force = false): Promise<Map<string, string>> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
	const map = new Map(Object.entries(CONFIG_DEFAULTS).map(([key, item]) => [key, item.value]));
	for (const row of await db.select().from(sysConfig)) {
		if (row.cfg_value !== null) map.set(row.cfg_key, row.cfg_value);
	}
	cache = { at: Date.now(), map };
	return map;
}

/** 参数变更后清缓存(路由里改完调用) */
export function clearConfigCache() {
	cache = null;
}

export async function getConfigInt(key: string, fallback: number): Promise<number> {
	const value = Number((await getConfigMap()).get(key) ?? CONFIG_DEFAULTS[key]?.value);
	return Number.isFinite(value) ? value : fallback;
}

export async function getConfigBool(key: string, fallback: boolean): Promise<boolean> {
	const raw = (await getConfigMap()).get(key) ?? CONFIG_DEFAULTS[key]?.value;
	if (raw === undefined) return fallback;
	return raw === "true" || raw === "1";
}

/** 参数值长度上限 —— 与 `sys_config.cfg_value` 的列宽、tRPC 入参的 zod 上限三者必须一致 */
export const CONFIG_VALUE_MAX = 4000;

/** 参数值按类型校验:参数页保存前也用它(不接受乱七八糟的值) */
export function validateConfigValue(type: ConfigType, value: string): string | null {
	const trimmed = value.trim();
	if (type === "int") {
		if (!/^-?\d+$/.test(trimmed)) return "这个参数要填整数";
		if (Number(trimmed) < 0) return "不能为负数";
	}
	if (type === "bool" && !["true", "false"].includes(trimmed)) return "这个参数只能填 true / false";
	if (type === "json" || type === "array" || type === "map") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return "不是合法的 JSON";
		}
		if (type === "array" && !Array.isArray(parsed)) return '这个参数要填 JSON 数组,如 ["a","b"]';
		if (type === "map" && (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null))
			return '这个参数要填 JSON 对象,如 {"k":"v"}';
	}
	/**
	 * 长度上限与**列宽**和 **tRPC 入参**保持一致(4000)。
	 * 曾经是 500 —— 而「列可见性 + 顺序」这类 JSON 在 24 列时就已经 650 字符,
	 * 结果是"界面上勾了、刷新就回来了"(保存被拒,只有一条 toast 一闪而过)。实测踩到。
	 */
	if (value.length > CONFIG_VALUE_MAX) return `参数值太长(最多 ${CONFIG_VALUE_MAX} 字符)`;
	return null;
}

/** 某个参数是否允许在界面上改(库里标了 editable=0 就不允许) */
export async function isEditable(key: string): Promise<boolean> {
	const [row] = await db.select().from(sysConfig).where(eq(sysConfig.cfg_key, key)).limit(1);
	if (!row) return true;
	return Number(row.editable ?? 1) !== 0;
}
