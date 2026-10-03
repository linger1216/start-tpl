/**
 * 参数的**规格**:类型码、中文说明、录入校验、内置默认值的形状。
 *
 * ⚠️ **这个文件里不允许出现 `db` / `drizzle` / 任何服务端依赖** —— 它是要进浏览器包的。
 *
 * 为什么和 `lib/sys-para.ts` 拆开(踩过的坑):参数管理页的表单与表格只需要
 * 「类型中文名 + 校验」,却从服务端那个文件里取,而它 `import { db }`(→ drizzle-orm → mysql2)。
 * 于是整个数据库驱动被打进 `parameters-*.js` 这一个路由 chunk(实测 865 kB),
 * 浏览器一执行驱动初始化就崩:`Cannot read properties of undefined (reading 'prototype')`。
 * 症状是「其它页面都正常,只有参数管理白屏」。**客户端组件只许从这里 import**。
 *
 * 类型口径与 `sys_para.para_type` 一一对应(表里是 tinyint 码,不是字符串):
 * `1 int / 2 bool / 3 string / 4 json`。码 ↔ 中文名 ↔ 校验**只有这一份**,
 * 页面里不要再抄一张映射表。
 */

export const PARA_TYPE = {
	INT: 1,
	BOOL: 2,
	STRING: 3,
	JSON: 4,
} as const;

export const PARA_TYPES = [PARA_TYPE.INT, PARA_TYPE.BOOL, PARA_TYPE.STRING, PARA_TYPE.JSON] as const;

export type ParaType = (typeof PARA_TYPES)[number];

/** 类型码 → 中文名 + 录入提示(参数页 / 表单共用) */
export const PARA_TYPE_META: Record<ParaType, { label: string; hint: string }> = {
	[PARA_TYPE.INT]: { label: "整数", hint: "整数,不能为负" },
	[PARA_TYPE.BOOL]: { label: "开关", hint: "只能填 true / false" },
	[PARA_TYPE.STRING]: { label: "文本", hint: "任意文本" },
	[PARA_TYPE.JSON]: { label: "JSON", hint: "合法的 JSON(对象或数组均可)" },
};

/**
 * 参数值长度上限。
 *
 * 列已经是 `text`(不再受 varchar 列宽限制),这个数现在是**接口与界面的一道护栏**:
 * 防止有人把整份文件塞进参数里。要放宽就改这一处(tRPC 入参与表单校验都读它)。
 */
export const PARA_VALUE_MAX = 4000;

/**
 * 上传策略两键的**兜底值** —— 库里读不到 / 没配过时用它。
 *
 * 三处共用这一份,以前是三处各写一遍字面量(后端 `routers/file.ts` 的 `readPolicy()`、
 * 上传对话框 `settings-files-upload.tsx`、参数管理页的 `PARA_DEFAULTS`),改了名单忘了别处就会
 * 出现"界面允许传、后端拒收"这种最难查的错。
 */
export const FILE_ALLOW_EXT_DEFAULT = "jpg,jpeg,png,gif,webp,pdf,xlsx,docx";
export const FILE_MAX_SIZE_MB_DEFAULT = 20;

export function isParaType(value: unknown): value is ParaType {
	return typeof value === "number" && (PARA_TYPES as readonly number[]).includes(value);
}

/** 任何不认识的值都当**文本**处理(脏数据不该让页面崩) */
export function asParaType(value: unknown): ParaType {
	return isParaType(value) ? value : PARA_TYPE.STRING;
}

/** 参数值按类型校验:参数页保存前也用它(不接受乱七八糟的值) */
export function validateParaValue(type: ParaType, value: string): string | null {
	const trimmed = value.trim();
	if (value.length > PARA_VALUE_MAX) return `参数值太长(最多 ${PARA_VALUE_MAX} 字符)`;

	switch (type) {
		case PARA_TYPE.INT: {
			if (!/^-?\d+$/.test(trimmed)) return "这个参数要填整数";
			if (Number(trimmed) < 0) return "不能为负数";
			return null;
		}
		case PARA_TYPE.BOOL:
			return ["true", "false"].includes(trimmed) ? null : "这个参数只能填 true / false";
		case PARA_TYPE.JSON:
			try {
				JSON.parse(trimmed);
				return null;
			} catch {
				return "不是合法的 JSON";
			}
		default:
			return null;
	}
}
