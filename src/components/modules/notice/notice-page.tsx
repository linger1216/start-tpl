import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Bell, CheckCheck, MailOpen, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { NoticeForm, type NoticeFormPayload } from "#/components/modules/notice/notice-form";
import { type NoticeRow, noticeColumns } from "#/components/modules/notice/notice-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { writeSuccess } from "#/hooks/use-ledger-write";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { matchKeyword } from "#/lib/table";

/** 一次最多拉 500 条(接口上限);拉回来在客户端分页 —— 与其它台账页同口径 */
const PAGE_LIMIT = 500;

/**
 * 「我的通知」(根菜单 `/notices`)—— 台账版式,**只读**。
 *
 * 与其它台账页的唯一差别:**没有「新增」也不打算有「删除」**(通知是系统产生的记录;
 * 手动发是**运维动作**,所以只有拿到 `sys:notice:add` 的人才看到那个按钮),
 * 页头的主操作是「全部已读」。
 */
export function NoticePage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [keyword, setKeyword] = useState("");
	const [composing, setComposing] = useState(false);
	const canSend = useHasPerm("sys:notice:add");

	const listQuery = useQuery(trpc.notice.list.queryOptions({ limit: PAGE_LIMIT }));
	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: canSend });

	const invalidate = async () => {
		await queryClient.invalidateQueries(trpc.notice.pathFilter());
	};

	const readMutation = useMutation(trpc.notice.read.mutationOptions({ onSuccess: invalidate }));
	const readAllMutation = useMutation(
		trpc.notice.readAll.mutationOptions({
			onSuccess: async (outcome) => {
				await invalidate();
				if (outcome.updated > 0) toast.success(`已把 ${outcome.updated} 条标为已读`);
			},
		}),
	);
	const createMutation = useMutation(
		trpc.notice.create.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => setComposing(false),
				message: (o) => `已发给 ${o.created} 个人`,
			}),
		}),
	);

	const rows = useMemo<NoticeRow[]>(() => listQuery.data?.items ?? [], [listQuery.data]);
	const unread = listQuery.data?.unread ?? 0;
	const filtered = useMemo(
		() => rows.filter((row) => matchKeyword([row.title, row.body, row.path], keyword)),
		[rows, keyword],
	);

	const userOptions = useMemo(
		() => (usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.name || user.email, hint: user.email })),
		[usersQuery.data],
	);

	const columns = useMemo(
		() =>
			noticeColumns({
				onOpen: (row) => {
					if (!row.read) readMutation.mutate({ id: row.id });
					if (!row.path) return;
					void router.navigate({ to: row.path as never }).catch(() => toast.error("这条通知的跳转地址已失效"));
				},
			}),
		[readMutation, router],
	);

	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		getRowId: (row) => row.id,
		prefKey: "notices",
	});

	const stats: StatItem[] = useMemo(
		() => [
			{
				key: "total",
				label: "全部通知",
				value: rows.length,
				description: `最多取最近 ${PAGE_LIMIT} 条`,
				Icon: Bell,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "条",
			},
			{
				key: "unread",
				label: "未读",
				value: unread,
				description: "点开或「全部已读」都会清掉",
				Icon: MailOpen,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "条",
			},
			{
				key: "read",
				label: "已读",
				value: rows.filter((row) => row.read).length,
				description: "",
				Icon: CheckCheck,
				tone: "bg-secondary text-foreground",
				unit: "条",
			},
		],
		[rows, unread],
	);

	return (
		<PageFrame>
			<PageHeader
				title="我的通知"
				description="站内通知:一条只属于一个收件人,所以已读就是你自己的事。点「打开」会先标已读、再跳到它指的页面;没有跳转路径的通知打开不了(按钮是灰的)。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						<Button
							variant="outline"
							size="sm"
							disabled={unread === 0 || readAllMutation.isPending}
							onClick={() => readAllMutation.mutate()}
						>
							<CheckCheck className="size-3.5" />
							全部已读
						</Button>
						{canSend ? (
							<Button size="sm" onClick={() => setComposing(true)}>
								<Plus className="size-3.5" />
								发通知
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
				searchPlaceholder="搜索标题 / 正文 / 跳转路径…"
				actions={<ColumnToggle table={table} onPersist={persistColumns} />}
			/>

			<LedgerCard
				title="通知清单"
				Icon={Bell}
				count={filtered.length}
				busy={listQuery.isFetching}
				emptyText="还没有通知"
				table={table}
			/>

			<NoticeForm
				open={composing}
				onOpenChange={setComposing}
				pending={createMutation.isPending}
				userOptions={userOptions}
				onSubmit={(payload: NoticeFormPayload) => createMutation.mutate(payload)}
			/>
		</PageFrame>
	);
}
