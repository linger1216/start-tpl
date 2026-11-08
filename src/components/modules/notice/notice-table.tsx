import { actionsColumn, TextCell, timeColumn } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Tag } from "#/components/ui/tag";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { NOTICE_LEVEL_SHORT_LABEL } from "#/lib/notice-levels";
import { createAppColumnHelper } from "#/lib/table";

/** 与 `trpc.notice.list` 的出参一一对应 */
export type NoticeRow = {
	id: string;
	title: string;
	body: string | null;
	path: string | null;
	level: string;
	read: boolean;
	createTime: string | null;
};

const columnHelper = createAppColumnHelper<NoticeRow>();

/**
 * 「我的通知」的列定义 —— **只读台账**。
 *
 * 行操作只有「打开」:通知没有编辑 / 删除入口(已读由点开或「全部已读」完成),
 * 没有 `path` 的通知打开不了 —— 那种行的「打开」**禁用**(而不是隐藏,藏了会让人以为没这功能)。
 */
export function noticeColumns({
	onOpen,
	onDetail,
}: {
	onOpen: (row: NoticeRow) => void;
	onDetail: (row: NoticeRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("read", {
			header: "状态",
			size: 90,
			cell: (ctx) => <Tag variant={ctx.getValue() ? "outline" : "secondary"}>{ctx.getValue() ? "已读" : "未读"}</Tag>,
		}),
		columnHelper.accessor("level", {
			header: "类型",
			size: 90,
			cell: (ctx) => <Tag variant="outline">{NOTICE_LEVEL_SHORT_LABEL[ctx.getValue()] ?? ctx.getValue()}</Tag>,
		}),
		columnHelper.accessor("title", {
			header: "标题",
			size: 240,
			cell: (ctx) => (
				<span
					className={ctx.row.original.read ? "text-xs text-muted-foreground" : "text-xs font-medium text-foreground"}
				>
					{ctx.getValue()}
				</span>
			),
		}),
		columnHelper.accessor("body", {
			header: "正文",
			size: 280,
			cell: (ctx) => <TextCell value={ctx.getValue()} />,
		}),
		columnHelper.accessor("path", {
			header: "跳转路径",
			size: 180,
			cell: (ctx) => (
				<span className="font-mono text-xs text-muted-foreground">{ctx.getValue() ?? PLACEHOLDER_EMPTY}</span>
			),
		}),
		timeColumn<NoticeRow>("createTime", { header: "时间" }),
		actionsColumn<NoticeRow>({
			size: 140,
			extra: (row) => <ActionButton onClick={() => onDetail(row)}>详情</ActionButton>,
			onView: onOpen,
			viewLabel: "打开",
			viewDisabled: (row) => !row.path,
		}),
	]);
}
