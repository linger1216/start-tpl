import { actionsColumn, TextCell, timeColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { POLICY_STATUS, type PolicyStatus, policyStatusMeta } from "#/lib/data-scope-spec";
import { createAppColumnHelper } from "#/lib/table";

/**
 * 数据范围规则的一行 —— **与 `sys_data_policy` 的列一一对应**,外加把主体 / 资源 / 插件
 * 翻译成人话的三个 `*Label`(服务端 `dataScope.list` 里查好的名字)。
 *
 * 主体存的是 `*` / `role:<id>` / `dept:<id>` / `user:<id>`(见 `lib/data-scope-spec.ts` 的
 * `parseSubject()`)—— **不物化成员**:规则里没有一行是"某个人的 id 列表",
 * 所以调一个人换部门 / 换角色不用回刷任何规则行。
 *
 * v2 (m20034)起:规则**不再**带 `items`,清单装在插件(`sys_data_plugin.output_values`)
 * 自己那里。这里只放规则的列 + 服务端翻译好的三个 `*Label`。
 */
export type DataScopeRow = {
	id: string;
	status: number;
	subject: string;
	subjectLabel: string;
	resource: string;
	resourceLabel: string;
	column: string | null;
	columnLabel: string | null;
	/** 从插件输出的每行里取哪个 key(m23422);null = 老规则,按 `column` 推断 */
	valueKey: string | null;
	pluginKey: string | null;
	pluginLabel: string | null;
	remark: string;
	createdAt: string | null;
	updatedAt: string | null;
};

/**
 * 这条规则到底在判什么 —— 三种合法形态(判据见 `lib/data-scope-spec.ts` 的 `validatePolicyCombo()`)。
 *
 * 台账上最该一眼看出来的就是它:同一张表上十条规则,只有这一列能告诉你"哪条全开、哪条按列筛"。
 * m23422 起把「取插件的哪个 key」也带上(`key=…`)—— 一个清单放多类值时,这一列必须能区分。
 */
export function ruleShapeText(row: DataScopeRow): string {
	if (!row.pluginKey) return "整类可见(这张表的全部行)";
	const key = row.valueKey ? `key=${row.valueKey}` : "key=按列名推断";
	return `${row.column ?? "?"} ∈ ${row.pluginLabel}(我) · ${key}`;
}

const SUBJECT_TONE: Record<string, string> = {
	"*": "bg-hue-amber-soft text-hue-amber-fg",
	role: "bg-hue-violet-soft text-hue-violet-fg",
	dept: "bg-hue-teal-soft text-hue-teal-fg",
	user: "bg-hue-blue-soft text-hue-blue-fg",
};

const columnHelper = createAppColumnHelper<DataScopeRow>();

/**
 * 数据范围台账的列定义 —— **列 = `sys_data_policy` 的全部列**(+ 三个翻译名),
 * 嫌挤就点工具条里的「列」把不要的收起来。
 */
export function dataScopeColumns({
	onPreview,
	onView,
	onEdit,
	onDelete,
	onStatus,
}: {
	/** 只读试算:把这条规则当成已上线,拿真实数据算一遍(引擎会执行的同一个编译路径) */
	onPreview: (row: DataScopeRow) => void;
	onView: (row: DataScopeRow) => void;
	onEdit: (row: DataScopeRow) => void;
	onDelete: (row: DataScopeRow) => void;
	/**
	 * 启用 / 上线 / 停用 —— 复用 `update` 接口,只挪 `status`(所以权限点还是「编辑」那个)。
	 * 命名口径见 `lib/data-scope-spec.ts` 的 `POLICY_STATUS`:启用是配置层面的开关,上线才进引擎。
	 */
	onStatus: (row: DataScopeRow, status: PolicyStatus) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("subjectLabel", {
			header: "谁",
			sortFn: "text",
			size: 200,
			cell: (ctx) => {
				const kind = ctx.row.original.subject.split(":")[0] ?? "all";
				return (
					<div className="flex min-w-0 flex-col gap-0.5 whitespace-normal break-words">
						<span className="text-xs font-medium text-foreground">{ctx.getValue()}</span>
						<Badge className={`w-fit text-xs ${SUBJECT_TONE[kind] ?? ""}`} translate="no">
							{ctx.row.original.subject}
						</Badge>
					</div>
				);
			},
		}),
		columnHelper.accessor("resourceLabel", {
			header: "资源表",
			sortFn: "text",
			size: 190,
			cell: (ctx) => (
				<div className="flex min-w-0 flex-col gap-0.5 whitespace-normal break-words">
					<span className="text-xs font-medium text-foreground">{ctx.getValue()}</span>
					<span translate="no" className="font-mono text-xs text-muted-foreground">
						{ctx.row.original.resource}
					</span>
				</div>
			),
		}),
		columnHelper.display({
			id: "shape",
			header: "判据",
			size: 260,
			cell: (ctx) => (
				<span translate="no" className="whitespace-normal break-words text-xs text-muted-foreground">
					<TextCell value={ruleShapeText(ctx.row.original)} />
				</span>
			),
		}),
		columnHelper.accessor("pluginKey", {
			header: "值域插件",
			size: 150,
			cell: (ctx) => {
				const row = ctx.row.original;
				if (!row.pluginKey) {
					return (
						<Badge variant="outline" className="text-xs">
							不用插件
						</Badge>
					);
				}
				return (
					<div className="flex min-w-0 flex-col gap-0.5 whitespace-normal break-words">
						<span className="text-xs">{row.pluginLabel}</span>
						<span translate="no" className="font-mono text-xs text-muted-foreground">
							{row.pluginKey}
						</span>
					</div>
				);
			},
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 92,
			cell: (ctx) => {
				const meta = policyStatusMeta(Number(ctx.getValue()));
				return (
					<Badge className={`text-xs ${meta.tone}`} title={meta.hint}>
						{meta.label}
					</Badge>
				);
			},
		}),
		columnHelper.accessor("remark", {
			header: "说明",
			size: 260,
			cell: (ctx) => (
				<span className="whitespace-normal break-words text-xs text-muted-foreground">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		timeColumn<DataScopeRow>("updatedAt", { header: "更新时间", size: 140 }),
		columnHelper.accessor("id", {
			header: "ID",
			size: 200,
			cell: (ctx) => (
				<span className="font-mono text-xs text-muted-foreground/70">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		actionsColumn<DataScopeRow>({
			size: 264,
			extra: (row) => {
				const status = Number(row.status) as PolicyStatus;
				return (
					<>
						<ActionButton onClick={() => onPreview(row)}>预览</ActionButton>
						{status === POLICY_STATUS.live ? (
							<ActionButton onClick={() => onStatus(row, POLICY_STATUS.disabled)}>停用</ActionButton>
						) : status === POLICY_STATUS.enabled ? (
							<ActionButton onClick={() => onStatus(row, POLICY_STATUS.live)}>上线</ActionButton>
						) : (
							<ActionButton onClick={() => onStatus(row, POLICY_STATUS.enabled)}>启用</ActionButton>
						)}
					</>
				);
			},
			onView,
			onEdit,
			onDelete,
		}),
	]);
}
