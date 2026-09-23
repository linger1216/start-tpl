import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { RoleRow } from "#/components/modules/settings/settings-roles-table";
import { type PermissionNode, PermissionPicker } from "#/components/modules/shared/permission-tree";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/**
 * 角色的**菜单权限**对话框 —— 权限点就是菜单表本身(菜单 + 按钮)。
 *
 * 单开一个对话框而不是塞进角色表单:这棵树挺高,和"角色名 / 标识"挤在一起会把字段压没。
 * 保存时服务端会**自动补全祖先**(只勾深层子菜单时,侧边栏那一枝才有地方挂)。
 */
export function SettingsRolesPermsDialog({
	role,
	permTree,
	open,
	onOpenChange,
}: {
	role: RoleRow | null;
	permTree: PermissionNode[];
	open: boolean;
	onOpenChange: (next: boolean) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const idsQuery = useQuery({
		...trpc.role.menuIds.queryOptions({ roleId: role?.id ?? "" }),
		enabled: Boolean(role),
	});

	/** 本地勾选态;`null` = 还没动过(用接口返回的)。打开时清空,避免串上一个角色的勾选 */
	const [draft, setDraft] = useState<string[] | null>(null);
	const effective = draft ?? idsQuery.data ?? [];

	const saveMutation = useMutation(
		trpc.role.setMenus.mutationOptions({
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.role.pathFilter());
				onOpenChange(false);
				toast.success(`已保存「${role?.name ?? ""}」的权限(${outcome.count} 项,含自动补全的上级菜单)`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={(next) => (saveMutation.isPending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>菜单权限 · {role?.name ?? ""}</DialogTitle>
					<DialogDescription>
						勾中的菜单会在侧边栏显示,勾中的**按钮**决定页里那些操作按钮是否可见(前端 `useHasPerm` 认它)。
					</DialogDescription>
				</DialogHeader>

				<PermissionPicker
					nodes={permTree}
					selected={effective}
					title="菜单与按钮"
					placeholder="搜索菜单 / 按钮,如 角色 / 导出…"
					onToggle={(ids, on) => {
						const next = new Set(effective);
						for (const id of ids) {
							if (on) next.add(id);
							else next.delete(id);
						}
						setDraft([...next]);
					}}
				/>

				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={saveMutation.isPending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={saveMutation.isPending || !role}
						onClick={() => role && saveMutation.mutate({ roleId: role.id, menuIds: effective })}
					>
						{saveMutation.isPending ? "保存中…" : "保存权限"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
