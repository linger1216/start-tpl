import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Library, ListChecks, Plus, ToggleLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { SettingsDictionaryDetail } from "#/components/modules/settings/settings-dictionary-detail";
import { DICT_EXCEL_COLUMNS, dictExcelRows } from "#/components/modules/settings/settings-dictionary-excel";
import {
	type DictFormValues,
	dictToForm,
	emptyDictForm,
	SettingsDictionaryForm,
} from "#/components/modules/settings/settings-dictionary-form";
import {
	dictionaryColumns,
	type SettingsDictCallbacks,
	type SettingsDictRow,
} from "#/components/modules/settings/settings-dictionary-table";
import { ColumnToggle } from "#/components/modules/shared/column-toggle";
import { ExcelExportButton, ExcelImportButton } from "#/components/modules/shared/excel-actions";
import { LedgerCard } from "#/components/modules/shared/ledger-card";
import { LedgerToolbar } from "#/components/modules/shared/ledger-toolbar";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useLedgerTable } from "#/hooks/use-ledger-table";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError, toastApiError } from "#/lib/api/error";
import { matchKeyword } from "#/lib/table";

/**
 * 系统设置 ▸ 字典管理 —— `sys_dict`(全系统共用字典表)的维护页。
 *
 * 指标 + 搜索 + 表格 + 分页(与全站台账同一套骨架);每行是一个字典,
 * 「编辑字典项」在弹窗里改 `items = [{label, value}]`(顺序就是下拉顺序)。
 *
 * 为什么值得单独一页:档案类型、接入方式、状态码这类固定取值以后都放这张表 ——
 * 页面里改一次,用到它的地方(如治理规则的「写入档案」下拉)立刻跟着变。
 */
export function SettingsDictionaryPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const listQuery = useQuery({ ...trpc.dict.list.queryOptions(), placeholderData: keepPreviousData });
	const rows = useMemo<SettingsDictRow[]>(
		() => (listQuery.data ?? []).map((row) => ({ ...row, items: row.items ?? [] })),
		[listQuery.data],
	);

	const [keyword, setKeyword] = useState("");
	const [form, setForm] = useState<{ editing: SettingsDictRow | null } | null>(null);
	const [values, setValues] = useState<DictFormValues>(emptyDictForm);
	const [formError, setFormError] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<SettingsDictRow | null>(null);
	const [viewing, setViewing] = useState<SettingsDictRow | null>(null);

	/** 写完数据后让列表重新拉一次(⚠️ 调用处必须带括号,漏了就是"await 一个函数引用",什么都不会发生) */
	const invalidate = () => queryClient.invalidateQueries(trpc.dict.pathFilter());

	const createMutation = useMutation(
		trpc.dict.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setForm(null);
				toast.success("已创建字典");
			},
			onError: (error) => setFormError(toApiError(error).message),
		}),
	);
	const updateMutation = useMutation(
		trpc.dict.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setForm(null);
				toast.success("已保存字典");
			},
			onError: (error) => setFormError(toApiError(error).message),
		}),
	);
	const deleteMutation = useMutation(
		trpc.dict.remove.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setPendingDelete(null);
				toast.success("已删除字典");
			},
			onError: (error) => {
				setPendingDelete(null);
				toastApiError(error);
			},
		}),
	);
	// 导入的失败提示由对话框负责(整批错进警告区、逐行错进明细),这里只负责刷列表
	const importMutation = useMutation(
		trpc.dict.import.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
		}),
	);

	/** 关键词过滤:名称 / 编码 / 说明 / 字典项(label 与 value) */
	const filtered = useMemo(
		() =>
			rows.filter((row) =>
				matchKeyword(
					[row.name, row.code, row.remark, ...row.items.flatMap((item) => [item.label, item.value])],
					keyword,
				),
			),
		[rows, keyword],
	);

	const total = filtered.length;
	/** 导出走摊平后的行(一行一个字典项),与导入共用同一组表头 —— 导出的文件能直接回导 */
	const excelRows = useMemo(() => dictExcelRows(filtered), [filtered]);

	const stats: StatItem[] = useMemo(() => {
		const itemCount = rows.reduce((sum, row) => sum + row.items.length, 0);
		const disabled = rows.filter((row) => row.status !== 1).length;
		const empty = rows.filter((row) => row.items.length === 0).length;
		return [
			{
				key: "dicts",
				label: "字典数",
				value: rows.length,
				description: "sys_dict 行数",
				Icon: Library,
				tone: "bg-hue-blue-soft text-hue-blue-fg",
				unit: "个",
			},
			{
				key: "items",
				label: "字典项总数",
				value: itemCount,
				description: "所有字典的 label/value 合计",
				Icon: ListChecks,
				tone: "bg-hue-teal-soft text-hue-teal-fg",
				unit: "项",
			},
			{
				key: "empty",
				label: "空字典",
				value: empty,
				description: "还没有字典项",
				Icon: Plus,
				tone: "bg-hue-amber-soft text-hue-amber-fg",
				unit: "个",
			},
			{
				key: "disabled",
				label: "已停用",
				value: disabled,
				description: "停用后不参与下拉",
				Icon: ToggleLeft,
				tone: "bg-hue-rose-soft text-hue-rose-fg",
				unit: "个",
			},
		];
	}, [rows]);

	const callbacks: SettingsDictCallbacks = useMemo(
		() => ({
			onView: setViewing,
			onEdit: (row) => {
				setFormError(null);
				setValues(dictToForm(row));
				setForm({ editing: row });
			},
			onToggle: async (row) => {
				updateMutation.mutate({
					code: row.code,
					name: row.name,
					remark: row.remark ?? "",
					items: row.items,
					status: row.status !== 1,
				});
			},
			onDelete: setPendingDelete,
		}),
		[updateMutation],
	);

	const busyId = deleteMutation.isPending ? (deleteMutation.variables?.codes?.[0] ?? null) : null;
	const columns = useMemo(() => dictionaryColumns({ callbacks, busyId }), [callbacks, busyId]);
	const { table, persistColumns } = useLedgerTable({
		columns,
		data: filtered,
		prefKey: "settings.dictionary",
	});

	function openCreate() {
		setFormError(null);
		setValues(emptyDictForm());
		setForm({ editing: null });
	}

	function submit() {
		setFormError(null);
		const items = values.items.filter((item) => item.label.trim() || item.value.trim());
		const payload = { name: values.name.trim(), remark: values.remark.trim(), items, status: values.status };
		if (!payload.name) return setFormError("请填写字典名称");
		if (form?.editing) {
			updateMutation.mutate({ ...payload, code: form.editing.code });
			return;
		}
		if (!values.code.trim()) return setFormError("请填写字典编码");
		createMutation.mutate({ ...payload, code: values.code.trim() });
	}

	return (
		<PageFrame>
			<PageHeader
				title="字典管理"
				description="系统设置 ▸ 字典管理:维护全系统共用的字典表 `sys_dict` —— 一个字典一行,字典项是「显示名(label)+ 取值(value)」。档案类型(治理规则的「写入档案」)就存在这里,改完立即生效。"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<RefreshButton busy={listQuery.isFetching} onClick={() => void listQuery.refetch()} />
						<Button size="sm" onClick={openCreate}>
							<Plus className="size-3.5" />
							新增字典
						</Button>
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
				searchPlaceholder="搜索字典名 / 编码 / 字典项…"
				actions={
					<>
						<ColumnToggle table={table} onPersist={persistColumns} />
						<ExcelExportButton columns={DICT_EXCEL_COLUMNS} rows={excelRows} fileName="字典" />
						<ExcelImportButton
							title="导入字典"
							description="一行 = 一个字典项(编码相同的行会归到同一个字典);字典已存在就补进字典项,已有的取值跳过、不覆盖。"
							fields={DICT_EXCEL_COLUMNS}
							fileNamePrefix="字典导入模板"
							onImport={(importRows) => importMutation.mutateAsync({ rows: importRows })}
						/>
					</>
				}
			/>

			<LedgerCard
				title="字典清单"
				Icon={Library}
				count={total}
				busy={listQuery.isFetching}
				emptyText="没有符合条件的字典"
				table={table}
			/>

			<p className="text-xs text-muted-foreground">
				说明:字典项顺序就是下拉里的顺序(编辑弹窗里可上移/下移);停用的字典不参与下拉,但不影响已存在的数据。
				删除字典前会检查有没有功能在用(例:治理规则的「写入档案」在用档案类型字典时会拒绝删除)。
			</p>

			<SettingsDictionaryDetail
				row={viewing}
				open={viewing !== null}
				onOpenChange={(next) => {
					if (!next) setViewing(null);
				}}
				onEdit={(row) => {
					setViewing(null);
					setFormError(null);
					setValues(dictToForm(row));
					setForm({ editing: row });
				}}
			/>

			<SettingsDictionaryForm
				open={form !== null}
				onOpenChange={(next) => {
					if (!next) setForm(null);
				}}
				editing={form?.editing ?? null}
				values={values}
				onChange={setValues}
				pending={createMutation.isPending || updateMutation.isPending}
				error={formError}
				onSubmit={submit}
			/>

			<ConfirmDialog
				open={pendingDelete !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDelete(null);
				}}
				title="删除字典"
				description={`确认删除「${pendingDelete?.name ?? ""}」?删掉后用到它的地方会取不到候选;已经有功能在用它时会被拒绝。`}
				isPending={deleteMutation.isPending}
				onConfirm={() => {
					if (pendingDelete) deleteMutation.mutate({ codes: [pendingDelete.code] });
				}}
			/>
		</PageFrame>
	);
}
