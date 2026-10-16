import { actionsColumn, EnabledTag, TextCell, timeColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Tag } from "#/components/ui/tag";
import { createAppColumnHelper } from "#/lib/table";

/**
 * 字段管理页用到的字典行(`sys_dict` 的一行)—— **与 `sys_dict` 的列一一对应**。
 * `id` 是 nanoid 主键,业务一律用 `code`。
 */
export type SettingsDictRow = {
	id: string;
	code: string;
	name: string;
	items: Array<{ label: string; value: string }>;
	remark: string | null;
	status: number;
	createTime: string | null;
	updateTime: string | null;
};

export type SettingsDictCallbacks = {
	onView: (row: SettingsDictRow) => void;
	onEdit: (row: SettingsDictRow) => void;
	onToggle: (row: SettingsDictRow) => void;
	onDelete: (row: SettingsDictRow) => void;
};

const columnHelper = createAppColumnHelper<SettingsDictRow>();

/**
 * 字段管理表格(字典列表)的列定义 —— `sys_dict` 一行一个字典。
 *
 * **列 = `sys_dict` 的全部列**,一个不少;嫌挤就点工具条里的「列」把不要的收起来。
 * 「字典项」列只展示前几项做抽样(完整内容在编辑弹窗里看),「项数」是它的派生展示列。
 *
 * `busyId` 那行(正在启停 / 删除的那条)把「编辑 / 停用 / 删除」都置灰,避免连点。
 */
export function dictionaryColumns({ callbacks, busyId }: { callbacks: SettingsDictCallbacks; busyId: string | null }) {
	const busy = (row: SettingsDictRow) => busyId === row.id;
	return columnHelper.columns([
		columnHelper.accessor("name", {
			header: "字典名称",
			sortFn: "text",
			size: 160,
			cell: (ctx) => <span className="text-sm font-medium text-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("code", {
			header: "字典编码",
			sortFn: "text",
			size: 170,
			cell: (ctx) => (
				<span translate="no" className="font-mono text-xs text-muted-foreground">
					{ctx.getValue()}
				</span>
			),
		}),
		columnHelper.accessor("items", {
			header: "字典项",
			size: 300,
			cell: (ctx) => {
				const items = ctx.getValue();
				return (
					<div className="flex flex-wrap items-center gap-1">
						{items.slice(0, 4).map((item) => (
							<Tag key={item.value} variant="secondary" className="gap-1 text-xs">
								{item.label}
								<span translate="no" className="font-mono text-xs text-muted-foreground">
									{item.value}
								</span>
							</Tag>
						))}
						{items.length > 4 ? <span className="text-xs text-muted-foreground">等 {items.length} 项</span> : null}
						{items.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : null}
					</div>
				);
			},
		}),
		columnHelper.display({
			id: "itemCount",
			header: "项数",
			size: 80,
			cell: (ctx) => (
				<span className="block text-right tabular-nums text-xs text-muted-foreground">
					{ctx.row.original.items.length}
				</span>
			),
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 84,
			cell: (ctx) => <EnabledTag status={ctx.getValue()} />,
		}),
		columnHelper.accessor("remark", {
			header: "说明",
			size: 240,
			cell: (ctx) => (
				<span className="line-clamp-2 max-w-64 text-xs text-muted-foreground" title={ctx.getValue() ?? ""}>
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		timeColumn<SettingsDictRow>("createTime", { header: "创建时间", size: 140 }),
		timeColumn<SettingsDictRow>("updateTime", { header: "更新时间", size: 140 }),
		columnHelper.accessor("id", {
			header: "ID",
			size: 200,
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground/70">{ctx.getValue()}</span>,
		}),
		actionsColumn<SettingsDictRow>({
			size: 190,
			extra: (row) => (
				<ActionButton
					disabled={busy(row)}
					title={row.status === 1 ? "停用这个字典" : "启用这个字典"}
					onClick={() => callbacks.onToggle(row)}
				>
					{row.status === 1 ? "停用" : "启用"}
				</ActionButton>
			),
			onView: callbacks.onView,
			onEdit: callbacks.onEdit,
			onDelete: callbacks.onDelete,
			disabled: busy,
		}),
	]);
}
