import { Download, ListChecks, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { ActiveFilterPills, FilterChipBar } from "#/components/modules/shared/filter-chips";
import { LedgerCard, SelectionBar } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { actionsColumn, selectColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";
import { createAppColumnHelper, useAppTable, useRowSelection } from "#/lib/table";

/**
 * 工作台 · **台账表格**精良示例 —— 一个真实业务页该有的样子。
 *
 * 为什么单独一个文件:裸 `<Table>` 只能证明"能画格子",证明不了"照着搭一个台账页"。这里把
 * **业务页的完整骨架**摆齐:指标卡 → 快速筛选 chip → 工具条(搜索 / 刷新 / 导出 / 新增) →
 * 批量操作条(仅选中时出现)→ 表格(多选 / 排序 / 徽章 / 标签 / 数值右对齐 / 行操作)→ 分页行。
 *
 * 抄这一份就够了,里面没有"为了演示而演示"的写法:
 *  - 工具条走 `shared/ledger-toolbar`、卡壳走 `shared/ledger-card`、批量条走同文件的 `SelectionBar`
 *    (与 9 个真实台账页逐字同形):搜索 / 刷新 / 列 / 导出 / 新增 这一行、以及「卡内表格 + 分页」这一层都别手搓;
 *  - 列定义走 `createAppColumnHelper`(`lib/table.ts` 的 v9 app hook),`sortFn: "text"` 是
 *    在 `lib/table.ts` 里注册过的字符串名;
 *  - 多选列 / 操作列用 `table-kit` 的 `selectColumn` / `actionsColumn`,别手写;
 *  - 选中态、批量条、分页全部由 `useRowSelection` + 表格自带 pagination 驱动,
 *    不额外维护一份"页面级"状态。
 *
 * 数据是**固定 12 行**(不请求接口、不用随机数):演示页刷新前后必须一模一样,
 * 否则 SSR 与水合对不上。
 */

type LedgerRow = {
	id: string;
	code: string;
	name: string;
	owner: string;
	tags: string[];
	amount: number;
	status: "启用" | "待复核" | "停用";
	updatedAt: string;
};

const OWNERS = ["陈静", "李明", "王涛", "赵敏"];
const TAG_POOL = [["重点", "新接入"], ["常规"], ["重点"], ["待核实", "常规"], ["新接入"], ["常规", "跨区"]];
const STATUS_CYCLE: LedgerRow["status"][] = ["启用", "启用", "待复核", "启用", "停用", "待复核"];

/** 固定 12 行 —— 序号决定一切,不用 `Math.random()` / `new Date()`(SSR 与水合必须一致) */
const ROWS: LedgerRow[] = Array.from({ length: 12 }, (_, i) => ({
	id: `L-${String(i + 1).padStart(3, "0")}`,
	code: `ZD-2026-${String(i + 1).padStart(4, "0")}`,
	name: `示例台账项 ${String(i + 1).padStart(2, "0")}`,
	owner: OWNERS[i % OWNERS.length] as string,
	tags: TAG_POOL[i % TAG_POOL.length] as string[],
	amount: 12000 + i * 3571,
	status: STATUS_CYCLE[i % STATUS_CYCLE.length] as LedgerRow["status"],
	updatedAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")} 09:${String((i * 7) % 60).padStart(2, "0")}`,
}));

const STATUS_VARIANT: Record<LedgerRow["status"], "default" | "secondary" | "destructive"> = {
	启用: "default",
	待复核: "secondary",
	停用: "destructive",
};

const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;

const columnHelper = createAppColumnHelper<LedgerRow>();

export function UiGalleryTable() {
	const [keyword, setKeyword] = useState("");
	const [status, setStatus] = useState<string | undefined>(undefined);
	const [pendingDelete, setPendingDelete] = useState(false);

	const rows = useMemo(
		() =>
			ROWS.filter((row) => {
				if (status && row.status !== status) return false;
				const key = keyword.trim();
				if (!key) return true;
				return `${row.code} ${row.name} ${row.owner} ${row.tags.join(" ")}`.includes(key);
			}),
		[keyword, status],
	);

	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(rows);

	/** 列定义随选中状态重建(多选列的渲染依赖它)—— 这是 React 里最省心的做法 */
	const columns = useMemo(
		() =>
			columnHelper.columns([
				selectColumn<LedgerRow>({ selected, onToggleOne: toggleOne, onToggleMany: toggleMany }),
				columnHelper.accessor("code", {
					header: "编号",
					sortFn: "text",
					size: 130,
					cell: (ctx) => <span className="font-mono text-xs">{ctx.getValue()}</span>,
				}),
				columnHelper.accessor("name", { header: "名称", sortFn: "text", size: 170 }),
				columnHelper.accessor("tags", {
					header: "分类标签",
					size: 180,
					cell: (ctx) => <TagList values={ctx.getValue()} layout="wrap" color="stable" />,
				}),
				columnHelper.accessor("owner", { header: "负责人", size: 100 }),
				columnHelper.accessor("amount", {
					header: "金额",
					size: 120,
					// 数值列一律右对齐 + tabular-nums:位数不同的数字要能对齐比较
					cell: (ctx) => <span className="block text-right tabular-nums">{yuan(ctx.getValue())}</span>,
				}),
				columnHelper.accessor("status", {
					header: "状态",
					size: 100,
					cell: (ctx) => <Tag variant={STATUS_VARIANT[ctx.getValue()]}>{ctx.getValue()}</Tag>,
				}),
				columnHelper.accessor("updatedAt", {
					header: "更新时间",
					sortFn: "text",
					size: 150,
					cell: (ctx) => <span className="text-xs text-muted-foreground">{ctx.getValue()}</span>,
				}),
				actionsColumn<LedgerRow>({
					onEdit: (row) => toast.info(`编辑 ${row.code}`, { description: "示例:这里打开表单弹窗" }),
					onDelete: (row) => toast.warning(`删除 ${row.code}`, { description: "示例:这里打开确认框" }),
				}),
			]),
		[selected, toggleOne, toggleMany],
	);

	const table = useAppTable({
		columns,
		data: rows,
		globalFilterFn: "includesString",
		// 每页 5 条:12 行 → 3 页,分页行才有东西可看
		initialState: { pagination: { pageIndex: 0, pageSize: 5 } },
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "台账总数",
				value: ROWS.length,
				unit: "条",
				description: "全部来源",
				Icon: Plus,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
			},
			{
				key: "pending",
				label: "待复核",
				value: ROWS.filter((row) => row.status === "待复核").length,
				unit: "条",
				description: "需要人过一眼",
				Icon: Search,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
			},
			{
				key: "amount",
				label: "合计金额",
				value: yuan(ROWS.reduce((sum, row) => sum + row.amount, 0)),
				description: "本月累计",
				Icon: Download,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
			},
		],
		[],
	);

	return (
		<div className="space-y-3">
			<StatCards items={stats} />

			<FilterChipBar
				groups={[
					{
						key: "status",
						label: "状态",
						tone: "brand",
						options: [
							{ value: "启用", count: ROWS.filter((r) => r.status === "启用").length },
							{ value: "待复核", count: ROWS.filter((r) => r.status === "待复核").length },
							{ value: "停用", count: ROWS.filter((r) => r.status === "停用").length },
						],
					},
				]}
				active={{ status }}
				onSelect={(_key, value) => setStatus(value)}
				onClearAll={() => setStatus(undefined)}
				note="chip 计数由调用方按真实数据算好传进来"
			/>

			<ActiveFilterPills
				items={[
					...(status ? [{ key: "status", groupLabel: "状态", value: status, tone: "brand" as const }] : []),
					...(keyword.trim()
						? [{ key: "kw", groupLabel: "关键词", value: keyword.trim(), tone: "stone" as const }]
						: []),
				]}
				onRemove={(key) => {
					if (key === "status") setStatus(undefined);
					if (key === "kw") setKeyword("");
				}}
				onClearAll={() => {
					setStatus(undefined);
					setKeyword("");
				}}
			/>

			{/* 工具条:左搜索、右操作组 —— **在卡片外面**,搜索不该被卡片边框圈起来。
			    整行走 shared/ledger-toolbar(8 个台账页同款),别在这里手搓一份 */}
			<LedgerToolbar
				search={keyword}
				onSearchChange={(value) => {
					setKeyword(value);
					// 搜索词变了就回第一页,否则容易停在一个空页上(共享件的约定)
					table.setPageIndex(0);
				}}
				searchPlaceholder="搜索编号 / 名称 / 负责人 / 标签…"
				actions={
					<>
						<RefreshButton onClick={() => toast.success("已刷新", { description: "示例数据" })} />
						<ColumnToggle table={table} />
						<ActionButton onClick={() => toast.info("导出", { description: "示例:接 ledger-excel" })}>
							导出
						</ActionButton>
						<Button size="sm" onClick={() => toast.info("新增", { description: "示例:这里打开表单弹窗" })}>
							<Plus className="size-3.5" />
							新增
						</Button>
					</>
				}
			/>

			{/* 卡内表格 + 分页:走 shared/ledger-card,与 9 个真实台账页同形(含卡头「匹配 N 条」) */}
			<LedgerCard
				title="台账清单"
				Icon={ListChecks}
				count={table.getFilteredRowModel().rows.length}
				busy={false}
				emptyText="这条筛选下没有台账"
				table={table}
				rowClassName={(row) => (selected.has(row.id) ? "bg-brand-faint" : undefined)}
			>
				{/* 批量操作条:只在选中时出现,长在表格正上方(动作与选择对象挨着) */}
				<SelectionBar count={selected.size} unit="条" names={selectedRows.map((row) => row.code)}>
					<ActionButton onClick={clear}>清空选择</ActionButton>
					<ActionButton tone="danger" onClick={() => setPendingDelete(true)}>
						批量删除
					</ActionButton>
				</SelectionBar>
			</LedgerCard>

			<ConfirmDialog
				open={pendingDelete}
				onOpenChange={setPendingDelete}
				title="批量删除"
				description={`确认删除选中的 ${selected.size} 条?示例页不会真的删除 —— 只清空选择,演示「批量动作 = 确认框 + 清空」的写法。`}
				onConfirm={() => {
					clear();
					setPendingDelete(false);
					toast.success("已删除(示例)", { description: "真实页面在这里调 mutation" });
				}}
			/>
		</div>
	);
}
