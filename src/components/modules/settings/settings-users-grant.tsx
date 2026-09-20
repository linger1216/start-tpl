import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { PermissionPicker } from "#/components/modules/shared/permission-tree";
import { TagBadges } from "#/components/modules/shared/tag-badges";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { SearchSelect } from "#/components/ui/search-select";
import {
	effectivePermissionCount,
	groupsOfUser,
	joinList,
	ownPermissionIds,
	PERMISSION_TREE,
	type RoleRow,
	rolesOfUser,
	type UserRow,
} from "#/mocks/settings";

/**
 * 用户授权弹窗 —— 单用户授权与 批量授权**共用**同一个弹窗:
 * 单用户时展示该用户基本信息与当前有效权限,批量时展示所选用户清单;
 * 保存把「角色 + 权限点」作为领域值上抛给编排壳,由编排壳调用 `grantToUsers` 真写回。
 *
 *角色区是**多选**复选框列表,用户可以同时持有多个角色;
 * 用户组归属不在此处改(多组归属由用户组页的「管理成员」维护,避免两个入口互相踩)。
 *
 * 数据全部由编排壳以 props 注入(见 `doc/前端结构与组件约定.md` §5.2:只有编排壳订阅数据)。
 */
export type SettingsUsersGrantValues = {
	角色: string[];
	权限点: string[];
	来源: string;
	说明: string;
};

/** 多角色的窄卡片摘要:A +N(完整角色列表看表格徽章或授权弹窗) */
function roleSummary(user: UserRow): string {
	const roles = rolesOfUser(user);
	if (roles.length === 0) return "未授权";
	return roles.length === 1 ? (roles[0] ?? "未授权") : `${roles[0] ?? ""} +${roles.length - 1}`;
}

export function SettingsUsersGrantDialog({
	open,
	onOpenChange,
	targets,
	roles,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** 本次授权作用到的用户(1 个 = 单用户授权, 的批量授权可多个) */
	targets: UserRow[];
	/** 角色候选(来自角色表) */
	roles: RoleRow[];
	onSubmit: (values: SettingsUsersGrantValues) => void;
}) {
	const batch = targets.length > 1;
	const [roleSelection, setRoleSelection] = useState<string[]>([]);
	const [permissionSelection, setPermissionSelection] = useState<string[]>([]);

	// 打开时以所选用户现有授权的并集作为初始勾选,便于在其上增删(多角色全部并入)
	useEffect(() => {
		if (!open) return;
		setRoleSelection([...new Set(targets.flatMap((row) => rolesOfUser(row)))]);
		setPermissionSelection([...new Set(targets.flatMap((row) => ownPermissionIds(row)))]);
	}, [open, targets]);

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
						{batch ? `批量授权 · 已选 ${targets.length} 个用户` : `用户授权 · ${targets[0]?.姓名 ?? ""}`}
						<Badge variant="secondary">{batch ? "" : ""}</Badge>
					</DialogTitle>
					<DialogDescription>
						{batch
							? "所选用户将统一被设置为下面的角色与权限点(角色区可多选,一个人可同时持有多个角色;保存后立即写回用户表,并各生成一条授权记录)。"
							: "为该用户配置角色与权限点(角色区可多选,一个人可同时持有多个角色);保存后立即写回用户表并生成一条授权记录。"}
						用户组归属不在本弹窗维护 —— 一个人可同属多个用户组,由「用户组管理 → 管理成员」双向同步。
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
					{targets.length === 1 && targets[0] ? (
						<div className="divide-y divide-border rounded-xl border border-border px-3 py-1">
							<DetailRow label="账号 / 姓名">
								{targets[0].账号} / {targets[0].姓名}
							</DetailRow>
							<DetailRow label="手机号">{targets[0].手机号}</DetailRow>
							<DetailRow label="所属部门">{targets[0].所属部门}</DetailRow>
							<DetailRow label="所属用户组">
								<TagBadges tags={groupsOfUser(targets[0])} />
							</DetailRow>
							<DetailRow label="角色">
								<TagBadges tags={rolesOfUser(targets[0])} />
							</DetailRow>
							<DetailRow label="最近登录">{targets[0].最近登录时间}</DetailRow>
							<DetailRow label="有效权限">
								{effectivePermissionCount(targets[0])} 项(本人授权 + 所属用户组继承 + 全部角色继承去重)
							</DetailRow>
						</div>
					) : (
						<div className="flex flex-wrap gap-1.5 rounded-xl border border-border p-3">
							{targets.map((user) => (
								<Badge key={user.id} variant="secondary">
									{user.姓名}({user.账号})
								</Badge>
							))}
						</div>
					)}

					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<ShieldCheck className="size-3.5 text-primary" />
							<span className="text-[13px] font-medium text-foreground">
								角色({roleSelection.length} 个已选,可多选)
							</span>
						</div>
						<div className="grid gap-1.5 sm:grid-cols-2">
							{roles.map((role) => {
								const name = role.角色名;
								const on = roleSelection.includes(name);
								return (
									<div key={role.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
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
												{role.角色编码} · {role.数据范围} · {role.状态}
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
						onToggle={toggle}
						placeholder="搜索权限点,如 用户 / 导出 / 查看…"
					/>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={targets.length === 0}
						onClick={() =>
							onSubmit({
								角色: roleSelection,
								权限点: permissionSelection,
								来源: batch ? "批量授权" : "单用户授权",
								说明: batch ? ":批量设置用户权限(一次写入所选用户的角色与权限点)" : ":对单一用户进行权限管理",
							})
						}
					>
						保存授权
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * 批量授权工作台:先多选用户,再一次性设置角色与权限点(真多选 + 真写回)。
 *
 * 用户数据由编排壳注入;本组件只持有"选哪些人 / 怎么筛"这一层页面 UI 态。
 */
export function SettingsUsersBatchGrantPanel({
	users,
	onGrant,
}: {
	users: readonly UserRow[];
	onGrant: (ids: string[]) => void;
}) {
	const [keyword, setKeyword] = useState("");
	const [scope, setScope] = useState("全部用户");
	const [selected, setSelected] = useState<string[]>([]);

	const visible = users.filter((user) => {
		if (scope === "启用的用户" && String(user.状态) !== "启用") return false;
		if (scope === "已授权的用户" && effectivePermissionCount(user) === 0) return false;
		if (!keyword.trim()) return true;
		//:用户组 / 角色都是多值,搜索时要摊平成组名 / 角色名逐个匹配
		return [user.账号, user.姓名, user.所属部门, ...groupsOfUser(user), ...rolesOfUser(user)].some((value) =>
			String(value ?? "").includes(keyword.trim()),
		);
	});

	const toggleUser = (id: string, on: boolean) =>
		setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)));
	const toggleAllVisible = () => setSelected((prev) => [...new Set([...prev, ...visible.map((user) => user.id)])]);

	return (
		<Card className="gap-4 hover:border-border hover:shadow-none">
			<CardContent className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[14px] font-medium text-foreground">批量授权</span>
						<Badge variant="secondary"></Badge>
						<span className="text-[12px] text-muted-foreground">
							勾选多个用户 → 一次性设置角色与权限点,应用到所选用户
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button variant="outline" size="sm" onClick={toggleAllVisible}>
							选中当前 {visible.length} 人
						</Button>
						<Button variant="outline" size="sm" disabled={selected.length === 0} onClick={() => setSelected([])}>
							清空选择
						</Button>
						<Button size="sm" disabled={selected.length === 0} onClick={() => onGrant([...selected])}>
							<KeyRound className="size-3.5" />
							批量授权({selected.length})
						</Button>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Input
						value={keyword}
						onChange={(event) => setKeyword(event.target.value)}
						placeholder="搜索账号 / 姓名 / 部门 / 用户组 / 角色…"
						className="h-8 w-72"
					/>
					<SearchSelect
						value={scope}
						onValueChange={setScope}
						options={["全部用户", "启用的用户", "已授权的用户"].map((item) => ({ value: item, label: item }))}
						triggerClassName="h-8"
					/>
					<span className="text-[12px] text-muted-foreground">
						匹配 {visible.length} 人 · 已选 {selected.length} 人
					</span>
				</div>

				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
					{visible.map((user) => {
						const id = user.id;
						const on = selected.includes(id);
						return (
							<div
								key={id}
								className={
									on
										? "flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-2.5 py-1.5"
										: "flex items-center gap-2 rounded-xl border border-border px-2.5 py-1.5"
								}
							>
								<Checkbox
									aria-label={`选择用户 ${user.姓名}`}
									checked={on}
									onCheckedChange={(checked) => toggleUser(id, checked === true)}
								/>
								<div className="min-w-0 flex-1">
									<div className="truncate text-[13px] text-foreground">
										{user.姓名}
										<span className="ml-1 text-[11px] text-muted-foreground">{user.账号}</span>
									</div>
									<div className="truncate text-[11px] text-muted-foreground">
										{user.所属部门} · {joinList(groupsOfUser(user)) || "未分配组"} · 有效权限{" "}
										{effectivePermissionCount(user)} 项
									</div>
								</div>
								<Badge variant="outline" className="hidden text-[10px] lg:inline-flex">
									{roleSummary(user)}
								</Badge>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="单独授权"
									title="单独给该用户授权"
									onClick={() => onGrant([id])}
								>
									<KeyRound className="size-3.5" />
								</Button>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
