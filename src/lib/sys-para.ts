/**
 * 系统参数(`sys_para`)—— 运维口径与界面偏好都不写死在代码里。
 *
 * 为什么单独一层:保留天数、同步开关、侧边栏收起形态这类东西**改一次不该发一次版**;
 * 而任务/执行器又要频繁读它 —— 所以这里带一个 30 秒内存缓存,避免每批执行都查库。
 *
 * 界面偏好为什么也在这里(而不是 localStorage):它是**系统设置级**偏好 ——
 * 换机器 / 换浏览器都该一致,而且要在「参数管理」页改得到。
 * 唯一的例外是主题:它必须在首屏脚本里同步读到,只有 localStorage 做得到(见 constants.ts)。
 *
 * ⚠️ **本文件 import 了 `db`,只能在服务端用**(tRPC procedure / 脚本)。
 * 客户端组件需要类型名或校验时,从 `lib/para-spec.ts` 取 —— 那条界线是踩过坑的:
 * 从客户端 import 本文件会把 mysql2 打进浏览器包,参数管理页直接白屏。
 */
import { eq } from "drizzle-orm";

import { db } from "#/db";
import { sysPara } from "#/db/data-base-schema";
import { PARA_TYPE, type ParaType } from "./para-spec";
import { SIDEBAR_COLLAPSE_MODE_DEFAULT, SIDEBAR_MODE_CONFIG_KEY } from "./sidebar-mode";

/** 代码内置的默认参数(库里没有时用这些,并作为"参数管理"页的初始清单) */
export const PARA_DEFAULTS: Record<string, { value: string; type: ParaType; group: string; remark: string }> = {
	"raw.retention.soft_days": {
		value: "90",
		type: PARA_TYPE.INT,
		group: "raw 保留",
		remark: "已抽取的数据超过多少天先软删除(不在界面出现、不参与治理)",
	},
	"raw.retention.hard_days": {
		value: "180",
		type: PARA_TYPE.INT,
		group: "raw 保留",
		remark: "软删除之后再超过多少天物理删除",
	},
	"raw.retention.batch_size": {
		value: "2000",
		type: PARA_TYPE.INT,
		group: "raw 保留",
		remark: "清理任务每批处理多少行(分批,避免长事务锁表)",
	},
	"cleanup.enabled": {
		value: "false",
		type: PARA_TYPE.BOOL,
		group: "raw 保留",
		remark: "是否开启定时清理。默认关闭:自动删数据必须显式打开,也可随时点「立即清理」",
	},
	"cleanup.interval_hours": {
		value: "24",
		type: PARA_TYPE.INT,
		group: "raw 保留",
		remark: "定时清理的间隔(小时)",
	},
	"sync.enabled": {
		value: "false",
		type: PARA_TYPE.BOOL,
		group: "对接同步",
		remark: "是否开启定时同步。默认关闭:先把某个源手动跑通再打开",
	},
	"sync.interval_minutes": {
		value: "30",
		type: PARA_TYPE.INT,
		group: "对接同步",
		remark: "定时同步的间隔(分钟)",
	},
	"sync.overlap_seconds": {
		value: "300",
		type: PARA_TYPE.INT,
		group: "对接同步",
		remark: "增量窗口向前重叠多少秒 —— 防止边界上的数据被漏掉",
	},
	// ── 界面偏好 ──────────────────────────────────────────────
	// 取值域 / 默认值 / 容错解析都在 lib/sidebar-mode.ts,这里只登记参数本身。
	[SIDEBAR_MODE_CONFIG_KEY]: {
		value: SIDEBAR_COLLAPSE_MODE_DEFAULT,
		type: PARA_TYPE.STRING,
		group: "界面偏好",
		remark: "侧边栏收起后的样子:rail = 收成 60px 图标栏(默认),hidden = 整条隐藏、内容区铺满;填错按 rail 处理",
	},
};

const CACHE_TTL_MS = 30_000;
let cache: { at: number; map: Map<string, string> } | null = null;

/** 读全部参数(库里的值覆盖默认值);带 30 秒缓存 */
export async function getParaMap(force = false): Promise<Map<string, string>> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
	const map = new Map(Object.entries(PARA_DEFAULTS).map(([key, item]) => [key, item.value]));
	for (const row of await db.select().from(sysPara)) {
		map.set(row.para_key, row.para_value);
	}
	cache = { at: Date.now(), map };
	return map;
}

/** 参数变更后清缓存(路由里改完调用) */
export function clearParaCache() {
	cache = null;
}

export async function getParaInt(key: string, fallback: number): Promise<number> {
	const value = Number((await getParaMap()).get(key) ?? PARA_DEFAULTS[key]?.value);
	return Number.isFinite(value) ? value : fallback;
}

export async function getParaBool(key: string, fallback: boolean): Promise<boolean> {
	const raw = (await getParaMap()).get(key) ?? PARA_DEFAULTS[key]?.value;
	if (raw === undefined) return fallback;
	return raw === "true" || raw === "1";
}

/** 某个参数是否允许在界面上改(库里标了 editable=0 就不允许) */
export async function isParaEditable(key: string): Promise<boolean> {
	const [row] = await db.select().from(sysPara).where(eq(sysPara.para_key, key)).limit(1);
	if (!row) return true;
	return Number(row.editable ?? 1) !== 0;
}
