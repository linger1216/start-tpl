import { KeyRound, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { PermissionPicker } from "#/components/modules/shared/permission-tree";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { SearchSelect } from "#/components/ui/search-select";
import { DATA_SCOPES, PERMISSION_TREE, type RoleRow, rolesOfUser, type UserRow } from "#/mocks/settings";

/** 配置权限回抛的领域值(编排壳据此调用 `setRolePermissions`) */
export type SettingsRolesGrantValues = { 权限点: string[]; 数据范围: string };

/**
 * 角色授权弹窗——「根据角色信息对用户进行授权管理」:
 * 上段是角色自身信息、数据范围与该角色下的用户;下段用权限树勾选该角色的权限点。
 * 保存把「权限点 + 数据范围」作为领域值上抛给编排壳(由它调用 `setRolePermissions` 真写回)。
 *
 *「该角色下的用户」按角色名在用户的**多角色数组**里匹配,
 * 因此一个用户同时持 2~3 个角色时,会在每个角色的名单里都出现(关联用户数是真实数量)。
 */
export function SettingsRolesGrantDialog({
	open,
	onOpenChange,
	role,
	users,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** 当前角色(null = 未打开) */
	role: RoleRow | null;
	/** 全部用户(用于列出该角色下的用户) */
	users: readonly UserRow[];
	onSubmit: (values: SettingsRolesGrantValues) => void;
}) {
	const roleName = role?.角色名 ?? "";
	//:多角色用户在数组里匹配到就计入,同一用户可同时出现在多个角色的名单里
	const members = users.filter((user) => rolesOfUser(user).includes(roleName));
	const [permissionSelection, setPermissionSelection] = useState<string[]>([]);
	const [scope, setScope] = useState(DATA_SCOPES[0] ?? "");

	// 打开 / 切换角色时按该角色当前的权限点与数据范围初始化
	useEffect(() => {
		if (!open || !role) return;
		setPermissionSelection(role.权限点);
		setScope(role.数据范围 || (DATA_SCOPES[0] ?? ""));
	}, [open, role]);

	const toggle = (ids: string[], on: boolean) =>
		setPermissionSelection((prev) => {
			const next = new Set(prev);
			for (const id of ids) {
				if (on) next.add(id);
				else next.delete(id);
			}
			return [...next];
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						配置权限 · {roleName}
						<Badge variant="secondary"></Badge>
					</DialogTitle>
					<DialogDescription>
						按角色配置权限点:保存后写回角色表,角色列表的「权限点数」即时更新,该角色下的用户通过角色继承这批权限。
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
					<div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
						<div>
							<div className="text-[11px] text-muted-foreground">角色编码</div>
							<div className="text-[13px] text-foreground">{role?.角色编码 ?? "—"}</div>
						</div>
						<div className="space-y-1">
							<div className="text-[11px] text-muted-foreground">数据范围</div>
							<SearchSelect
								value={scope}
								onValueChange={setScope}
								options={DATA_SCOPES.map((item) => ({ value: item, label: item }))}
								triggerClassName="h-7"
							/>
						</div>
						<div>
							<div className="text-[11px] text-muted-foreground">关联用户数</div>
							{/*:不读落库计数,按用户表实时统计(多角色用户在每个角色下各计一次) */}
							<div className="text-[13px] text-foreground">{members.length} 人</div>
						</div>
					</div>

					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<Users className="size-3.5 text-primary" />
							<span className="text-[13px] font-medium text-foreground">
								该角色下的用户({members.length} 人,随角色权限继承授权)
							</span>
						</div>
						<div className="flex flex-wrap gap-1.5">
							{members.length === 0 ? (
								<span className="text-[12px] text-muted-foreground">暂无用户使用该角色</span>
							) : (
								members.map((user) => (
									<Badge key={user.id} variant="secondary">
										{user.姓名} · {user.所属部门}
									</Badge>
								))
							)}
						</div>
					</div>

					<PermissionPicker
						nodes={PERMISSION_TREE}
						selected={permissionSelection}
						onToggle={toggle}
						title="权限点"
						placeholder="搜索权限点,如 用户 / 菜单 / 导出…"
					/>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={!role}
						onClick={() => onSubmit({ 权限点: permissionSelection, 数据范围: scope })}
						className="gap-1.5"
					>
						<KeyRound className="size-3.5" />
						保存权限
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
