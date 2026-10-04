import { actionsColumn, EnabledBadge, TextCell, timeColumn } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { PARA_TYPE, PARA_TYPE_META, type ParaType } from "#/lib/para-spec";
import { createAppColumnHelper } from "#/lib/table";

/**
 * 参数清单的一行 —— **与 `sys_para` 的十列一一对应**(+ 代码内置默认值的兜底):
 * `id`、`key`→`para_key`、`value`→`para_value`、`type`→`para_type`、`group`→`para_group`、
 * `status`、`remark`、`editable`、`createdAt`→`create_time`、`updatedAt`→`update_time`。
 *
 * `id` 在"纯代码内置、还没写进库"的参数上是空串(`sys_para.id` 是库里的无意义短串,
 * 业务永远按 `para_key` 找参数)—— 表格里显示成 `—`;行标识用 `key`(见页面里的 `getRowId`)。
 * 表里没有的派生字段(如"是默认值还是已改过")不要加回来 —— 界面上不该出现库里没有的列。
 */
export type ParameterRow = {
	id: string;
	key: string;
	value: string;
	type: ParaType;
	group: string;
	remark: string;
	editable: boolean;
	status: number;
	createdAt: string | null;
	updatedAt: string | null;
};

/** 类型码 → 徽标配色(键必须与 `para_type` 的码一致:1 int / 2 bool / 3 string / 4 json) */
const TYPE_TONE: Record<ParaType, string> = {
	[PARA_TYPE.INT]: "bg-hue-blue-soft text-hue-blue-fg",
	[PARA_TYPE.BOOL]: "bg-hue-teal-soft text-hue-teal-fg",
	[PARA_TYPE.STRING]: "bg-secondary text-foreground",
	[PARA_TYPE.JSON]: "bg-hue-violet-soft text-hue-violet-fg",
};

function previewValue(row: ParameterRow): string {
	if (row.type === PARA_TYPE.JSON) {
		try {
			return JSON.stringify(JSON.parse(row.value), null, 0);
		} catch {
			return row.value;
		}
	}
	return row.value;
}

const columnHelper = createAppColumnHelper<ParameterRow>();

/**
 * 参数清单的列定义 —— 台账页的写法(列定义在这一处,页面只负责编排)。
 *
 * **列 = `sys_para` 的全部列**,一个不少(参数最容易变成"不敢改的谜",能看全才好判断);
 * 嫌挤就点工具条里的「列」把不要的收起来。
 *
 * 「说明」列直接展示 `remark` —— 代码内置参数的说明来自 `PARA_DEFAULTS`,要自带文档,
 * 而不是让人去翻代码。
 */
export function parameterColumns({
	onView,
	onEdit,
	onDelete,
}: {
	/** 详情(只读弹窗)—— 值被截断、说明只有一行时,靠它看全 */
	onView: (row: ParameterRow) => void;
	onEdit: (row: ParameterRow) => void;
	onDelete: (row: ParameterRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("key", {
			header: "参数名",
			sortFn: "text",
			size: 240,
			cell: (ctx) => (
				<span translate="no" className="font-mono text-xs text-foreground">
					{ctx.getValue()}
				</span>
			),
		}),
		columnHelper.accessor("group", {
			header: "分组",
			sortFn: "text",
			size: 130,
			cell: (ctx) => (
				<Badge variant="secondary" className="text-xs">
					{ctx.getValue()}
				</Badge>
			),
		}),
		columnHelper.accessor("value", {
			header: "当前值",
			size: 240,
			cell: (ctx) => (
				<span translate="no" className="font-mono text-xs font-medium text-foreground">
					<TextCell value={previewValue(ctx.row.original)} truncate />
				</span>
			),
		}),
		columnHelper.accessor("type", {
			header: "类型",
			size: 100,
			cell: (ctx) => (
				<Badge className={`text-xs ${TYPE_TONE[ctx.getValue()]}`}>{PARA_TYPE_META[ctx.getValue()].label}</Badge>
			),
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 84,
			cell: (ctx) => <EnabledBadge status={ctx.getValue()} />,
		}),
		columnHelper.accessor("editable", {
			header: "可编辑",
			size: 96,
			cell: (ctx) => (
				<Badge variant={ctx.getValue() ? "secondary" : "outline"} className="text-xs">
					{ctx.getValue() ? "可改" : "内置只读"}
				</Badge>
			),
		}),
		columnHelper.accessor("remark", {
			header: "说明",
			size: 340,
			cell: (ctx) => (
				<span className="line-clamp-2 text-xs text-muted-foreground">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		timeColumn<ParameterRow>("createdAt", { header: "创建时间", size: 140 }),
		timeColumn<ParameterRow>("updatedAt", { header: "更新时间", size: 140 }),
		columnHelper.accessor("id", {
			header: "ID",
			size: 200,
			cell: (ctx) => (
				<span className="font-mono text-xs text-muted-foreground/70">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		actionsColumn<ParameterRow>({
			size: 150,
			onView,
			onEdit,
			onDelete,
			// 代码内置参数(editable = 0)只能看不能改
			disabled: (row) => !row.editable,
		}),
	]);
}
