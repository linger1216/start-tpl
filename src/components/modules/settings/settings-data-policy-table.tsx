import { actionsColumn, selectColumn, TextCell } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { ACTION_LABEL, type PolicyRowView, RESOURCE_KIND_LABEL } from "#/lib/data-policy-spec";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";
import { EffectBadge, SubjectKindBadge } from "./settings-data-policy-badges";

/**
 * 规则清单的一行 —— 就是 `sys_data_policy` 的一行(`v0..v3` + `status` + `remark` + 时间),
 * 额外带上服务端翻好的人话(`subjectLabel` / `resourceTypeLabel` / `resourceDetail`)。
 *
 * 原始串(`user:<id>` / `demo_grid@org:<部门>`)**不出现在列表里** —— 表格要能一眼看懂;
 * 原始串放在详情弹窗,便于直接拿去写 SQL 或发工单。
 */

/** 资源范围类型 → 徽标配色 */
const RESOURCE_TONE: Record<PolicyRowView["resourceKind"], string> = {
	all: "bg-hue-blue-soft text-hue-blue-fg",
	type: "bg-hue-teal-soft text-hue-teal-fg",
	org: "bg-hue-amber-soft text-hue-amber-fg",
	row: "bg-hue-violet-soft text-hue-violet-fg",
};

const columnHelper = createAppColumnHelper<PolicyRowView>();

/**
 * 规则清单的列定义(列定义只在这一处,页面只负责编排)。
 *
 * 「谁」= 主体类型 + 主体名,「看什么」= 资源类型 + 范围(组织名 / 行名),
 * 后面是动作 / 效果 / 状态 / 说明 / 时间 —— **列 = 界面用得上的全部信息**,一条规则不长,
 * 没必要藏;嫌挤就点工具条里的「列」把不要的收起来。
 */
export function policyColumns({
	selected,
	onToggleOne,
	onToggleMany,
	onView,
	onEdit,
	onDelete,
	onExplain,
}: {
	/** 勾选集合(批量删除用),来自 `useRowSelection` */
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: readonly string[], on: boolean) => void;
	/** 详情(只读弹窗)—— 看原始串与完整备注 */
	onView: (row: PolicyRowView) => void;
	onEdit: (row: PolicyRowView) => void;
	onDelete: (row: PolicyRowView) => void;
	/**
	 * 「这条规则对谁生效?」—— 只有**按人授权**的行才给这个入口:
	 * 角色 / 部门主体得先知道"用谁来试",选人的动作交给工具条里的解释器。
	 */
	onExplain: (row: PolicyRowView) => void;
}) {
	return columnHelper.columns([
		selectColumn<PolicyRowView>({ selected, onToggleOne, onToggleMany }),
		columnHelper.accessor("subjectLabel", {
			header: "谁",
			sortFn: "text",
			size: 200,
			cell: (ctx) => (
				<div className="flex min-w-0 items-center gap-2">
					<SubjectKindBadge kind={ctx.row.original.subjectKind} tone />
					<span className="min-w-0 text-xs font-medium text-foreground">
						<TextCell value={ctx.getValue()} truncate />
					</span>
				</div>
			),
		}),
		columnHelper.accessor("resourceTypeLabel", {
			header: "看什么",
			sortFn: "text",
			size: 200,
			cell: (ctx) => (
				<div className="flex min-w-0 flex-col">
					<div className="flex min-w-0 items-center gap-2">
						<Badge className={`shrink-0 text-xs ${RESOURCE_TONE[ctx.row.original.resourceKind]}`}>
							{RESOURCE_KIND_LABEL[ctx.row.original.resourceKind]}
						</Badge>
						<span className="min-w-0 text-xs text-foreground">
							<TextCell value={ctx.getValue()} truncate />
						</span>
					</div>
					{ctx.row.original.resourceDetail ? (
						<span className="mt-0.5 pl-1 text-xs text-muted-foreground">
							<TextCell value={ctx.row.original.resourceDetail} truncate />
						</span>
					) : null}
				</div>
			),
		}),
		columnHelper.accessor("action", {
			header: "动作",
			size: 90,
			cell: (ctx) => (
				<Badge variant="secondary" className="text-xs">
					{ACTION_LABEL[ctx.getValue()] ?? ctx.getValue()}
				</Badge>
			),
		}),
		columnHelper.accessor("effect", {
			header: "效果",
			size: 90,
			cell: (ctx) => <EffectBadge effect={ctx.getValue()} />,
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 84,
			cell: (ctx) => (
				<Badge variant={Number(ctx.getValue()) === 1 ? "secondary" : "outline"} className="text-xs">
					{Number(ctx.getValue()) === 1 ? "启用" : "停用"}
				</Badge>
			),
		}),
		columnHelper.accessor("remark", {
			header: "说明",
			size: 300,
			cell: (ctx) => (
				<span className="line-clamp-2 text-xs text-muted-foreground">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		columnHelper.accessor("updatedAt", {
			header: "更新时间",
			size: 140,
			cell: (ctx) => (
				<span className="tabular-nums text-xs text-muted-foreground">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		actionsColumn<PolicyRowView>({
			size: 210,
			extra: (row) =>
				row.subjectKind === "user" ? <ActionButton onClick={() => onExplain(row)}>试算</ActionButton> : null,
			onView,
			onEdit,
			onDelete,
		}),
	]);
}
