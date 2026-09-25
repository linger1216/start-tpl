import { FileText, ImageIcon } from "lucide-react";
import { useState } from "react";
import { actionsColumn, selectColumn, TextCell } from "#/components/modules/shared/table-kit";
import { ActionButton } from "#/components/ui/action-button";
import { Badge } from "#/components/ui/badge";
import { formatBytes } from "#/lib/format";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

/** 与 `trpc.file.list` 的出参一一对应(`sys_file` 的列,一个不少) */
export type FileRow = {
	id: string;
	bucket: string;
	objectKey: string;
	originName: string;
	ext: string | null;
	contentType: string | null;
	size: number;
	hash: string | null;
	status: number;
	/**
	 * **列表缩略图**专用地址:图片且正常状态才有(公开桶给直链、私有桶给短时效预签名 —— 服务端一次签完)。
	 * 非图片 / 待确认 / 已删除一律 null,列表退回类型图标。⚠️ 会过期,前端要能退回图标(见 `Thumb`)。
	 */
	thumbUrl: string | null;
	createTime: string | null;
	updateTime: string | null;
};

const columnHelper = createAppColumnHelper<FileRow>();

/** 状态码 → 徽章文案与语气(与库里的 `status` 三态严格对应) */
const STATUS_META: Record<number, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
	0: { label: "待确认", variant: "outline" },
	1: { label: "正常", variant: "secondary" },
	2: { label: "已删除", variant: "destructive" },
};

const isImage = (row: FileRow) => (row.contentType ?? "").startsWith("image/");

/**
 * 缩略图:图片给真图(服务端已经签好地址了),其余给类型图标。
 *
 * ⚠️ 预签名地址 15 分钟就过期 —— **必须有 `onError` 退回图标**:不然过期的行会显示成破图,
 * 比一开始就不出图更难看。下一次列表刷新拿到的是新地址。
 */
function Thumb({ row }: { row: FileRow }) {
	const [broken, setBroken] = useState(false);
	const box =
		"flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted";
	const image = row.status === 1 && isImage(row) && row.thumbUrl;

	if (image && !broken) {
		return (
			<span className={box}>
				<img
					src={row.thumbUrl ?? ""}
					alt={row.originName}
					loading="lazy"
					className="size-full object-cover"
					onError={() => setBroken(true)}
				/>
			</span>
		);
	}
	return (
		<span className={box}>
			{isImage(row) ? (
				<ImageIcon className="size-4 text-muted-foreground" />
			) : (
				<FileText className="size-4 text-muted-foreground" />
			)}
		</span>
	);
}

/**
 * 文件管理表格的列定义。
 *
 * 列 = `sys_file` 的表结构,**一个不少**(排障时要能看全);挤不挤交给工具条的「列」开关。
 * 只有「预览」是**派生展示列**(它不在表里),所以显式用 `display` 声明,别让人以为是库里的列。
 */
export function fileColumns({
	selected,
	onToggleOne,
	onToggleMany,
	onView,
	onEdit,
	onDelete,
	onDownload,
}: {
	/** 行选择:由页面用 `useRowSelection` 驱动 —— 写法与工作台台账示例**逐字一致** */
	selected: ReadonlySet<string>;
	onToggleOne: (id: string, on: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	onView: (row: FileRow) => void;
	onEdit: (row: FileRow) => void;
	onDelete: (row: FileRow) => void;
	/** 下载 —— 走 `file.url({ download: true })` 现签,文件名由对象存储的响应头决定(见详情页注释) */
	onDownload: (row: FileRow) => void;
}) {
	return columnHelper.columns([
		// 勾选列放第一列(与工作台台账示例、其他台账页同一位置)
		selectColumn<FileRow>({ selected, onToggleOne, onToggleMany }),
		// ⚠️ 派生展示列(表里没有这一列):缩略图 / 图标
		columnHelper.display({
			id: "thumb",
			header: "预览",
			size: 72,
			cell: (ctx) => <Thumb row={ctx.row.original} />,
		}),
		columnHelper.accessor("originName", {
			header: "文件名",
			size: 220,
			cell: (ctx) => (
				<span className="text-[13px] font-medium text-foreground" title={ctx.getValue()}>
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		columnHelper.accessor("ext", {
			header: "后缀",
			size: 80,
			cell: (ctx) => (
				<Badge variant="outline" className="font-mono text-[11px]">
					{ctx.getValue() || "—"}
				</Badge>
			),
		}),
		columnHelper.accessor("contentType", {
			header: "类型",
			size: 160,
			cell: (ctx) => (
				<span className="font-mono text-[11px] text-muted-foreground/70">
					<TextCell value={ctx.getValue()} />
				</span>
			),
		}),
		columnHelper.accessor("size", {
			header: "大小",
			size: 100,
			cell: (ctx) => <span className="text-[12.5px] tabular-nums">{formatBytes(ctx.getValue())}</span>,
		}),
		columnHelper.accessor("status", {
			header: "状态",
			size: 100,
			cell: (ctx) => {
				const meta = STATUS_META[ctx.getValue()] ?? STATUS_META[0];
				return (
					<Badge variant={meta.variant} className="text-[11px]">
						{meta.label}
					</Badge>
				);
			},
		}),
		columnHelper.accessor("bucket", {
			header: "桶",
			size: 140,
			cell: (ctx) => <span className="font-mono text-[11px] text-muted-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("objectKey", {
			header: "对象键",
			size: 260,
			cell: (ctx) => (
				<span className="font-mono text-[11px] text-muted-foreground/70">
					<TextCell value={ctx.getValue()} truncate />
				</span>
			),
		}),
		columnHelper.accessor("hash", {
			header: "sha256",
			size: 160,
			cell: (ctx) => (
				<span className="font-mono text-[11px] text-muted-foreground/70">
					<TextCell value={ctx.getValue()} truncate />
				</span>
			),
		}),
		columnHelper.accessor("createTime", {
			header: "创建时间",
			size: 140,
			cell: (ctx) => (
				<span className="text-[12px] text-muted-foreground tabular-nums">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		columnHelper.accessor("updateTime", {
			header: "更新时间",
			size: 140,
			cell: (ctx) => (
				<span className="text-[12px] text-muted-foreground tabular-nums">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		columnHelper.accessor("id", {
			header: "ID",
			size: 200,
			cell: (ctx) => <span className="font-mono text-[11px] text-muted-foreground/70">{ctx.getValue()}</span>,
		}),
		// 4 个文字按钮(下载 / 详情 / 编辑 / 删除),宽度给足免得换行把行高撑开
		actionsColumn<FileRow>({
			size: 200,
			extra: (row) => <ActionButton onClick={() => onDownload(row)}>下载</ActionButton>,
			onView,
			onEdit,
			onDelete,
		}),
	]);
}
