import { TagBadges } from "#/components/modules/shared/tag-badges";
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
import {
	effectivePermissionIds,
	groupsOfUser,
	ownPermissionIds,
	PERMISSION_NAME_OF,
	rolesOfUser,
} from "#/mocks/settings";
import type { UserRow } from "./settings-users-table";

/** 权限点 id 列表 → 中文名(显示不了的 id 直接丢弃,不显示乱码) */
function permissionNames(ids: readonly string[]): string[] {
	return ids.map((id) => PERMISSION_NAME_OF[id]).filter((name): name is string => Boolean(name));
}

/**
 * 用户详情(只读弹窗):数据就是列表行,不再单独按 id 查询。
 *
 * 权限部分按 的口径拆开显示 —— 本人直接授权 / 有效权限(含组与角色继承),
 * 让"这个人为什么有这些权限"一眼可查;用户组与角色按 全量列出。
 */
export function SettingsUsersDetailDialog({
	open,
	onOpenChange,
	detail,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: UserRow | null;
}) {
	const own = detail ? ownPermissionIds(detail) : [];
	const effective = detail ? effectivePermissionIds(detail) : [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>用户详情</DialogTitle>
					<DialogDescription>只读视图;权限点为渲染期推导结果(本人 ∪ 用户组 ∪ 角色)。</DialogDescription>
				</DialogHeader>

				{detail ? (
					<div className="max-h-[62vh] divide-y divide-border overflow-y-auto">
						<DetailRow label="账号">{detail.账号}</DetailRow>
						<DetailRow label="姓名">{detail.姓名}</DetailRow>
						<DetailRow label="手机号">{detail.手机号}</DetailRow>
						<DetailRow label="所属部门">{detail.所属部门}</DetailRow>
						<DetailRow label="所属用户组">
							<TagBadges tags={groupsOfUser(detail)} />
						</DetailRow>
						<DetailRow label="角色">
							<TagBadges tags={rolesOfUser(detail)} />
						</DetailRow>
						<DetailRow label="状态">
							<Badge
								variant={detail.状态 === "启用" ? "default" : detail.状态 === "锁定" ? "destructive" : "secondary"}
							>
								{detail.状态}
							</Badge>
						</DetailRow>
						<DetailRow label="最近登录">{detail.最近登录时间 || PLACEHOLDER_EMPTY}</DetailRow>
						<DetailRow label="本人权限">
							<span className="mr-1.5 tabular-nums">{own.length}</span>项
						</DetailRow>
						<DetailRow label="本人权限点">
							<TagBadges tags={permissionNames(own)} />
						</DetailRow>
						<DetailRow label="有效权限">
							<span className="mr-1.5 tabular-nums">{effective.length}</span>项
						</DetailRow>
						<DetailRow label="有效权限点">
							<TagBadges tags={permissionNames(effective)} />
						</DetailRow>
					</div>
				) : (
					<p className="text-[13px] text-muted-foreground">未选择用户。</p>
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
