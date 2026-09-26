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
	// 各页表格的「列顺序 + 隐藏项」—— 由每页工具条上的「列」按钮写入(见 hooks/use-column-prefs.ts)。
	// 键是页面标识(如 settings.roles),值是 { order: string[], hidden: string[] }。
	// 放在 sys_para 而不是 localStorage:换台机器 / 换浏览器,列设置跟着账号走。
	"page.columns": {
		value: "{}",
		type: PARA_TYPE.JSON,
		group: "界面偏好",
		remark:
			'各页表格的列顺序与隐藏列:{"<页面键>":{"order":["列id",…],"hidden":["列id",…]}};页面上点工具条的「列」即可改',
	},
	// 各页树的「展开到哪」—— 由三棵树折叠 / 展开时写入(见 hooks/use-tree-prefs.ts)。
	// 键是页面标识(如 settings.menus),值是 { expanded: string[] }(只记已展开的节点 id;
	// 没设置过 = 全部折叠)。与 page.columns 一样存 sys_para,换机器跟着账号走。
	"page.tree": {
		value: "{}",
		type: PARA_TYPE.JSON,
		group: "界面偏好",
		remark:
			'各页树的展开节点:{"<页面键>":{"expanded":["节点id",…]}};在页面上折叠 / 展开树即可改;删掉某个页面键 = 该树回到默认(全部折叠)',
	},
	// 列表页默认每页多少条 —— 由 hooks/use-page-size.ts 读取(每个列表路由的 loader 都 prefetch 它)。
	"page.size": {
		value: "20",
		type: PARA_TYPE.INT,
		group: "界面偏好",
		remark: "列表页默认每页多少条;只认 10 / 20 / 50 / 100,填别的按 20 处理;改完对之后打开的页面生效",
	},
	// 上传策略 —— 由 trpc/routers/file.ts 读取(改参数即时生效,不用改代码)
	"log.enabled": {
		value: "true",
		type: PARA_TYPE.BOOL,
		group: "审计日志",
		remark: "总开关;排查期可临时关掉(关掉后不再往 sys_log 写)",
	},
	"log.retention_days": {
		value: "90",
		type: PARA_TYPE.INT,
		group: "审计日志",
		remark: "保留天数;由定时任务清理(批 6)",
	},
	"log.skip_paths": {
		value: "page.",
		type: PARA_TYPE.STRING,
		group: "审计日志",
		remark: "不记的动作:这里填参数**键**前缀 —— 列顺序 / 树展开态属高频 UI 偏好,记进审计就是噪音",
	},
	"file.max_size_mb": {
		value: "20",
		type: PARA_TYPE.INT,
		group: "文件管理",
		remark: "单个文件大小上限(MB);presign 与 confirm 两头都按它校验",
	},
	"file.allow_ext": {
		value: "jpg,jpeg,png,gif,webp,pdf,xlsx,docx",
		type: PARA_TYPE.STRING,
		group: "文件管理",
		remark: "允许上传的后缀(逗号分隔,小写、不带点);不在名单里的一律拒绝",
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
