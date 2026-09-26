import { actionsColumn, selectColumn, TextCell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

/** 与 `trpc.demoGrid.list` 的出参一一对应(见 doc/测试数据/README.md 的字段对应) */
export type GridRow = {
	id: string;
	name: string;
	townName: string | null;
	townId: string | null;
	/** 归属的「管理单元」节点(行级数据范围按它算) */
	groupId: string | null;
	ownerName: string | null;
	ownerId: string | null;
	duty: string | null;
	remark: string | null;
	createTime: string | null;
	updateTime: string | null;
};

const columnHelper = createAppColumnHelper<GridRow>();

/**
 * 网格履职台账的列定义。
 *
 * 两列关于"人"的字段别混:
 *  · **网格长**(`owner_name`)—— Excel 里那一列的原样文本(真实姓名);
 *  · **负责人**(`owner_id`)—— **指派给哪个系统账号** —— **行级数据权限就是按它算的**
 *    (队员的 `self` 档 = `owner_id = 我`)。没指派时显示「未指派」。
 */
export function gridColumns({
	selected,
	onToggleOne,
	onToggleMany,
	ownerNameOf,
	onView,
	onEdit,
	onDelete,
}: {
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	/** `owner_id` → 名字(页面上用 `user.list` 建的那张表) */
	ownerNameOf: (ownerId: string | null) => string | null;
	onView: (row: GridRow) => void;
	onEdit: (row: GridRow) => void;
	onDelete: (row: GridRow) => void;
}) {
	return columnHelper.columns([
		selectColumn<GridRow>({ selected, onToggleOne, onToggleMany }),
		columnHelper.accessor("townName", {
			header: "所属街镇",
			size: 120,
			cell: (ctx) => (
				<span className="text-xs" title={ctx.row.original.townId ?? ""}>
					{ctx.getValue() ?? "—"}
				</span>
			),
		}),
		columnHelper.accessor("name", {
			header: "网格名称",
			size: 140,
			cell: (ctx) => <span className="text-sm font-medium text-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("ownerName", {
			header: "网格长",
			size: 110,
			cell: (ctx) => <TextCell value={ctx.getValue()} />,
		}),
		columnHelper.accessor("ownerId", {
			header: "负责人",
			size: 130,
			cell: (ctx) => {
				const owner = ownerNameOf(ctx.getValue());
				return owner ? (
					<Badge variant="secondary">{owner}</Badge>
				) : (
					<span className="text-xs text-muted-foreground/60">未指派</span>
				);
			},
		}),
		columnHelper.accessor("duty", { header: "工作职务", size: 150 }),
		columnHelper.accessor("remark", {
			header: "备注",
			size: 180,
			cell: (ctx) => <TextCell value={ctx.getValue()} />,
		}),
		columnHelper.accessor("updateTime", {
			header: "更新时间",
			size: 150,
			cell: (ctx) => <span className="tabular-nums text-xs">{formatLocalMinute(ctx.getValue())}</span>,
		}),
		actionsColumn<GridRow>({ size: 160, onView, onEdit, onDelete }),
	]);
}
