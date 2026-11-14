import { useState } from "react";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { MultiSelect } from "#/components/modules/shared/multi-select";
import { type PermissionNode, PermissionSelect } from "#/components/modules/shared/permission-select";
import { SortableTree } from "#/components/modules/shared/sortable-tree";
import { Cell, Group } from "#/components/modules/workbench/ui-gallery-layout";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { formatJson } from "#/lib/format";
import { joinMultiValue, splitMultiValue } from "#/lib/multi-value";
import { asParaType, PARA_TYPE, PARA_TYPE_META, PARA_TYPES, type ParaType, validateParaValue } from "#/lib/para-spec";
import { formatLocalDate, formatLocalDateTime, formatLocalMinute } from "#/lib/time";

const MISSING_TEXT: string | null = null;
const EMPTY_TEXT: string | null = "";

// ══════════════════════════════════════════════════════════════════════
// 通用件(shared)与通用工具(lib)的示例
//
// 与上面的 `ui/` 原语分开写:这些是「在多个 ui 原语之上组装、带交互或领域约定」的件,
// 状态也与原语示例无关。能独立渲染的真跑;跑不了的给签名 + 指路(理由见文件头约定)。
// ══════════════════════════════════════════════════════════════════════

/**
 * `SortableTree` 只认 id / parentId / depth / children;业务字段(这里是 `label`)由调用方自己加。
 * 写成显式类型而不是 `SortableTreeNode & { label }` —— 交叉类型会让嵌套 `children` 退回基础类型,
 * 里面的 `label` 就"不存在"了(TS 会报字面量多出属性)。
 */
type DemoTTreeNode = {
	id: string;
	parentId: string | null;
	depth: number;
	children: DemoTTreeNode[];
	label: string;
};

/** 两级树:维度 → 标签,和「菜单管理 / 标签管理」两页用的是同一套结构 */
const DEMO_TREE: DemoTTreeNode[] = [
	{
		id: "dim-a",
		parentId: null,
		depth: 0,
		label: "重点场所",
		children: [
			{ id: "tag-a1", parentId: "dim-a", depth: 1, label: "学校", children: [] },
			{ id: "tag-a2", parentId: "dim-a", depth: 1, label: "医院", children: [] },
		],
	},
	{
		id: "dim-b",
		parentId: null,
		depth: 0,
		label: "风险等级",
		children: [{ id: "tag-b1", parentId: "dim-b", depth: 1, label: "一级", children: [] }],
	},
];

/** 权限点树:菜单权限 + 操作权限(`kind: "操作"` 会带徽章区分) */
const DEMO_PERMISSIONS: PermissionNode[] = [
	{
		id: "sys",
		name: "系统设置",
		children: [
			{ id: "sys:menu", name: "菜单管理" },
			{ id: "sys:menu:write", name: "菜单编辑", kind: "操作" },
			{ id: "sys:tag", name: "标签管理" },
			{ id: "sys:tag:write", name: "标签编辑", kind: "操作" },
		],
	},
	{ id: "data", name: "数据", children: [{ id: "data:export", name: "导出", kind: "操作" }] },
];

export function ModuleGallery() {
	const [pickedIds, setPickedIds] = useState<string[]>(["d2", "d4"]);

	const [detailDemo, setDetailDemo] = useState(false);
	const [tree, setTree] = useState(DEMO_TREE);
	const [treeSelected, setTreeSelected] = useState<string | null>("tag-a1");
	const [permSelected, setPermSelected] = useState<string[]>(["sys:menu"]);
	const [multiValue, setMultiValue] = useState("紧急、待审;hot");
	const [paraInput, setParaInput] = useState("0");
	const [paraType, setParaType] = useState<ParaType>(PARA_TYPE.INT);

	const paraError = validateParaValue(asParaType(paraType), paraInput);

	return (
		<div className="space-y-4">
			<Cell name="DetailDialog / DetailMeta" hint="台账页的只读「详情」弹窗外壳(点开看)">
				<Button size="sm" variant="outline" onClick={() => setDetailDemo(true)}>
					打开详情
				</Button>
				{/* 约定:控制类字段(启停 / 类型 / 验证)放标题旁的 badge —— 全站同一个位置;
				    创建 / 更新时间固定在最底一行(DetailMeta),详情与编辑页共用同一形态 */}
				<DetailDialog
					open={detailDemo}
					onOpenChange={setDetailDemo}
					title="示例详情 · 参数管理"
					description="file.max_size_mb"
					tag={
						<>
							<Tag variant="secondary">整数</Tag>
							<Tag variant="secondary">启用</Tag>
						</>
					}
					onEdit={() => setDetailDemo(false)}
					meta={{ id: "g-0001", createdAt: "2026-09-21T09:12:00", updatedAt: "2026-09-23T14:05:00" }}
				>
					{/* 字段**内联**写(不用 fields 数组封装):哪一行要特殊渲染就地决定 ——
					    需要 form context / 重依赖的件才给签名卡,这里两种情况都没有,所以真跑 */}
					<div className="flex flex-col gap-0">
						<DetailRow label="ID">
							<span className="font-mono text-xs">V1StGXR8Z5jdHi6B</span>
						</DetailRow>
						<DetailRow label="分组">文件管理</DetailRow>
						<DetailRow label="当前值">
							<span className="tabular-nums">20</span>
						</DetailRow>
						<DetailRow label="说明">
							<span className="text-sm">单个文件大小上限(MB);presign 与 confirm 两头都按它校验</span>
						</DetailRow>
					</div>
					{/* 多值字段(部门 / 角色那种)用徽章列表,别拼成一串顿号分隔的文本 */}
					<div className="space-y-1.5">
						<div className="text-xs font-medium text-muted-foreground">角色(全局)</div>
						<TagList values={["系统管理员", "部门主管", "普通员工"]} layout="wrap" color="stable" />
					</div>
				</DetailDialog>
			</Cell>
			<Group
				title="通用交互件(shared)"
				desc="在多个 ui 原语之上组装、带交互的领域无关件。能独立渲染的真跑;要 form context 或会拖进重依赖的只给签名卡。"
			>
				<Cell
					name="MultiSelect"
					hint="多选框:搜索优先;搜索行尾可挂动作(trailing)、列表可撑满剩余高度(fill);几千个选项也不会把 DOM 撑爆"
				>
					{/* 真实场景:用户编辑里的「角色」「部门」两个框(角色平铺、部门 3691 个还带重名) */}
					<div className="w-full max-w-md">
						<MultiSelect
							options={[
								{ value: "d1", label: "上海公司" },
								{ value: "d2", label: "财务部", hint: "上海公司" },
								{ value: "d3", label: "技术部", hint: "上海公司" },
								{ value: "d4", label: "财务部", hint: "武汉公司" },
								{ value: "d5", label: "武汉公司" },
							]}
							value={pickedIds}
							onChange={setPickedIds}
							placeholder="搜索部门名…"
							trailing={
								<Button size="sm" variant="outline" disabled={pickedIds.length === 0}>
									加入 {pickedIds.length} 个
								</Button>
							}
						/>
					</div>
				</Cell>
				<Cell name="SortableTree" hint="拖拽排序 + 折叠 + 选中 + 键盘上下移(菜单 / 标签管理两页共用)">
					<div className="h-44 overflow-hidden rounded-lg border border-border bg-card p-2">
						<SortableTree
							nodes={tree}
							selectedId={treeSelected}
							ariaLabel="示例树"
							onSelect={(node) => setTreeSelected(node.id)}
							onReorder={(draggedId, targetId, position) =>
								setTree((prev) => {
									// 演示只做**同级**重排(根之间);跨父迁移的判定在组件内部
									const from = prev.findIndex((n) => n.id === draggedId);
									if (from < 0) return prev;
									const next = [...prev];
									const [moved] = next.splice(from, 1);
									const at = next.findIndex((n) => n.id === targetId);
									if (at < 0) return prev;
									next.splice(position === "before" ? at : at + 1, 0, moved);
									return next;
								})
							}
							renderRow={(node) => <span className="truncate text-sm">{node.label}</span>}
						/>
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						选中:<code className="font-mono">{treeSelected ?? PLACEHOLDER_EMPTY}</code>
					</p>
				</Cell>

				<Cell name="PermissionSelect" hint="权限点选择区:搜索 + 勾选(重建授权界面直接用,别另写一份)">
					<div className="rounded-lg border border-border bg-card p-2">
						<PermissionSelect
							nodes={DEMO_PERMISSIONS}
							selected={permSelected}
							onToggle={(ids, on) =>
								setPermSelected((prev) =>
									on ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id)),
								)
							}
						/>
					</div>
				</Cell>

				<Cell name="IconPicker / ExcelImportDialog" hint="这两件这里只给签名 —— 理由见下" wide>
					<div className="space-y-2 text-xs">
						<div>
							<code className="font-mono text-foreground">shared/icon-picker</code> ·{" "}
							<code className="font-mono">IconPicker</code> —— props:
							<code className="font-mono">value / onChange / placeholder</code>
							<p className="text-muted-foreground">
								它的图标解析来自 <code className="font-mono">icons-list</code> 的<b>策展清单</b>;在工作台 import
								会把整包打进首屏。 实活示例在「系统设置 ▸ 菜单管理」的图标选择器。
							</p>
						</div>
						<div>
							<code className="font-mono text-foreground">shared/excel-import</code> ·{" "}
							<code className="font-mono">ExcelImportDialog</code> —— 受控 props:
							<code className="font-mono">open / onOpenChange / title / fields / onSubmit / isPending</code>
							<p className="text-muted-foreground">
								它依赖 <code className="font-mono">xlsx</code>(体积大,所以只在点按钮时动态{" "}
								<code className="font-mono">import()</code>)+ 各域的
								<code className="font-mono">XXX_EXCEL_COLUMNS</code> 列契约。**业务页已经接了**: 用户 / 角色 / 字典 /
								参数四页的工具条上就是它(`ExcelExportButton` + <code className="font-mono">ExcelImportButton</code>
								),审计日志页只接了导出。
							</p>
						</div>
					</div>
				</Cell>
			</Group>

			<Group
				title="通用工具(lib)"
				desc="客户端能跑的纯函数工具 —— 都能直接抄。服务端专用的（auth / sys-para）只给签名,import 它们会把 mysql2 打进浏览器包。"
			>
				<Cell name="time" hint="时间只走这里 —— 自己写 toISOString 会差 8 小时(踩过两次)">
					<div className="space-y-1 font-mono text-xs">
						<div>formatLocalDateTime → {formatLocalDateTime(new Date())}</div>
						<div>formatLocalMinute&nbsp;&nbsp; → {formatLocalMinute(new Date())}</div>
						<div>formatLocalDate&nbsp;&nbsp;&nbsp;&nbsp; → {formatLocalDate(new Date())}</div>
						<div className="font-sans text-muted-foreground">
							对照:<code className="font-mono">new Date().toISOString()</code> = {new Date().toISOString()}(UTC)
						</div>
					</div>
				</Cell>

				<Cell name="ids" hint="内部主键使用 nanoid；业务编号由具体业务定义">
					<code className="font-mono text-xs">newId()</code>
				</Cell>

				<Cell name="format" hint="空值兜底 / JSON 展示 —— 表格单元格常用">
					<div className="space-y-1 font-mono text-xs">
						<div>MISSING_TEXT ?? PLACEHOLDER_EMPTY = "{MISSING_TEXT ?? PLACEHOLDER_EMPTY}"</div>
						<div>EMPTY_TEXT ?? PLACEHOLDER_EMPTY = "{EMPTY_TEXT ?? PLACEHOLDER_EMPTY}"</div>
						<div>formatJson(JS 对象) =</div>
						<pre className="ml-2 rounded bg-muted px-2 py-1 text-xs">{formatJson({ a: 1 })}</pre>
					</div>
				</Cell>

				<Cell name="multi-value" hint="多值字段的唯一分隔符口径(顿号 / 逗号 / 分号 / 竖线)">
					<div className="space-y-2">
						<Input
							value={multiValue}
							onChange={(e) => setMultiValue(e.target.value)}
							placeholder="试试 紧急、待审;hot"
						/>
						<div className="text-xs text-muted-foreground">
							拆:<code className="font-mono text-foreground">{JSON.stringify(splitMultiValue(multiValue))}</code>
						</div>
						<div className="text-xs text-muted-foreground">
							合:<code className="font-mono text-foreground">{joinMultiValue(splitMultiValue(multiValue))}</code>
						</div>
					</div>
				</Cell>

				<Cell name="para-spec" hint="参数类型码 + 录入校验(参数管理页表单与后端 procedure 共用这一份)">
					<div className="space-y-2">
						<div className="flex flex-wrap gap-1.5">
							{PARA_TYPES.map((code) => (
								<Button
									key={code}
									size="sm"
									variant={paraType === code ? "default" : "outline"}
									onClick={() => setParaType(code)}
								>
									{PARA_TYPE_META[code].label}
								</Button>
							))}
						</div>
						<Input value={paraInput} onChange={(e) => setParaInput(e.target.value)} placeholder="输入值试试校验" />
						<p className="text-xs text-muted-foreground">
							{PARA_TYPE_META[asParaType(paraType)].hint} →{" "}
							{paraError ? (
								<span className="text-danger">{paraError}</span>
							) : (
								<span className="text-success">合法</span>
							)}
						</p>
					</div>
				</Cell>

				<Cell
					name="auth / auth-client / sys-para / excel(服务端或重依赖)"
					hint="只给签名 —— 这些不能在浏览器 import"
					wide
				>
					<div className="grid gap-3 md:grid-cols-2">
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/auth.ts(服务端)</div>
							<div>betterAuth(drizzleAdapter(db), emailAndPassword, plugins)</div>
							<div className="font-sans text-muted-foreground">
								它 import <code className="font-mono">#/db</code>(drizzle→mysql2)。客户端碰它会把驱动打进浏览器包 ——
								浏览器里没有 <code className="font-mono">Buffer.prototype</code>,整页崩。客户端只用{" "}
								<code className="font-mono">auth-client</code>。
							</div>
						</div>
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/sys-para.ts(服务端)</div>
							<div>getParaMap() / getParaBool() / clearParaCache()</div>
							<div className="font-sans text-muted-foreground">
								带 30 秒内存缓存,同样 import 了 <code className="font-mono">#/db</code>。客户端要类型码 / 校验时从{" "}
								<code className="font-mono">lib/para-spec</code> 取(就是上面那张卡)。
							</div>
						</div>
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/auth-client.ts(客户端)</div>
							<div>authClient.signIn.email(email, password)</div>
							<div>authClient.signOut() / authClient.useSession()</div>
							<div className="font-sans text-muted-foreground">全项目:登录页 + 顶栏用户菜单。</div>
						</div>
						<div className="space-y-1 font-mono text-xs">
							<div className="font-sans font-medium text-foreground">lib/excel.ts(重依赖)</div>
							<div>writeSheet(columns, rows, fileName) / writeTemplate(columns, fileName)</div>
							<div className="font-sans text-muted-foreground">
								依赖 <code className="font-mono">xlsx</code>;业务页都经 `shared/excel-actions` 懒加载它,别在页面直接
								import。
							</div>
						</div>
					</div>
				</Cell>

				<Cell name="其余封装一览(不单独给示例)" hint="一句话交代每个件是干什么的 —— 免得它们在仓库里没有入口" wide>
					<ul className="space-y-1.5 text-xs">
						<li>
							<code className="font-mono text-foreground">ui/sonner</code> —— Toast 的{" "}
							<code className="font-mono">Toaster</code> 提供者。 已经在 <code className="font-mono">__root.tsx</code>{" "}
							挂载一次,页面里 <code className="font-mono">toast.success(...)</code> 直接用(上面几个示例就在用)。
						</li>
						<li>
							<code className="font-mono text-foreground">shared/icons-list</code> +{" "}
							<code className="font-mono">use-lucide-icons</code> —— 图标名清单与「名字 → 组件」解析,是{" "}
							<code className="font-mono">IconPicker</code> 的底座(见上面那张卡:图标按名义上 import,不在这页拖整包)。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/constants</code> —— 三个全局常量:
							<code className="font-mono">PLACEHOLDER_EMPTY</code>("—")、<code className="font-mono">PAGE_SIZES</code>、
							<code className="font-mono">THEME_STORAGE_KEY</code>(与 <code className="font-mono">__root.tsx</code>{" "}
							的首屏脚本共用,别改单边)。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/logger</code> —— 服务端结构化日志(
							<code className="font-mono">logger.info/warn/error</code>),tRPC 中间件已按{" "}
							<code className="font-mono">traceId</code> 全量记;客户端别用。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/menu-detail-path</code> —— 「参数化菜单路径」约定(
							<code className="font-mono">/data/raw/&lt;记录 id&gt;</code>),
							模板底料:菜单里要挂"某条记录的明细页"时启用。
						</li>
						<li>
							<code className="font-mono text-foreground">lib/sidebar-mode</code> —— 侧边栏收起形态(
							<code className="font-mono">rail</code> / <code className="font-mono">hidden</code>)的取值域与容错解析。
							实活入口就在「系统设置 ▸ 参数管理」里那条 <code className="font-mono">ui.sidebar.collapsed_mode</code>。
						</li>
						<li>
							<code className="font-mono text-foreground">shared/filter-chips</code> ·{" "}
							<code className="font-mono">table-kit</code> ——
							这两件已经在上面那张「台账表格(完整业务页骨架)」里带着用了一遍,不重复放;
							<code className="font-mono">stat-cards</code> 与 <code className="font-mono">tag-list</code>{" "}
							各有独立格子(见上面)。
						</li>
					</ul>
				</Cell>
			</Group>
		</div>
	);
}
