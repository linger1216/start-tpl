import { actionsColumn, TextCell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { scopeLabel } from "#/lib/data-scope-spec";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

/** 角色表的一行(tRPC `role.list` 出参)—— **与 `sys_role` 的列一一对应** + 一个派生计数 */
export type RoleRow = {
	id: string;
	code: string;
	name: string;
	sort: number;
	status: number;
	remark: string | null;
	/** 数据范围(all / self / dept / dept_below / up:N),见 lib/data-scope.ts */
	dataScope: string | null;
	createTime: string | null;
	updateTime: string | null;
	/** 有多少条部门成员分配在用这个角色(由 `role.list` 聚合出来的派生字段,不是表里的列) */
	memberCount: number;
};

const columnHelper = createAppColumnHelper<RoleRow>();

/**
 * 角色清单的列定义 —— 台账页的写法(列定义在这一处,页面只负责编排)。
 *
 * **列 = `sys_role` 的全部列**,一个不少(排障 / 核对数据时要能看全);
 * 嫌挤就点工具条里的「列」把不要的收起来 —— 不再替使用者决定"哪些字段不重要"。
 *
 * 唯一多出来的是「成员」:删角色前能一眼看出"还有人用着"(服务端也会拦,这里只是提前告知)。
 */
export function roleColumns({
	onView,
	onEdit,
	onDelete,
}: {
	onView: (row: RoleRow) => void;
	onEdit: (row: RoleRow) => void;
	/** 不传就不渲染「删除」(按钮级权限:没有这个权限的角色看不见它) */
	onDelete?: (row: RoleRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("name", {
			header: "角色",
			sortFn: "text",
			size: 160,
			cell: (ctx) => <span className="text-sm">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("code", {
			header: "标识",
			sortFn: "text",
			size: 150,
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("memberCount", {
			header: "成员",
			size: 80,
			cell: (ctx) => <span className="block text-right tabular-nums text-xs">{ctx.getValue()}</span>,
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
		columnHelper.accessor("sort", {
			header: "排序",
			size: 72,
			cell: (ctx) => (
				<span className="block text-right tabular-nums text-xs text-muted-foreground">{ctx.getValue()}</span>
			),
		}),
		columnHelper.accessor("dataScope", {
			header: "数据范围",
			size: 150,
			cell: (ctx) => <span className="text-xs">{scopeLabel(ctx.getValue())}</span>,
		}),
		columnHelper.accessor("remark", {
			header: "备注",
			size: 200,
			cell: (ctx) => (
				<span className="line-clamp-2 max-w-56 text-xs text-muted-foreground" title={ctx.getValue() ?? ""}>
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		columnHelper.accessor("createTime", {
			header: "创建时间",
			size: 140,
			cell: (ctx) => (
				<span className="tabular-nums text-xs text-muted-foreground">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		columnHelper.accessor("updateTime", {
			header: "更新时间",
			size: 140,
			cell: (ctx) => (
				<span className="tabular-nums text-xs text-muted-foreground">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		columnHelper.accessor("id", {
			header: "ID",
			size: 200,
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground/70">{ctx.getValue()}</span>,
		}),
		actionsColumn<RoleRow>({
			size: 190,
			// 权限点勾选是这个页面最主要的动作 —— 放在最前面
			// extra: (row) => <ActionButton onClick={() => onPerms(row)}>菜单权限</ActionButton>,
			onView,
			onEdit,
			onDelete,
		}),
	]);
}
