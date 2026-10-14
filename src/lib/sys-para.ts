/**
 * 系统参数(`sys_para`)—— 运维口径与界面偏好都不写死在代码里。
 *
 * 为什么单独一层:侧边栏收起形态、列表页每页条数这类东西**改一次不该发一次版**;
 * 而页面与接口又要频繁读它 —— 所以这里带一个 30 秒内存缓存,避免每次请求都查库。
 *
 * 界面偏好为什么也在这里(而不是 localStorage):它是**系统设置级**偏好 ——
 * 换机器 / 换浏览器都该一致,而且要在「参数管理」页改得到。
 * 唯一的例外是主题:它必须在首屏脚本里同步读到,只有 localStorage 做得到(见 constants.ts)。
 *
 * ⚠️ **本文件 import 了 `db`,只能在服务端用**(tRPC procedure / 脚本)。
 * 客户端组件需要类型名或校验时,从 `lib/para-spec.ts` 取 —— 那条界线是踩过坑的:
 * 从客户端 import 本文件会把 mysql2 打进浏览器包,参数管理页直接白屏。
 */
import { db } from "#/db";
import { sysPara } from "#/db/data-base-schema";
import { FILE_ALLOW_EXT_DEFAULT, FILE_MAX_SIZE_MB_DEFAULT, PARA_TYPE, type ParaType } from "./para-spec";
import { SIDEBAR_COLLAPSE_MODE_DEFAULT, SIDEBAR_MODE_CONFIG_KEY } from "./sidebar-mode";
import { alive } from "./soft-delete";

/** 代码内置的默认参数(库里没有时用这些,并作为"参数管理"页的初始清单) */
export const PARA_DEFAULTS: Record<string, { value: string; type: ParaType; group: string; remark: string }> = {
	// ── 界面偏好 ──────────────────────────────────────────────
	// 取值域 / 默认值 / 容错解析都在 lib/sidebar-mode.ts,这里只登记参数本身。
	[SIDEBAR_MODE_CONFIG_KEY]: {
		value: SIDEBAR_COLLAPSE_MODE_DEFAULT,
		type: PARA_TYPE.STRING,
		group: "界面偏好",
		remark: "侧边栏收起后的样子:rail = 收成 60px 图标栏(默认),hidden = 整条隐藏、内容区铺满;填错按 rail 处理",
	},
	// 各页表格的「列顺序 + 隐藏项」—— 由每页工具条上的「列」按钮写入(见 hooks/use-para-prefs.ts)。
	// 键是页面标识(如 settings.roles),值是 { order: string[], hidden: string[] }。
	// 放在 sys_para 而不是 localStorage:换台机器 / 换浏览器,列设置跟着账号走。
	"page.columns": {
		value: "{}",
		type: PARA_TYPE.JSON,
		group: "界面偏好",
		remark:
			'各页表格的列顺序与隐藏列:{"<页面键>":{"order":["列id",…],"hidden":["列id",…]}};页面上点工具条的「列」即可改',
	},
	// 各页树的「展开到哪」—— 由三棵树折叠 / 展开时写入(见 hooks/use-para-prefs.ts)。
	// 键是页面标识(如 settings.menus),值是 { expanded: string[] }(只记已展开的节点 id;
	// 没设置过 = 全部折叠)。与 page.columns 一样存 sys_para,换机器跟着账号走。
	"page.tree": {
		value: "{}",
		type: PARA_TYPE.JSON,
		group: "界面偏好",
		remark:
			'各页树的展开节点:{"<页面键>":{"expanded":["节点id",…]}};在页面上折叠 / 展开树即可改;删掉某个页面键 = 该树回到默认(全部折叠)',
	},
	// 列表页默认每页多少条 —— 由 hooks/use-para-prefs.ts 读取(每个列表路由的 loader 都 prefetch 它)。
	"page.size": {
		value: "20",
		type: PARA_TYPE.INT,
		group: "界面偏好",
		remark: "列表页默认每页多少条;只认 10 / 20 / 50 / 100,填别的按 20 处理;改完对之后打开的页面生效",
	},
	// 审计日志 —— 由 lib/audit.ts 读取(改参数即时生效,不用改代码)
	"log.enabled": {
		value: "true",
		type: PARA_TYPE.BOOL,
		group: "审计日志",
		remark: "总开关;排查期可临时关掉(关掉后不再往 sys_log 写)",
	},
	"log.skip_paths": {
		value: "page.",
		type: PARA_TYPE.STRING,
		group: "审计日志",
		remark: "不记的动作:这里填参数**键**前缀 —— 列顺序 / 树展开态属高频 UI 偏好,记进审计就是噪音",
	},
	// 上传策略 —— 由 trpc/routers/file.ts 读取(改参数即时生效,不用改代码)
	"file.max_size_mb": {
		value: String(FILE_MAX_SIZE_MB_DEFAULT),
		type: PARA_TYPE.INT,
		group: "文件管理",
		remark: "单个文件大小上限(MB);presign 与 confirm 两头都按它校验",
	},
	"file.allow_ext": {
		value: FILE_ALLOW_EXT_DEFAULT,
		type: PARA_TYPE.STRING,
		group: "文件管理",
		remark: "允许上传的后缀(逗号分隔,小写、不带点);不在名单里的一律拒绝",
	},
	// 登录 —— 由 lib/auth.ts 的 `/sign-in/email` 钩子与登录页各读一次(两边看同一个值)。
	// 改完**立即生效**:para.update 会 clearParaCache(),不用等 30 秒。
	"login.captcha_enabled": {
		value: "true",
		type: PARA_TYPE.BOOL,
		group: "登录",
		remark: "登录页的人机验证(默认开)。关掉后登录接口不再要求验证码,只剩限流 + 账号锁定兜底 —— 生产环境不建议关",
	},
};

const CACHE_TTL_MS = 30_000;
let cache: { at: number; map: Map<string, string> } | null = null;

/** 读全部参数(库里的值覆盖默认值);带 30 秒缓存 */
export async function getParaMap(force = false): Promise<Map<string, string>> {
	if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
	const map = new Map(Object.entries(PARA_DEFAULTS).map(([key, item]) => [key, item.value]));
	for (const row of await db.select().from(sysPara).where(alive(sysPara))) {
		map.set(row.para_key, row.para_value);
	}
	cache = { at: Date.now(), map };
	return map;
}

/** 参数变更后清缓存(路由里改完调用) */
export function clearParaCache() {
	cache = null;
}

export async function getParaBool(key: string, fallback: boolean): Promise<boolean> {
	const raw = (await getParaMap()).get(key) ?? PARA_DEFAULTS[key]?.value;
	if (raw === undefined) return fallback;
	return raw === "true" || raw === "1";
}
