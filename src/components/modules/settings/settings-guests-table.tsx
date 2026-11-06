import { actionsColumn, timeColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Tag } from "#/components/ui/tag";
import { TagList } from "#/components/ui/tag-list";
import { isShareTokenExpired } from "#/lib/share-token-spec";
import { createAppColumnHelper } from "#/lib/table";

/**
 * 访客令牌台账的一行(tRPC `shareToken.list` 出参)—— 与 `sys_share_token` 的列一一对应
 * (`allowed_paths` 已解析成数组)。`token` 在清单里就带着:行操作「复制链接」要随时拿得到。
 */
export type ShareTokenRow = {
	id: string;
	token: string;
	remark: string;
	allowedPaths: string[];
	expiresAt: string | null;
	enabled: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

/** 三态:启用(在有效期内)/ 停用 / 已过期 —— 表格与详情共用一份折算 */
export function shareTokenStatusOf(row: ShareTokenRow): {
	label: string;
	variant: "secondary" | "outline";
	expired: boolean;
} {
	if (!row.enabled) return { label: "停用", variant: "outline", expired: false };
	if (isShareTokenExpired(row.expiresAt)) return { label: "已过期", variant: "outline", expired: true };
	return { label: "启用", variant: "secondary", expired: false };
}

const columnHelper = createAppColumnHelper<ShareTokenRow>();

/**
 * 访客令牌台账的列定义 —— 版式对齐用户 / 参数的台账页。
 * 「有效期至」空值显「长期有效」;状态是启用 × 有效期折算出的三态,不是表里的裸 `enabled`。
 */
export function shareTokenColumns({
	onCopyLink,
	onToggle,
	onView,
	onEdit,
	onDelete,
}: {
	onCopyLink: (row: ShareTokenRow) => void;
	onToggle: (row: ShareTokenRow) => void;
	onView: (row: ShareTokenRow) => void;
	onEdit: (row: ShareTokenRow) => void;
	onDelete: (row: ShareTokenRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("remark", {
			header: "备注",
			sortFn: "text",
			size: 180,
			cell: (ctx) => <span className="text-sm">{ctx.getValue() || "(无备注)"}</span>,
		}),
		columnHelper.accessor("allowedPaths", {
			header: "允许页面",
			size: 220,
			cell: (ctx) => (
				<TagList values={ctx.getValue()} layout="wrap" color="stable" emptyPlaceholder="未配置(等于看不了任何页面)" />
			),
		}),
		columnHelper.accessor("expiresAt", {
			header: "有效期至",
			size: 130,
			cell: (ctx) => {
				const value = ctx.getValue();
				return (
					<span className="text-xs tabular-nums text-muted-foreground">{value ? value.slice(0, 10) : "长期有效"}</span>
				);
			},
		}),
		columnHelper.accessor("enabled", {
			header: "状态",
			size: 96,
			cell: (ctx) => {
				const status = shareTokenStatusOf(ctx.row.original);
				return (
					<Tag variant={status.variant} className={`text-xs${status.expired ? " text-warn-fg" : ""}`}>
						{status.label}
					</Tag>
				);
			},
		}),
		timeColumn<ShareTokenRow>("createdAt", { header: "创建时间", size: 140 }),
		actionsColumn<ShareTokenRow>({
			// 行操作:复制链接 / 启停(页面特有)+ 详情 / 编辑 / 删除 —— 复制链接在令牌没有
			// 允许页面时置灰(链接拼不出来)
			size: 250,
			extra: (row) => (
				<>
					<ActionButton disabled={row.allowedPaths.length === 0} onClick={() => onCopyLink(row)}>
						复制链接
					</ActionButton>
					<ActionButton onClick={() => onToggle(row)}>{row.enabled ? "停用" : "启用"}</ActionButton>
				</>
			),
			onView,
			onEdit,
			onDelete,
		}),
	]);
}
