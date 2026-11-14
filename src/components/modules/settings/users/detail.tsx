import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";

import type { UserRow } from "./settings-users-table";

/**
 * 用户详情(只读)。
 *
 * 字段与 `UserRow` 的列一一对应:`name` / `email` / `emailVerified` / `image` + 三个派生
 * (`departmentNames` / `roleNames` / `image`)。点「编辑」交给页面跳到 `SettingsUsersForm`。
 */
export function SettingsUsersDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: UserRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: UserRow) => void;
}) {
	return (
		<DetailDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`用户详情 · ${row?.name ?? ""}`}
			description={row?.email ?? ""}
			tag={
				row ? (
					<Tag variant={row.emailVerified ? "secondary" : "outline"} className="text-xs">
						{row.emailVerified ? "邮箱已验证" : "邮箱未验证"}
					</Tag>
				) : null
			}
			meta={row ? { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt } : null}
			onEdit={() => row && onEdit(row)}
		>
			{row ? (
				<div className="flex flex-col gap-0">
					<DetailRow label="ID">
						<span className="font-mono text-xs">{row.id}</span>
					</DetailRow>
					<DetailRow label="姓名">
						<span className="text-sm font-medium">{row.name}</span>
					</DetailRow>
					<DetailRow label="邮箱">{row.email}</DetailRow>
					<DetailRow label="邮箱已验证">{row.emailVerified ? "是" : "否"}</DetailRow>
					<DetailRow label="头像">
						<div className="flex items-center gap-2">
							<Avatar className="size-8">
								{row.image ? <AvatarImage src={row.image} alt={row.name} /> : null}
								<AvatarFallback className="text-xs">{(row.name || "?").slice(0, 1)}</AvatarFallback>
							</Avatar>
						</div>
					</DetailRow>
					<DetailRow label="部门">
						<TagList values={row.departmentNames} layout="wrap" color="stable" emptyPlaceholder="未加入部门" />
					</DetailRow>
					<DetailRow label="角色">
						<TagList values={row.roleNames} layout="wrap" color="stable" emptyPlaceholder="未分配(看不到任何菜单)" />
					</DetailRow>
				</div>
			) : null}
		</DetailDialog>
	);
}
