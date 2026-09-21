/**
 * 静态字典 —— 取值与文案的**唯一来源**。
 *
 * 为什么单独一层:部门、状态这类取值会被列表、表单、导入校验、导出多处用到;
 * 硬编码文案散落页面时,改一个字要全仓 grep(`doc/前端结构与组件约定.md` §3.3 的"领域无关形状")。
 * 这里只放**纯数据与纯函数**,不 import React、不 import 组件。
 *
 * 与 `sys_dict` 表的分工:
 *  - **本文件**放"跟着代码走"的字典(部门树、状态枚举)—— 改它要发版,但改起来就是改代码,不用连库;
 *  - **`sys_dict` 表**放"运维期要能改"的字典 —— 前端统一用 `#/hooks/use-dict` 读,
 *    维护入口是「系统设置 ▸ 字段管理」。
 *  两处都不是"随便挑一个",按"谁来改"决定放哪边。
 *
 * 派生新项目时:把 `DEPT_NAMES` / 根节点名换成自己的组织结构即可。
 */

/** 字典项(与 `sys_dict.items` 的形状一致,前台组件可直接吃) */
export type DictOption<V extends string | number = number> = {
	value: V;
	label: string;
	/** 选中项的解释文案(单选卡片 / 提示行直接用) */
	description?: string;
};

// ══ 组织/责任部门 ══════════════════════════════════════════

export type DeptNode = {
	/** 部门编码 —— 落库时存编码,展示时用 `deptName()` 回查名称 */
	id: string;
	name: string;
	children?: readonly DeptNode[];
};

/** 顶级单位(整棵树的根)名称 —— 派生新项目时改成自己的 */
export const ROOT_DEPT_NAME = "示例单位";

/** 部门名称(全站唯一的部门/条线口径;原先 `mocks/settings.ts` 直接引用本列表,那份 mock 已删除) */
export const DEPT_NAMES: readonly string[] = [
	"综合办公室",
	"业务一处",
	"业务二处",
	"数据管理科",
	"信息技术科",
	"财务科",
	"人事科",
	"监督检查科",
];

/** 第 i 个部门的编码(0 基;与 `DEPT_NAMES` 下标一一对应) */
export function deptIdOf(index: number): string {
	return `DEPT-${String(index + 1).padStart(2, "0")}`;
}

/** 顶级单位编码 */
export const ROOT_DEPT_ID = "DEPT-00";

/** 部门树 —— 单位 → 各处室;`dept_id` 只落叶子 */
export const DEPT_TREE: readonly DeptNode[] = [
	{
		id: ROOT_DEPT_ID,
		name: ROOT_DEPT_NAME,
		children: DEPT_NAMES.map((name, index) => ({ id: deptIdOf(index), name })),
	},
];

/** 可选的部门编码(叶子;表单只允许选到叶子) */
export const DEPT_IDS: readonly string[] = DEPT_TREE.flatMap((node) => (node.children ?? []).map((c) => c.id));

const DEPT_NAME_BY_ID: Record<string, string> = Object.fromEntries(
	DEPT_TREE.flatMap((node) => [
		[node.id, node.name] as const,
		...(node.children ?? []).map((child) => [child.id, child.name] as const),
	]),
);

/** 部门编码 → 名称(未知编码原样显示,不吞掉脏数据) */
export function deptName(deptId: string | null | undefined): string {
	if (!deptId) return "";
	return DEPT_NAME_BY_ID[deptId] ?? deptId;
}

/** 部门编码 → 带层级的全路径(如 `示例单位 / 综合办公室`),用于下拉展示与详情 */
export function deptFullName(deptId: string | null | undefined): string {
	if (!deptId) return "";
	for (const node of DEPT_TREE) {
		if (node.id === deptId) return node.name;
		const child = (node.children ?? []).find((c) => c.id === deptId);
		if (child) return `${node.name} / ${child.name}`;
	}
	return deptId;
}

/**
 * 部门树 → 下拉选项(**扁平化 + 层级路径写进 label**)。
 *
 * 为什么不做可展开树控件:部门只有「单位 → 处室」两层,写全路径的扁平列表
 * 既能表达层级、又直接复用 `SearchSelect` 的搜索与键盘操作,少一个自研浮层。
 */
export function deptSelectOptions(): Array<{ value: string; label: string }> {
	return DEPT_TREE.flatMap((node) =>
		(node.children ?? []).map((child) => ({ value: child.id, label: `${node.name} / ${child.name}` })),
	);
}
