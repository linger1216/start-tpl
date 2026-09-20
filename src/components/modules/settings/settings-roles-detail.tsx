import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { countUsersWithRole, listOf, PERMISSION_NAME_OF, type RoleRow, rolesOfUser } from "#/mocks/settings";
import type { UserRow } from "./settings-users-table";

/** 权限点 id 列表 → 中文名(显示不了的 id 直接丢弃) */
function permissionNames(ids: readonly string[]): string[] {
	return ids.map((id) => PERMISSION_NAME_OF[id]).filter((name): name is string => Boolean(name));
}

/**
 * 角色详情(只读弹窗)。
 *
 * 权限点数与关联用户数都按 的口径**实时推导**(不读落库计数):
 * 关联用户数按用户表的多角色数组匹配,一个用户持 N 个角色就在 N 个角色里各计一次。
 */
export function SettingsRolesDetailDialog({
	open,
	onOpenChange,
	detail,
	users,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: RoleRow | null;
	/** 全部用户(用于列出该角色下的用户,由编排壳注入) */
	users: readonly UserRow[];
}) {
	const members = detail ? users.filter((user) => rolesOfUser(user).includes(detail.角色名)) : [];
	const permissionIds = detail ? listOf(detail.权限点) : [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>角色详情</DialogTitle>
					<DialogDescription>只读视图;权限点在行内「配置权限」弹窗里维护。</DialogDescription>
				</DialogHeader>

				{detail ? (
					<div className="max-h-[62vh] divide-y divide-border overflow-y-auto">
						<DetailRow label="角色名">{detail.角色名}</DetailRow>
						<DetailRow label="角色编码">{detail.角色编码}</DetailRow>
						<DetailRow label="数据范围">{detail.数据范围}</DetailRow>
						<DetailRow label="状态">
							<Badge variant={detail.状态 === "启用" ? "default" : "secondary"}>{detail.状态}</Badge>
						</DetailRow>
						<DetailRow label="创建时间">{detail.创建时间 || PLACEHOLDER_EMPTY}</DetailRow>
						<DetailRow label="备注">{detail.备注 || PLACEHOLDER_EMPTY}</DetailRow>
						<DetailRow label="关联用户数">{countUsersWithRole(detail.角色名)} 人</DetailRow>
						<DetailRow label="该角色下的用户">
							{members.length === 0 ? (
								<span className="text-muted-foreground">暂无用户使用该角色</span>
							) : (
								<div className="flex flex-wrap gap-1.5">
									{members.map((user) => (
										<Badge key={user.id} variant="secondary">
											{user.姓名} · {user.所属部门}
										</Badge>
									))}
								</div>
							)}
						</DetailRow>
						<DetailRow label="权限点数">
							<span className="tabular-nums">{permissionIds.length}</span> 项
						</DetailRow>
						<DetailRow label="权限点">
							{permissionIds.length === 0 ? (
								<span className="text-muted-foreground">尚未配置权限</span>
							) : (
								<div className="flex flex-wrap gap-1">
									{permissionNames(permissionIds).map((name) => (
										<Badge key={name} variant="outline" className="font-normal">
											{name}
										</Badge>
									))}
								</div>
							)}
						</DetailRow>
					</div>
				) : (
					<p className="text-[13px] text-muted-foreground">未选择角色。</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
