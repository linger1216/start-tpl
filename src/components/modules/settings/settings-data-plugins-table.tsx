import { actionsColumn, EnabledBadge, TextCell, timeColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { createAppColumnHelper } from "#/lib/table";

/**
 * 插件清单的一行 —— 内置插件(代码里写死的四个)和库里的自定义插件在界面上**同一张表**,
 * 靠 `kind` 区分。内置那四行不给改也不给删(它们是权限地基,被改会静默改变所有人的可见范围)。
 *
 * v2 (m20034):不再有 `fn` 字段 —— 用户只能建「指定清单」类插件,清单内容以
 * `outputValues: { key, value }[]` 存;内置那四行 `outputValues` 是空数组。
 */
export type PluginRow = {
	kind: "builtin" | "custom";
	/** 表格工具族要求每行有 `id`(内置插件没有库 id,填它的标识) */
	id: string;
	pluginKey: string;
	label: string;
	/** 表里那些自定义插件存的「指定清单」(`{ key, value }[]`);内置的是空数组 */
	outputValues: Array<{ key: string; value: string }>;
	status: number;
	remark: string;
	createdAt: string | null;
	updatedAt: string | null;
};

const columnHelper = createAppColumnHelper<PluginRow>();

/**
 * 插件清单的列 —— v2 (m20034) 后只剩「名字 / 输出值 / 状态 / 说明 / 时间」五列,
 * 「函数体」改「输出值」:内置的写"写在代码里"(`outputValues.length === 0`),自定义的写
 * 「N 行(`key=value`)」,一目了然。
 */
export function pluginColumns({
	onView,
	onEdit,
	onDelete,
	onTest,
}: {
	onView: (row: PluginRow) => void;
	onEdit: (row: PluginRow) => void;
	onDelete: (row: PluginRow) => void;
	onTest: (row: PluginRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("label", {
			header: "名字",
			sortFn: "text",
			size: 240,
			cell: (ctx) => (
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-xs font-medium text-foreground">{ctx.getValue()}</span>
						{ctx.row.original.kind === "builtin" ? (
							<Badge variant="outline" className="text-xs">
								内置
							</Badge>
						) : null}
					</div>
					<span translate="no" className="truncate font-mono text-xs text-muted-foreground">
						{ctx.row.original.pluginKey}
					</span>
				</div>
			),
		}),
		columnHelper.accessor("outputValues", {
			header: "输出值",
			size: 140,
			cell: (ctx) =>
				ctx.row.original.kind === "builtin" ? (
					<span className="text-xs text-muted-foreground">写在代码里</span>
				) : (
					<span className="text-xs text-muted-foreground">
						{ctx.getValue().length === 0 ? "空" : `${ctx.getValue().length} 行`}
					</span>
				),
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 84,
			cell: (ctx) =>
				ctx.row.original.kind === "builtin" ? (
					<Badge variant="secondary" className="text-xs">
						随代码
					</Badge>
				) : (
					<EnabledBadge status={ctx.getValue()} />
				),
		}),
		columnHelper.accessor("remark", {
			header: "说明",
			size: 280,
			cell: (ctx) => (
				<span className="line-clamp-2 text-xs text-muted-foreground">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		timeColumn<PluginRow>("updatedAt", { header: "更新时间", size: 140 }),
		actionsColumn<PluginRow>({
			size: 200,
			extra: (row) => (
				<ActionButton title="用我本人的身份真算一次,看这个插件取到哪些值" onClick={() => onTest(row)}>
					预览
				</ActionButton>
			),
			onView,
			onEdit,
			onDelete,
			disabled: (row) => row.kind === "builtin",
		}),
	]);
}
