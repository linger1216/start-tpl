import type { ShareTokenRow } from "#/components/modules/settings/guests/table";
import { shareTokenStatusOf } from "#/components/modules/settings/guests/table";
import { DetailDialog } from "#/components/modules/shared/detail-dialog";
import { DetailRow } from "#/components/ui/detail-row";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";
import { formatLocalDate } from "#/lib/time";

/**
 * 访客令牌详情(只读)。字段与 `ShareTokenRow` 的列一一对应;
 * 令牌本体只显示不说明 —— 「复制链接」动作在台账行上(详情里再看一遍 token 是给人核对的)。
 * 点「编辑」交给页面跳到 `SettingsGuestsForm`。
 */
export function SettingsGuestsDetail({
	row,
	open,
	onOpenChange,
	onEdit,
}: {
	row: ShareTokenRow | null;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onEdit: (row: ShareTokenRow) => void;
}) {
	const status = row ? shareTokenStatusOf(row) : null;
	return (
		<DetailDialog
			open={open}
			onOpenChange={onOpenChange}
			title={`访客令牌 · ${row?.remark || "(无备注)"}`}
			description="持有链接的人可在允许页面上免登只读查看;写操作一律拒绝。"
			tag={
				status ? (
					<Tag variant={status.variant} className={`text-xs${status.expired ? " text-warn-fg" : ""}`}>
						{status.label}
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
					<DetailRow label="备注">
						<span className="text-sm font-medium">{row.remark || "(无备注)"}</span>
					</DetailRow>
					<DetailRow label="令牌">
						<span className="font-mono text-xs break-all">{row.token}</span>
					</DetailRow>
					<DetailRow label="允许页面">
						<TagList
							values={row.allowedPaths}
							layout="wrap"
							color="stable"
							emptyPlaceholder="未配置(等于看不了任何页面)"
						/>
					</DetailRow>
					<DetailRow label="有效期至">{formatLocalDate(row.expiresAt) || "长期有效"}</DetailRow>
				</div>
			) : null}
		</DetailDialog>
	);
}
