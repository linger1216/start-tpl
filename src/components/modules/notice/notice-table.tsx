import { actionsColumn, TextCell } from "#/components/modules/shared/table-kit";
import { Badge } from "#/components/ui/badge";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

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

const LEVEL_LABEL: Record<string, string> = { info: "通知", success: "成功", warn: "提醒", danger: "告警" };

/**
 * 「我的通知」的列定义 —— **只读台账**。
 *
 * 行操作只有「打开」:通知没有编辑 / 删除入口(已读由点开或「全部已读」完成),
 * 没有 `path` 的通知打开不了 —— 那种行的「打开」**禁用**(而不是隐藏,藏了会让人以为没这功能)。
 */
export function noticeColumns({ onOpen }: { onOpen: (row: NoticeRow) => void }) {
	return columnHelper.columns([
		columnHelper.accessor("read", {
			header: "状态",
			size: 90,
			cell: (ctx) => (
				<Badge variant={ctx.getValue() ? "outline" : "secondary"}>{ctx.getValue() ? "已读" : "未读"}</Badge>
			),
		}),
		columnHelper.accessor("level", {
			header: "类型",
			size: 90,
			cell: (ctx) => <Badge variant="outline">{LEVEL_LABEL[ctx.getValue()] ?? ctx.getValue()}</Badge>,
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
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground">{ctx.getValue() ?? "—"}</span>,
		}),
		columnHelper.accessor("createTime", {
			header: "时间",
			size: 150,
			cell: (ctx) => <span className="tabular-nums text-xs">{formatLocalMinute(ctx.getValue())}</span>,
		}),
		actionsColumn<NoticeRow>({
			size: 90,
			onView: onOpen,
			disabled: (row) => !row.path,
		}),
	]);
}
