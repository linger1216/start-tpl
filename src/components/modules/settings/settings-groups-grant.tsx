import { ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { PermissionPicker } from "#/components/modules/shared/permission-tree";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	effectivePermissionCount,
	type GroupRow,
	groupsOfUser,
	listOf,
	PERMISSION_TREE,
	type RoleRow,
	type UserRow,
} from "#/mocks/settings";

/** 组授权回抛的领域值(编排壳据此调用 `grantToGroup`) */
export type SettingsGroupsGrantValues = { 角色: string[]; 权限点: string[] };

/**
 * 用户组弹窗—— 两个 tab 对应需求原文的两个动作:
 * 1. **管理成员**:从全部用户里勾选成员(可添加 / 移除),保存后即时刷新成员数,
 * 并双向同步用户的「所属用户组」;
 * 2. **组授权**:给整个组配置角色 + 权限点,保存后写回组表、追加组级授权记录,
 * 组内成员通过 `effectivePermissionIds` 继承。
 *
 *一人可同时属于多个组 —— 加入本组只往用户的多组列表里追加,不再从原组摘除;
 * 移除只摘掉本组,成员在其他组的归属与权限保持不变。
 *
 * 写操作由编排壳执行(本组件只回抛领域值),数据由编排壳以 props 注入。
 */
export function SettingsGroupsManageDialog({
	open,
	onOpenChange,
	group,
	users,
	roles,
	onSubmitMembers,
	onSubmitGrants,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** 当前组(null = 未打开) */
	group: GroupRow | null;
	/** 全部用户(成员候选) */
	users: readonly UserRow[];
	/** 角色候选 */
	roles: readonly RoleRow[];
	onSubmitMembers: (memberIds: string[]) => void;
	onSubmitGrants: (values: SettingsGroupsGrantValues) => void;
}) {
	const groupName = group?.组名 ?? "";
	const [memberSelection, setMemberSelection] = useState<string[]>([]);
	const [memberKeyword, setMemberKeyword] = useState("");
	const [roleSelection, setRoleSelection] = useState<string[]>([]);
	const [permissionSelection, setPermissionSelection] = useState<string[]>([]);

	// 打开 / 切换组时按当前组的成员与授权初始化勾选状态
	useEffect(() => {
		if (!open || !group) return;
		setMemberSelection(listOf(group.成员ids));
		setMemberKeyword("");
		setRoleSelection(listOf(group.已授权角色));
		setPermissionSelection(listOf(group.权限点));
	}, [open, group]);

	const toggleMember = (id: string, on: boolean) =>
		setMemberSelection((prev) => (on ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)));

	const togglePermission = (ids: string[], on: boolean) =>
		setPermissionSelection((prev) => {
			const next = new Set(prev);
			for (const id of ids) {
				if (on) next.add(id);
				else next.delete(id);
			}
			return [...next];
		});

	const visibleUsers = users.filter((user) => {
		if (!memberKeyword.trim()) return true;
		//:用户组是多值,搜索时把组名摊平后逐个匹配
		return [user.账号, user.姓名, user.所属部门, ...groupsOfUser(user)].some((value) =>
			String(value ?? "").includes(memberKeyword.trim()),
		);
	});
	const originalMembers = listOf(group?.成员ids).length;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						用户组 · {groupName}
						<Badge variant="secondary"></Badge>
					</DialogTitle>
					<DialogDescription>
						· 用户组管理,可以添加删除用户,并且可以给整个组进行授权。保存后立即写回组表与用户表,并追加授权记录。
					</DialogDescription>
				</DialogHeader>

				<Tabs key={group?.id ?? "none"} defaultValue="members">
					<TabsList>
						<TabsTrigger value="members" count={memberSelection.length}>
							管理成员
						</TabsTrigger>
						<TabsTrigger value="grants" count={permissionSelection.length}>
							组授权
						</TabsTrigger>
					</TabsList>

					<TabsContent value="members" className="space-y-3 pt-1">
						<div className="flex flex-wrap items-center gap-2">
							<UserPlus className="size-3.5 text-primary" />
							<span className="text-[13px] font-medium text-foreground">
								已选 {memberSelection.length} 人(当前 {originalMembers} 人)
							</span>
							<Input
								value={memberKeyword}
								onChange={(event) => setMemberKeyword(event.target.value)}
								placeholder="搜索账号 / 姓名 / 部门 / 用户组…"
								className="h-7 w-60"
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setMemberSelection((prev) => [...new Set([...prev, ...visibleUsers.map((u) => u.id)])])}
							>
								选中当前 {visibleUsers.length} 人
							</Button>
							<Button variant="outline" size="sm" onClick={() => setMemberSelection([])}>
								清空
							</Button>
						</div>

						<div className="max-h-80 space-y-1.5 overflow-y-auto rounded-xl border border-border p-3">
							{visibleUsers.map((user) => {
								const id = user.id;
								const on = memberSelection.includes(id);
								//:展示该用户当前所属的**全部**用户组,本组高亮
								const userGroups = groupsOfUser(user);
								return (
									<div
										key={id}
										className={
											on
												? "flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5"
												: "flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
										}
									>
										<Checkbox
											aria-label={`选择成员 ${user.姓名}`}
											checked={on}
											onCheckedChange={(checked) => toggleMember(id, checked === true)}
										/>
										<div className="min-w-0 flex-1">
											<div className="truncate text-[13px] text-foreground">
												{user.姓名}
												<span className="ml-1 text-[11px] text-muted-foreground">{user.账号}</span>
											</div>
											<div className="truncate text-[11px] text-muted-foreground">
												{user.所属部门} · 有效权限 {effectivePermissionCount(user)} 项
											</div>
										</div>
										<div className="flex flex-wrap justify-end gap-1">
											{userGroups.length === 0 ? (
												<Badge variant="outline" className="text-[10px]">
													未分配组
												</Badge>
											) : (
												userGroups.map((name) => (
													<Badge
														key={name}
														variant={name === groupName ? "default" : "outline"}
														className="text-[10px]"
													>
														{name}
													</Badge>
												))
											)}
										</div>
									</div>
								);
							})}
						</div>
						<p className="text-[12px] text-muted-foreground">
							勾选的用户会成为本组成员;一个人可以同时属于多个用户组 ——
							加入本组只往其多组列表里追加,不会从原有组摘除,取消勾选也只移除本组。
						</p>

						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => onOpenChange(false)}>
								取消
							</Button>
							<Button onClick={() => onSubmitMembers(memberSelection)}>保存成员</Button>
						</div>
					</TabsContent>

					<TabsContent value="grants" className="space-y-3 pt-1">
						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<ShieldCheck className="size-3.5 text-primary" />
								<span className="text-[13px] font-medium text-foreground">
									组角色({roleSelection.length} 个已选,可多选,组内成员继承)
								</span>
							</div>
							<div className="grid gap-1.5 sm:grid-cols-2">
								{roles.map((role) => {
									const name = role.角色名;
									const on = roleSelection.includes(name);
									return (
										<div
											key={role.id}
											className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
										>
											<Checkbox
												aria-label={`选择角色 ${name}`}
												checked={on}
												onCheckedChange={(checked) =>
													setRoleSelection((prev) =>
														checked === true ? [...new Set([...prev, name])] : prev.filter((item) => item !== name),
													)
												}
											/>
											<div className="min-w-0">
												<div className="text-[12px] text-foreground">{name}</div>
												<div className="truncate text-[11px] text-muted-foreground">
													{role.角色编码} · {role.数据范围}
												</div>
											</div>
										</div>
									);
								})}
							</div>
						</div>

						<PermissionPicker
							nodes={PERMISSION_TREE}
							selected={permissionSelection}
							onToggle={togglePermission}
							title="组权限点"
							placeholder="搜索权限点,如 用户 / 菜单 / 导出…"
						/>

						<div className="rounded-xl border border-border p-3">
							<div className="text-[12px] font-medium text-foreground">
								组内成员继承预览({memberSelection.length} 人)
							</div>
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{users
									.filter((user) => memberSelection.includes(user.id))
									.map((user) => (
										<Badge key={user.id} variant="secondary" className="text-[11px]">
											{user.姓名} · 有效权限 {effectivePermissionCount(user)} 项
										</Badge>
									))}
							</div>
						</div>

						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => onOpenChange(false)}>
								取消
							</Button>
							<Button onClick={() => onSubmitGrants({ 角色: roleSelection, 权限点: permissionSelection })}>
								保存组授权
							</Button>
						</div>
					</TabsContent>
				</Tabs>

				<DialogFooter>
					<span className="text-[12px] text-muted-foreground">
						成员与组授权分两个 tab 保存;组授权保存后组内成员自动继承,无需逐个用户配置。
					</span>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
