import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { UserRow } from "#/components/modules/settings/settings-users-table";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

type DepartmentOption = { id: string; name: string };
type RoleOption = { id: string; name: string };
/** 一行的编辑态:(部门, 角色) */
type AssignRow = { departmentId: string; roleId: string };

/**
 * 某个用户的**授权**对话框 —— 他在哪些部门、每个部门是什么角色。
 *
 * 一人可跨多个部门(张三「上海=部门主管、武汉=普通员工」就是两行);他最终能看到的菜单与权限
 * 是这些角色的**并集**(计算在 `lib/rbac.ts`)。保存是**覆盖式**的:这里列出的部门就是最终结果。
 */
export function SettingsUsersGrantsDialog({
	user,
	departments,
	roles,
	open,
	onOpenChange,
}: {
	user: UserRow | null;
	departments: DepartmentOption[];
	roles: RoleOption[];
	open: boolean;
	onOpenChange: (next: boolean) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const assignQuery = useQuery({
		...trpc.user.assignments.queryOptions({ userId: user?.id ?? "" }),
		enabled: Boolean(user),
	});

	/** 本地编辑态;`null` = 没动过(用接口返回的)。打开时清空,避免串上一个人 */
	const [rows, setRows] = useState<AssignRow[] | null>(null);

	const effective: AssignRow[] =
		rows ?? (assignQuery.data ?? []).map((item) => ({ departmentId: item.departmentId, roleId: item.roleId }));
	/** 已经用掉的部门:下拉里要排除,避免同一部门两行(服务端有唯一约束) */
	const used = new Set(effective.map((row) => row.departmentId));
	const freeDepartments = departments.filter((dept) => !used.has(dept.id));

	/**
	 * 两个下拉的 `{ value, label }` 列表 —— **同一份**同时喂给 `<Select items>` 和 `<SelectItem>`。
	 *
	 * ⚠️ `items` 不能省:Base UI **不会**从 `<SelectItem>` 子元素收集 label(Radix / shadcn 才会),
	 * 没有 `items` 时触发器兜底画**原始 value**(实测角色那格画的是 `4OfXCtie…` 这种 nanoid)。
	 */
	const roleItems = roles.map((role) => ({ value: role.id, label: role.name }));
	const departmentItems = freeDepartments.map((dept) => ({ value: dept.id, label: dept.name }));

	const saveMutation = useMutation(
		trpc.user.setAssignments.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries(trpc.user.pathFilter());
				onOpenChange(false);
				toast.success(`已保存「${user?.name || user?.email || ""}」的授权`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={(next) => (saveMutation.isPending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>授权 · {user?.name || user?.email || ""}</DialogTitle>
					<DialogDescription>
						一个人在同一个部门只能有一个角色;多个部门的权限取**并集**,不需要切换"当前部门"。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					{effective.length === 0 ? (
						<p className="text-[12.5px] text-muted-foreground">
							还没有分配任何部门 —— 在权限体系启用后,他将看不到任何菜单。
						</p>
					) : (
						<ul className="space-y-2">
							{effective.map((row) => (
								<li key={row.departmentId} className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate text-[12.5px]">
										{departments.find((dept) => dept.id === row.departmentId)?.name ?? "(部门已删)"}
									</span>
									<Select
										items={roleItems}
										value={row.roleId}
										onValueChange={(next) =>
											setRows(
												effective.map((item) =>
													item.departmentId === row.departmentId ? { ...item, roleId: next ?? item.roleId } : item,
												),
											)
										}
									>
										<SelectTrigger className="h-8 w-40 text-[12.5px]" aria-label="角色">
											<SelectValue placeholder="选角色…" />
										</SelectTrigger>
										<SelectContent>
											{roleItems.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<ActionButton
										tone="danger"
										aria-label={`把 ${user?.name ?? ""} 移出这个部门`}
										onClick={() => setRows(effective.filter((item) => item.departmentId !== row.departmentId))}
									>
										移出
									</ActionButton>
								</li>
							))}
						</ul>
					)}

					<Select
						items={departmentItems}
						value=""
						onValueChange={(next) => {
							if (!next) return;
							setRows([...effective, { departmentId: next, roleId: roles[0]?.id ?? "" }]);
						}}
					>
						<SelectTrigger className="h-8 w-full text-[12.5px]" aria-label="加部门">
							<SelectValue placeholder="＋ 加一个部门…" />
						</SelectTrigger>
						<SelectContent>
							{departmentItems.length === 0 ? (
								<SelectItem value="__none__" disabled>
									所有部门都已分配
								</SelectItem>
							) : (
								departmentItems.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))
							)}
						</SelectContent>
					</Select>
				</div>

				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={saveMutation.isPending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={saveMutation.isPending || !user}
						onClick={() => user && saveMutation.mutate({ userId: user.id, items: effective })}
					>
						{saveMutation.isPending ? "保存中…" : "保存授权"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
