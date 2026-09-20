import { useMemo, useState } from "react";

import { PropTable, ShowcaseItem, ShowcasePage, ShowcaseSection, ShowcaseTag } from "#/components/layout/showcase";
import { DetailProfile, type DetailSummaryField, type DetailTab } from "#/components/modules/shared/detail-profile";
import { ExcelImportDialog, type ImportField } from "#/components/modules/shared/excel-import";
import { IconPicker } from "#/components/modules/shared/icon-picker";
import { SheetParseOptionsBar } from "#/components/modules/shared/sheet-parse-options";
import { SortableTree, type SortableTreeNode } from "#/components/modules/shared/sortable-tree";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { FileDropzone } from "#/components/ui/file-dropzone";
import { SHEET_PARSE_DEFAULTS, type SheetParseOptions } from "#/lib/excel";

/**
 * 组合块展示页 —— 把**多个原语 + 行为**收口成「可一键拿来用」的展示件。
 *
 * 与「表格与列表」页的边界:
 *  - 表格页的件偏版式 / 表格套件;
 *  - 本页的件偏业务编排(详情页骨架、Excel 导入向导、可排序树、图标选择器)。
 *
 * 每件都能直接搬到一个新项目里用 —— 它们**没有业务字段声明**,业务数据由调用方传入。
 */

const FIELDS: ImportField[] = [
	{ key: "name", label: "名称", required: true, width: 24 },
	{ key: "code", label: "编码", required: true, width: 16 },
	{ key: "category", label: "类别", width: 14 },
	{ key: "remark", label: "备注", width: 32 },
];

function ImportSample() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button size="sm" onClick={() => setOpen(true)}>
				打开导入弹窗
			</Button>
			<ExcelImportDialog
				open={open}
				onOpenChange={setOpen}
				title="导入企业信息"
				description="上传 Excel 后,逐行调用下方 onSubmit。"
				fields={FIELDS}
				isPending={false}
				onSubmit={(_rows) => {
					// 真实页面会把 rows 发到后端;这里只是演示所以返回 undefined,
					// 让弹窗走「onSubmit 不返回结果 → 由调用方自己处理 toast」的分支
					return undefined;
				}}
			/>
		</>
	);
}

/** 菜单种子 —— 平铺存,树由 `buildTree` 按 `parentId` 现拼(顺序即数组顺序) */
type MenuSeed = { id: string; name: string; parentId: string | null };

const MENU_SEED: MenuSeed[] = [
	{ id: "工作台", name: "工作台", parentId: null },
	{ id: "系统设置", name: "系统设置", parentId: null },
	{ id: "用户管理", name: "用户管理", parentId: "系统设置" },
	{ id: "角色管理", name: "角色管理", parentId: "系统设置" },
	{ id: "菜单管理", name: "菜单管理", parentId: "系统设置" },
	{ id: "组件展示", name: "组件展示", parentId: null },
	{ id: "基础组件", name: "基础组件", parentId: "组件展示" },
	{ id: "表单组件", name: "表单组件", parentId: "组件展示" },
];

/** 平铺行 → 树(顺序即数组顺序;只按 `parentId` 归组,不重排) */
function buildTree(rows: readonly MenuSeed[]): SortableTreeNode<MenuSeed>[] {
	const byParent = new Map<string, MenuSeed[]>();
	for (const row of rows) {
		const key = row.parentId ?? "";
		byParent.set(key, [...(byParent.get(key) ?? []), row]);
	}
	const toNode = (row: MenuSeed, depth: number): SortableTreeNode<MenuSeed> => ({
		id: row.id,
		name: row.name,
		depth,
		parentId: row.parentId,
		data: row,
		children: (byParent.get(row.id) ?? []).map((child) => toNode(child, depth + 1)),
	});
	return (byParent.get("") ?? []).map((row) => toNode(row, 0));
}

function SortableTreeSample() {
	const [rows, setRows] = useState<MenuSeed[]>(MENU_SEED);
	const tree = useMemo(() => buildTree(rows), [rows]);

	/**
	 * 同级重排 —— 所有变更都落回**平铺数组**:树的形状由 `buildTree` 现推,
	 * 所以"把一行挪到另一行前 / 后"就是数组里换一下位置,不用递归改 children。
	 */
	function move(draggedId: string, targetId: string, position: "before" | "after") {
		const moving = rows.find((row) => row.id === draggedId);
		if (!moving) return;

		// 键盘 ↑ / ↓:draggedId === targetId,位置表示「相对自己往前 / 往后一格」
		if (draggedId === targetId) {
			const siblings = rows.filter((row) => row.parentId === moving.parentId);
			const at = siblings.findIndex((row) => row.id === draggedId);
			const next = siblings[position === "before" ? at - 1 : at + 1];
			if (!next) return;
			move(draggedId, next.id, position);
			return;
		}

		const target = rows.find((row) => row.id === targetId);
		if (!target) return;
		// 只允许同级之间拖(跨级一律忽略;真实实现里服务端也会再校一遍)
		if (moving.parentId !== target.parentId) return;

		const rest = rows.filter((row) => row.id !== draggedId);
		const anchor = rest.findIndex((row) => row.id === targetId);
		if (anchor < 0) return;
		rest.splice(position === "after" ? anchor + 1 : anchor, 0, moving);
		setRows(rest);
	}

	return (
		<SortableTree
			nodes={tree}
			onReorder={move}
			renderIcon={() => <span className="size-3 rounded-sm bg-primary/15 text-primary" aria-hidden />}
			ariaLabel="菜单树(演示)"
		/>
	);
}

/** 文件拖放区的受控示例:自己持"已选文件名" */
function FileDropzoneDemo() {
	const [fileName, setFileName] = useState("");
	return (
		<FileDropzone
			accept=".xlsx,.xls"
			maxSizeMb={10}
			fileName={fileName}
			onFile={(file) => setFileName(file.name)}
			onClear={() => setFileName("")}
			validate={(file) => (file.size === 0 ? "这个文件是空的" : null)}
		/>
	);
}

/** 解析选项条的受控示例 */
function SheetParseOptionsDemo() {
	const [options, setOptions] = useState<SheetParseOptions>(SHEET_PARSE_DEFAULTS);
	return (
		<div className="space-y-2">
			<SheetParseOptionsBar value={options} onChange={setOptions} sheetNames={["Sheet1", "企业明细"]} />
			<div className="font-mono text-[12px] text-muted-foreground">
				表头 第 {options.headerRow} 行 · 业务字段 {options.fieldRow === null ? "(无)" : `第 ${options.fieldRow} 行`} ·
				数据起 第 {options.dataRow} 行 · 工作表 {options.sheetName ?? "(默认第一个)"}
			</div>
		</div>
	);
}

function DetailSample() {
	const summary: DetailSummaryField[] = [
		{ label: "统一信用代码", value: "91310101MA1FL2XXXX" },
		{ label: "法定代表人", value: "张某某" },
		{ label: "成立日期", value: "2018-05-12" },
		{
			label: "经营状态",
			value: <ShowcaseTag variant="default">存续</ShowcaseTag>,
		},
		{ label: "注册地址", value: "上海市黄浦区南京东路 1024 号" },
		{ label: "联系电话", value: "021-5555 8888" },
	];

	const tabs: DetailTab[] = [
		{
			label: "基本信息",
			node: (
				<div className="rounded-lg border border-border p-3 text-[13px] text-muted-foreground">
					本页签只放占位 —— 真实场景塞一个 ReadonlyTable 或表单。
				</div>
			),
		},
		{
			label: "走访记录",
			count: 12,
			node: <div className="rounded-lg border border-border p-3 text-[13px] text-muted-foreground">12 条走访。</div>,
		},
		{
			label: "处罚信息",
			count: 0,
			node: <div className="rounded-lg border border-border p-3 text-[13px] text-muted-foreground">无处罚记录。</div>,
		},
		{
			label: "历史变更",
			node: <div className="rounded-lg border border-border p-3 text-[13px] text-muted-foreground">无变更记录。</div>,
		},
	];

	return (
		<DetailProfile
			title="企业档案详情"
			description="DetailProfile 的标准用法 —— 页头 + 摘要卡 + 多 tab 聚合。需要更多 tab 直接往数组里加。"
			requirement="示例:来源徽章"
			name="示例科技有限公司"
			subtitle="91310101MA1FL2XXXX"
			summary={summary}
			tags={["重点监管", "食品安全"]}
			tabs={tabs}
			actions={
				<Button size="sm" variant="outline">
					返回列表
				</Button>
			}
		/>
	);
}

function IconPickerSample() {
	const [value, setValue] = useState<string | null>("users");
	return (
		<div className="flex flex-wrap items-center gap-3">
			<IconPicker value={value} onChange={setValue} />
			<span className="text-[12px] text-muted-foreground">当前:{value ?? "(未选)"}</span>
		</div>
	);
}

export function ShowcaseBlocksPage() {
	return (
		<ShowcasePage
			title="组合块"
			description="把多个原语 + 行为收口成「可一键拿来用」的展示件 —— 详情页骨架、Excel 导入向导、可排序树、图标选择器。"
			toc={[
				["detail", "详情页骨架"],
				["import", "Excel 导入向导"],
				["import-parts", "导入向导的零部件"],
				["tree", "可排序树"],
				["icon", "图标选择器"],
				["api", "API 速查"],
			]}
		>
			<ShowcaseSection
				id="detail"
				title="详情页骨架"
				description="「以某对象为视角聚合多类记录」的标准版式 —— 摘要卡 + 多 tab;tab 名后带条数。"
			>
				<ShowcaseItem
					name="DetailProfile"
					summary="页头 + 摘要 + 标签 + 多 tab"
					source="shared/detail-profile.tsx"
					demo={<DetailSample />}
					code={`<DetailProfile
  title="企业档案详情"
  requirement="示例:来源徽章"
  name="示例科技有限公司"
  subtitle="91310101MA1FL2XXXX"
  summary={[
    { label: "法定代表人", value: "张某某" },
    …
  ]}
  tags={["重点监管", "食品安全"]}
  tabs={[
    { label: "基本信息", node: <…/> },
    { label: "走访记录", count: 12, node: <…/> },
    …
  ]}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="import"
				title="Excel 导入向导"
				description="上传 → 解析 → 调 onSubmit → 弹结果,四步一行;模板下载内置。"
			>
				<ShowcaseItem
					name="ExcelImportDialog"
					summary="四步走导入弹窗 + 模板下载"
					source="shared/excel-import.tsx · lib/excel.ts"
					dense
					demo={<ImportSample />}
					code={`<ExcelImportDialog
  open={open}
  onOpenChange={setOpen}
  title="导入企业信息"
  fields={[
    { key: "name", label: "名称", required: true, width: 24 },
    …
  ]}
  isPending={isPending}
  onSubmit={async (rows) => {
    const r = await importMutation(rows);
    return { imported: r.imported, skipped: r.skipped, warnings: r.warnings };
  }}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="tree"
				title="可排序树"
				description="同级拖拽排序(不允许跨级),键盘 ↑/↓ 等价 —— 菜单管理、组织架构、分类目录共用。"
			>
				<ShowcaseItem
					name="SortableTree"
					summary="同级拖拽 + 键盘等价 + 折叠态"
					source="shared/sortable-tree.tsx"
					dense
					demo={
						<Card size="sm">
							<CardContent className="p-2">
								<SortableTreeSample />
							</CardContent>
						</Card>
					}
					code={`<SortableTree
  nodes={tree}
  onReorder={(fromId, toId, position) => applyOrder(fromId, toId, position)}
  renderIcon={(node) => <Icon name={node.icon} />}
  renderTrailing={(node) => <Badge>{node.count}</Badge>}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="import-parts"
				title="导入向导的零部件"
				description="`ExcelImportDialog` 是「一步到位」的向导;要自己编排导入流程时,用下面两个件拼 —— 拖放区负责拿到文件,解析选项条负责告诉解析器表头在第几行。"
			>
				<ShowcaseItem
					name="FileDropzone"
					summary="拖拽 / 点击选文件 + 校验 + 已选状态"
					source="ui/file-dropzone.tsx"
					note={
						<>
							只负责<strong className="text-foreground">把文件交出去</strong>,不负责解析 —— 校验通过后回调{" "}
							<code className="font-mono">onFile</code>,由调用方决定 <code className="font-mono">arrayBuffer()</code>{" "}
							之后干什么(解析表格 / 上传 / 预览图,用途各不相同)。
							<code className="font-mono">validate</code> 返回错误文案即拒绝该文件并 toast。
						</>
					}
					demo={<FileDropzoneDemo />}
					code={`<FileDropzone
  accept=".xlsx,.xls"
  maxSizeMb={10}
  fileName={fileName}
  onFile={(file) => void handleFile(file)}
  onClear={() => setFileName("")}
  validate={(file) => (file.size === 0 ? "文件是空的" : undefined)}
/>`}
				/>
				<ShowcaseItem
					name="SheetParseOptionsBar"
					summary="表头行 / 业务字段行 / 数据起始行 —— 三段式台账的解析口径"
					source="shared/sheet-parse-options.tsx"
					note={
						<>
							默认对应最常见的三段式台账:第 1 行中文列名、第 2 行业务字段名(<code className="font-mono">name</code> /{" "}
							<code className="font-mono">creditCode</code>)、第 3 行起是数据。业务字段行可留空(点「无」)=
							单行表头的文件。 纯 UI 件:<code className="font-mono">SheetParseOptions</code> 类型与默认值都在{" "}
							<code className="font-mono">lib/excel.ts</code>,改动后由调用方
							<strong className="text-foreground">重新解析当前文件</strong>
							(不重新选文件)。
						</>
					}
					demo={<SheetParseOptionsDemo />}
					code={`const [options, setOptions] = useState(SHEET_PARSE_DEFAULTS);

<SheetParseOptionsBar
  value={options}
  onChange={(next) => { setOptions(next); void reparse(next); }}
  sheetNames={picked?.sheetNames}
/`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="icon" title="图标选择器" description="菜单管理页专用:全量 lucide 图标 + 搜索 + 选中态。">
				<ShowcaseItem
					name="IconPicker"
					summary="lucide 图标网格选择器"
					source="shared/icon-picker.tsx"
					dense
					demo={<IconPickerSample />}
					code={`<IconPicker value={node.icon} onChange={(next) => update({ icon: next })} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="api" title="API 速查">
				<PropTable
					rows={[
						{ name: "DetailProfile.tabs.count", type: "number", note: "关联条数,展示为 tab 名后的小气泡" },
						{
							name: "ExcelImportDialog.onSubmit",
							type: "(rows) => ImportResult | Promise<…>",
							note: "返回 ImportResult 后自动弹结果;undefined 表示调用方自己处理",
						},
						{
							name: "ExcelImportDialog.options",
							type: "ReactNode",
							note: "在文件选择区下方插入「清空后导入」「跳过重复」之类自定义选项",
						},
						{
							name: "SortableTree.onReorder",
							type: "(draggedId, targetId, position) => void",
							note: "position = 'before' | 'after',只承诺同级内的相对位置",
						},
						{ name: "SortableTree.dragDisabled", type: "boolean", note: "有未保存改动时关掉,避免顺序与右侧表单对不上" },
						{
							name: "IconPicker.value",
							type: "string | null(小写 kebab-case)",
							note: "存库名;newProject 改 NAV_ICON_MAP 才能让新图标生效",
						},
					]}
				/>
				<ShowcaseItem
					name="本节组件计数"
					summary="本展示页覆盖的组合块"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<ShowcaseTag variant="secondary">DetailProfile</ShowcaseTag>
							<ShowcaseTag variant="secondary">ExcelImportDialog</ShowcaseTag>
							<ShowcaseTag variant="secondary">SortableTree</ShowcaseTag>
							<ShowcaseTag variant="secondary">IconPicker</ShowcaseTag>
						</div>
					}
				/>
			</ShowcaseSection>
		</ShowcasePage>
	);
}
