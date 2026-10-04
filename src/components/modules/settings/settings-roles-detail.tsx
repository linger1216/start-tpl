import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { EnabledBadge } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import type { RoleRow } from "./settings-roles-table";

/**
 * 角色详情(只读)。
 *
 * 字段与 `sys_role` 一一对应 + 一个派生字段「分配给几个用户」。
 * 想看这个人勾了哪些菜单 / 按钮,点底部的「编辑」旁边的「菜单权限」——
 * 详情这里只读角色本身的列,不把授权树塞进来。
 */
export function SettingsRolesDetail({
	row,
	open,
	onOpenChange,
	onEdit,
	onPerms,
}: {
	row: RoleRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: RoleRow) => void;
	onPerms: (row: RoleRow) => void;
}) {
	return (
		<DetailDialog
			open={open}
			meta={{ createdAt: row?.createTime ?? null, updatedAt: row?.updateTime ?? null }}
			onOpenChange={onOpenChange}
			title={`角色详情 · ${row?.name ?? ""}`}
			description={row?.remark || "全局定义的角色 —— 谁有它记在「用户 → 角色」上"}
			badge={row ? <EnabledBadge status={row.status} /> : null}
			onEdit={() => row && onPerms(row)}
			editLabel="菜单权限"
			footerExtra={
				<Button variant="outline" onClick={() => row && onEdit(row)}>
					编辑
				</Button>
			}
		>
			{row ? (
				<div className="flex flex-col gap-0">
					<DetailRow label="ID">
						<span className="font-mono text-xs">{row.id}</span>
					</DetailRow>
					<DetailRow label="角色名">
						<span className="text-sm font-medium">{row.name}</span>
					</DetailRow>
					<DetailRow label="排序">
						<span className="tabular-nums">{row.sort}</span>
					</DetailRow>
					{/* 派生值(不是表里的列):用胶囊形状区分,别和真实字段混成一样 */}
					<DetailRow label="分配用户数">
						<Badge variant="secondary" className="text-xs tabular-nums">
							{row.memberCount} 人
						</Badge>
					</DetailRow>
					<DetailRow label="说明">
						<span className="text-sm">{row.remark || "—"}</span>
					</DetailRow>
				</div>
			) : null}
		</DetailDialog>
	);
}
