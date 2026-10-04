import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Files, HardDrive, Plus, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsFilesDetail } from "#/components/modules/settings/settings-files-detail";
import { SettingsFilesForm } from "#/components/modules/settings/settings-files-form";
import { type FileRow, fileColumns } from "#/components/modules/settings/settings-files-table";
import { SettingsFilesUpload } from "#/components/modules/settings/settings-files-upload";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerCard, SelectionBar } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { formatBytes } from "#/lib/format";
import { matchKeyword, useRowSelection } from "#/lib/table";

/**
 * 系统设置 ▸ 文件管理 —— 文件元数据台账(`sys_file`),字节存 MinIO(见 `doc/文件管理.md`)。
 *
 * 完整 CRUD:**增** = 上传(预签名直传,带进度)、**查** = 台账 + 详情预览、**改** = 重命名展示名、
 * **删** = 批量删除(删对象 + 行置 status=2)。
 *
 * 页面上**不出现任何 URL 字段** —— 直链会过期、换对外域名就全废;要看就在详情里现签一次。
 */
export function SettingsFilesPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [keyword, setKeyword] = useState("");
	const [uploading, setUploading] = useState(false);
	const [editing, setEditing] = useState<FileRow | null>(null);
	const [viewing, setViewing] = useState<FileRow | null>(null);
	/** 待确认删除的行 —— **单条与批量共用同一个确认框**(单条就是长度 1 的数组) */
	const [pendingDelete, setPendingDelete] = useState<FileRow[] | null>(null);

	const canUpload = useHasPerm("sys:file:upload");
	const canEdit = useHasPerm("sys:file:edit");
	const canRemove = useHasPerm("sys:file:remove");

	const listQuery = useQuery({ ...trpc.file.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = (listQuery.data ?? []) as FileRow[];

	/**
	 * 清空行选择的通道。
	 *
	 * 为什么要绕一下:`useRowSelection` 依赖 `filtered`,而 `filtered` 在 mutation **之后**才定义 ——
	 * 直接在 `onSuccess` 里用 `clear` 会踩 TDZ。用 ref 把函数传进来最省事。
	 * 删完必须清空:被删的行**仍在列表里**(状态变成「已删除」),不清的话批量条会一直挂着「已选 N 个」。
	 */
	const clearSelectionRef = useRef<() => void>(() => {});

	const invalidate = async () => {
		await queryClient.invalidateQueries(trpc.file.pathFilter());
	};

	const renameMutation = useMutation(
		trpc.file.rename.mutationOptions({
			onSuccess: async (outcome) => {
				await invalidate();
				setEditing(null);
				toast.success(`已重命名为 ${outcome.originName}`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.file.remove.mutationOptions({
			onSuccess: async (outcome) => {
				await invalidate();
				setPendingDelete(null);
				clearSelectionRef.current();
				toast.success(`已删除 ${outcome.removed} 个文件`, { description: "对象已从桶里清掉,记录保留(状态=已删除)" });
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	const filtered = useMemo(
		() => rows.filter((row) => matchKeyword([row.originName, row.objectKey, row.bucket, row.ext], keyword)),
		[rows, keyword],
	);

	/**
	 * 下载:现签一个**带 `Content-Disposition`** 的地址,再让浏览器自己去取。
	 *
	 * 两个坑都在这儿处理:
	 *  · `staleTime: 0` —— 预签名 5 分钟就过期,TanStack 默认会缓存住旧地址,过期后会 403;
	 *  · 用**临时 `<a>` 点击**而不是 `window.open`:响应头是 `attachment`,浏览器会直接下载、不开新标签页
	 *    (跨域时 `<a download>` 属性会被忽略,所以文件名只能靠服务端那个响应头)。
	 */
	const handleDownload = useCallback(
		async (row: FileRow) => {
			try {
				const { url } = await queryClient.fetchQuery({
					...trpc.file.url.queryOptions({ id: row.id, download: true }),
					staleTime: 0,
				});
				const anchor = document.createElement("a");
				anchor.href = url;
				anchor.rel = "noreferrer";
				anchor.click();
			} catch (error) {
				toast.error(toApiError(error).message);
			}
		},
		[queryClient, trpc],
	);

	// 行选择:与工作台台账示例同一套(选中集随 `filtered` 自动收敛 —— 搜索把某行筛掉时它会被移除,
	// 所以「选了却删不到」不会发生)
	const { selected, selectedRows, toggleOne, toggleMany, clear } = useRowSelection(filtered);

	clearSelectionRef.current = clear;

	const columns = useMemo(
		() =>
			fileColumns({
				selected,
				onToggleOne: toggleOne,
				onToggleMany: toggleMany,
				onView: setViewing,
				onEdit: (row) => setEditing(row),
				onDelete: canRemove ? (row) => setPendingDelete([row]) : () => toast.error("没有删除文件的权限"),
				onDownload: (row) => void handleDownload(row),
			}),
		[canRemove, handleDownload, selected, toggleOne, toggleMany],
	);

	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		prefKey: "settings.files",
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "文件总数",
				value: rows.length,
				description: "含待确认与已删除的记录",
				Icon: Files,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "个",
			},
			{
				key: "ready",
				label: "正常可用",
				value: rows.filter((row) => row.status === 1).length,
				description: "已核对过大小与类型",
				Icon: ShieldCheck,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "个",
			},
			{
				key: "size",
				label: "占用空间",
				value: formatBytes(rows.filter((row) => row.status === 1).reduce((sum, row) => sum + row.size, 0)),
				description: "按对象存储里的真实字节统计",
				Icon: HardDrive,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
			},
		],
		[rows],
	);

	return (
		<PageFrame>
			<PageHeader
				title="文件管理"
				description="系统设置 ▸ 文件管理:文件元数据存库里(sys_file),字节存对象存储(MinIO)。上传是浏览器直传 + 服务端核对,列表里不存 URL —— 要看就在详情里现签一次。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						{canUpload ? (
							<Button size="sm" onClick={() => setUploading(true)}>
								<Plus className="size-3.5" />
								上传文件
							</Button>
						) : null}
					</div>
				}
			/>

			<StatCards items={stats} />

			<LedgerToolbar
				search={keyword}
				onSearchChange={(value) => {
					setKeyword(value);
					table.setPageIndex(0);
				}}
				searchPlaceholder="搜索文件名 / 对象键 / 桶…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<LedgerCard
				title="文件清单"
				Icon={Files}
				count={filtered.length}
				busy={listQuery.isFetching}
				emptyText="还没有文件,点右上角上传一个"
				table={table}
				rowClassName={(row) => (selected.has(row.id) ? "bg-brand-faint" : undefined)}
			>
				{/* 批量操作条:只在选中时出现,长在表格正上方(动作与选择对象挨着) */}
				<SelectionBar count={selected.size} unit="个" names={selectedRows.map((row) => row.originName)}>
					<ActionButton onClick={clear}>清空选择</ActionButton>
					<ActionButton
						tone="danger"
						onClick={() => (canRemove ? setPendingDelete(selectedRows) : toast.error("没有删除文件的权限"))}
					>
						批量删除
					</ActionButton>
				</SelectionBar>
			</LedgerCard>

			<SettingsFilesUpload open={uploading} onOpenChange={setUploading} onDone={() => setUploading(false)} />

			<SettingsFilesForm
				row={editing}
				open={editing !== null}
				pending={renameMutation.isPending}
				onOpenChange={(next) => {
					if (!next) setEditing(null);
				}}
				onSubmit={(name) => editing && renameMutation.mutate({ id: editing.id, name })}
			/>

			<SettingsFilesDetail
				row={viewing}
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
				onEdit={(row) => {
					setViewing(null);
					if (canEdit) setEditing(row);
					else toast.error("没有重命名文件的权限");
				}}
				onDownload={(row) => void handleDownload(row)}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除文件"
				description={
					pendingDelete && pendingDelete.length > 1
						? `确认删除选中的 ${pendingDelete.length} 个文件?对象会从桶里真删掉,记录保留为「已删除」。`
						: `确认删除「${pendingDelete?.[0]?.originName ?? ""}」?对象会从桶里真删掉,记录保留为「已删除」。`
				}
				isPending={deleteMutation.isPending}
				pendingText="删除中…"
				onConfirm={() => pendingDelete && deleteMutation.mutate({ ids: pendingDelete.map((row) => row.id) })}
			/>
		</PageFrame>
	);
}
