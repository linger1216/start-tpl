import { actionsColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { createAppColumnHelper } from "#/lib/table";

/** 用户台账的一行(tRPC `user.list` 出参) */
export type UserRow = {
	id: string;
	name: string;
	email: string;
	/** 这个人的部门 / 角色分配(一人可跨多个部门) */
	assignments: Array<{ departmentName: string; roleName: string }>;
};

const columnHelper = createAppColumnHelper<UserRow>();

/**
 * 用户台账的列定义 —— 版式对齐参数 / 角色的台账页。
 *
 * 「部门 / 角色」列直接把分配铺出来:不用点进去就能看出谁还没授权(那才是权限体系里最该被发现的状态)。
 */
export function userColumns({ onGrants }: { onGrants: (row: UserRow) => void }) {
	return columnHelper.columns([
		columnHelper.accessor("name", {
			header: "姓名",
			sortFn: "text",
			size: 150,
			cell: (ctx) => <span className="text-[13px]">{ctx.getValue() || "(未填姓名)"}</span>,
		}),
		columnHelper.accessor("email", {
			header: "邮箱",
			sortFn: "text",
			size: 240,
			cell: (ctx) => <span className="text-[12.5px] text-muted-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("assignments", {
			header: "部门 / 角色",
			size: 320,
			cell: (ctx) => {
				const list = ctx.getValue();
				if (list.length === 0) {
					return <span className="text-[12px] text-warn-fg">未分配(看不到任何菜单)</span>;
				}
				return (
					<span className="flex flex-wrap gap-1">
						{list.map((item) => (
							<span
								key={`${item.departmentName}-${item.roleName}`}
								className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[11.5px] text-muted-foreground"
							>
								{item.departmentName} · {item.roleName}
							</span>
						))}
					</span>
				);
			},
		}),
		actionsColumn<UserRow>({
			size: 90,
			// 用户只有这一个动作:给他分配部门与角色
			extra: (row) => <ActionButton onClick={() => onGrants(row)}>授权</ActionButton>,
		}),
	]);
}
