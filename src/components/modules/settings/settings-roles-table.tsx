import { actionsColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { createAppColumnHelper } from "#/lib/table";

/** 角色表的一行(tRPC `role.list` 出参) */
export type RoleRow = {
	id: string;
	code: string;
	name: string;
	sort: number;
	status: number;
	remark: string | null;
	/** 有多少条部门成员分配在用这个角色 */
	memberCount: number;
};

const columnHelper = createAppColumnHelper<RoleRow>();

/**
 * 角色清单的列定义 —— 台账页的写法(列定义在这一处,页面只负责编排)。
 *
 * 多一列「成员」:删角色前能一眼看出"还有人用着"(服务端也会拦,这里只是提前告知)。
 */
export function roleColumns({
	onPerms,
	onEdit,
	onDelete,
}: {
	onPerms: (row: RoleRow) => void;
	onEdit: (row: RoleRow) => void;
	/** 不传就不渲染「删除」(按钮级权限:没有这个权限的角色看不见它) */
	onDelete?: (row: RoleRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("name", {
			header: "角色",
			sortFn: "text",
			size: 180,
			cell: (ctx) => <span className="text-[13px]">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("code", {
			header: "标识",
			sortFn: "text",
			size: 170,
			cell: (ctx) => <span className="font-mono text-[12px] text-muted-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("memberCount", {
			header: "成员",
			size: 90,
			cell: (ctx) => <span className="block text-right tabular-nums text-[12.5px]">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 90,
			cell: (ctx) => (
				<Badge variant={Number(ctx.getValue()) === 1 ? "secondary" : "outline"} className="text-[11px]">
					{Number(ctx.getValue()) === 1 ? "启用" : "停用"}
				</Badge>
			),
		}),
		actionsColumn<RoleRow>({
			size: 190,
			// 权限点勾选是这个页面最主要的动作 —— 放在最前面
			extra: (row) => <ActionButton onClick={() => onPerms(row)}>菜单权限</ActionButton>,
			onEdit,
			onDelete,
		}),
	]);
}
