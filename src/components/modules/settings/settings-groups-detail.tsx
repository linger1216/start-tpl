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
import { type GroupRow, listOf, PERMISSION_NAME_OF } from "#/mocks/settings";
import type { UserRow } from "./settings-users-table";

/** 权限点 id 列表 → 中文名(显示不了的 id 直接丢弃) */
function permissionNames(ids: readonly string[]): string[] {
	return ids.map((id) => PERMISSION_NAME_OF[id]).filter((name): name is string => Boolean(name));
}

/**
 * 用户组详情(只读弹窗)。
 *
 * 成员名单由编排壳按组内 id 查好传入(表格组件不订阅数据层);
 * 组权限点同样只读展示 —— 要改权限请走行内「成员/授权 → 组授权」。
 */
export function SettingsGroupsDetailDialog({
	open,
	onOpenChange,
	detail,
	members,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: GroupRow | null;
	/** 该组的成员(由编排壳按 `成员ids` 反查用户表得到) */
	members: readonly UserRow[];
}) {
	const permissionIds = detail ? listOf(detail.权限点) : [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>用户组详情</DialogTitle>
					<DialogDescription>只读视图;成员与权限点在「成员/授权」弹窗里维护。</DialogDescription>
				</DialogHeader>

				{detail ? (
					<div className="max-h-[62vh] divide-y divide-border overflow-y-auto">
						<DetailRow label="组名">{detail.组名}</DetailRow>
						<DetailRow label="所属条线">{detail.所属条线}</DetailRow>
						<DetailRow label="状态">
							<Badge variant={detail.状态 === "启用" ? "default" : "secondary"}>{detail.状态}</Badge>
						</DetailRow>
						<DetailRow label="创建时间">{detail.创建时间 || PLACEHOLDER_EMPTY}</DetailRow>
						<DetailRow label="已授权角色">
							<TagBadges tags={listOf(detail.已授权角色)} />
						</DetailRow>
						<DetailRow label="成员数">{members.length} 人</DetailRow>
						<DetailRow label="成员名单">
							{members.length === 0 ? (
								<span className="text-muted-foreground">暂无成员</span>
							) : (
								<TagBadges tags={members.map((user) => `${user.姓名}(${user.账号})`)} />
							)}
						</DetailRow>
						<DetailRow label="已授权权限">
							<span className="mr-1.5 tabular-nums">{permissionIds.length}</span>项
						</DetailRow>
						<DetailRow label="权限点">
							<TagBadges tags={permissionNames(permissionIds)} />
						</DetailRow>
					</div>
				) : (
					<p className="text-[13px] text-muted-foreground">未选择用户组。</p>
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
