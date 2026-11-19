import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, ListChecks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DepartmentUserSelect } from "#/components/modules/shared/department-user-select";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import type { MultiSelectOption } from "#/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";

/** 下发子任务及其筛选、手动分配数据。 */
export function TaskDispatchDialog({
	open,
	onOpenChange,
	taskId,
	reportSchema: rawSchema,
	meId,
	userOptions,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	taskId: string;
	reportSchema: unknown;
	meId: string;
	userOptions: MultiSelectOption[];
}) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const dispatchReportQuery = useQuery(trpc.taskClose.reportGet.queryOptions({ taskId }, { enabled: open }));
	const [dispatchIds, setDispatchIds] = useState<string[]>([]);
	const [dispatchRules, setDispatchRules] = useState<Record<string, { field: string; value: string }>>({});
	const [dispatchModes, setDispatchModes] = useState<Record<string, "filter" | "manual">>({});
	const [dispatchManualRows, setDispatchManualRows] = useState<Record<string, string[]>>({});
	const dispatchMutation = useMutation(
		trpc.taskClose.taskDispatch.mutationOptions({
			onSuccess: async (result) => {
				await Promise.all([
					client.invalidateQueries(trpc.taskClose.taskGet.queryFilter({ id: taskId })),
					client.invalidateQueries(trpc.taskClose.taskChildrenList.queryFilter({ taskId })),
					client.invalidateQueries(trpc.taskClose.taskList.queryFilter()),
					client.invalidateQueries(trpc.taskClose.reportGet.queryFilter({ taskId })),
					client.invalidateQueries(trpc.taskClose.logList.queryFilter({ taskId })),
				]);
				onOpenChange(false);
				setDispatchIds([]);
				setDispatchRules({});
				setDispatchModes({});
				setDispatchManualRows({});
				toast.success(`已下发 ${result.taskIds.length} 个子任务`);
			},
			onError: toastApiError,
		}),
	);

	const reportSchema = rawSchema as {
		kind: "TABLE" | "OBJECT" | "EXCEL";
		fields: Array<{ id: string; label: string; type: string }>;
	} | null;
	const scopeFields =
		reportSchema?.kind === "TABLE"
			? reportSchema.fields.filter((field) => field.type !== "multiselect" && field.type !== "attachment")
			: [];
	const allocationPreviewFields = reportSchema?.kind === "TABLE" ? reportSchema.fields.slice(0, 4) : [];
	const allocationRows = dispatchReportQuery.data?.allocationRows ?? [];
	const alreadyAllocated = new Set(dispatchReportQuery.data?.allocatedRowIds ?? []);
	const manualRowSelections = new Set(Object.values(dispatchManualRows).flat());
	const missingManualSelection = dispatchIds.some(
		(userId) => (dispatchModes[userId] ?? "filter") === "manual" && !(dispatchManualRows[userId]?.length ?? 0),
	);

	const dispatchTasks = () => {
		if (!dispatchIds.length || dispatchMutation.isPending) return;
		const targets = dispatchIds.map((userId) => {
			const mode = dispatchModes[userId] ?? "filter";
			if (mode === "manual") return { userId, mode, rowIds: dispatchManualRows[userId] ?? [] };
			const rule = dispatchRules[userId];
			const field = scopeFields.find((item) => item.id === rule?.field);
			const value = rule?.value?.trim();
			return {
				userId,
				mode,
				...(field && value
					? {
							filter: [
								{
									field: field.id,
									value: field.type === "integer" || field.type === "decimal" ? Number(value) : value,
								},
							],
						}
					: {}),
			};
		});
		dispatchMutation.mutate({ taskId: taskId, targets });
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setDispatchIds([]);
					setDispatchRules({});
					setDispatchModes({});
					setDispatchManualRows({});
				}
			}}
		>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader>
					<DialogTitle>下发子任务</DialogTitle>
					<DialogDescription>
						选择执行人；表格填报可按条件筛选或手动分配数据行。子任务会复制当前任务配置。
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="grid gap-3 py-1">
					<DepartmentUserSelect
						options={userOptions.filter((option) => option.value !== meId)}
						value={dispatchIds}
						onChange={(ids) => {
							setDispatchIds(ids);
							setDispatchRules((current) =>
								Object.fromEntries(Object.entries(current).filter(([id]) => ids.includes(id))),
							);
							setDispatchModes((current) =>
								Object.fromEntries(Object.entries(current).filter(([id]) => ids.includes(id))),
							);
							setDispatchManualRows((current) =>
								Object.fromEntries(Object.entries(current).filter(([id]) => ids.includes(id))),
							);
						}}
					/>
					{reportSchema?.kind === "TABLE" && dispatchIds.length > 0 && (
						<section className="grid gap-2 border-t border-border pt-3">
							<p className="text-xs text-muted-foreground">
								每位执行人可选择筛选或手动分配；已分配的数据行不可重复分配，删除子任务后会释放。
							</p>
							<div className="max-h-[50vh] divide-y divide-border overflow-y-auto">
								{dispatchIds.map((userId) => {
									const person = userOptions.find((option) => option.value === userId);
									const mode = dispatchModes[userId] ?? "filter";
									const rule = dispatchRules[userId] ?? { field: "", value: "" };
									return (
										<div key={userId} className="grid gap-2 py-2">
											<div className="flex min-w-0 items-center justify-between gap-2">
												<span className="truncate text-sm">{person?.label ?? userId}</span>
												<fieldset className="m-0 inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-md border-0 bg-muted/50 p-0.5">
													<legend className="sr-only">{person?.label ?? "执行人"}的数据分配方式</legend>
													<Button
														type="button"
														variant={mode === "filter" ? "secondary" : "ghost"}
														size="icon-sm"
														className="size-7"
														aria-label="按条件筛选"
														title="按条件筛选"
														aria-pressed={mode === "filter"}
														onClick={() => {
															setDispatchModes((current) => ({ ...current, [userId]: "filter" }));
															setDispatchManualRows((current) => ({ ...current, [userId]: [] }));
														}}
													>
														<Filter className="size-3.5" />
													</Button>
													<Button
														type="button"
														variant={mode === "manual" ? "secondary" : "ghost"}
														size="icon-sm"
														className="size-7"
														aria-label="手动选行"
														title="手动选行"
														aria-pressed={mode === "manual"}
														onClick={() => {
															setDispatchModes((current) => ({ ...current, [userId]: "manual" }));
															setDispatchRules((current) => ({ ...current, [userId]: { field: "", value: "" } }));
														}}
													>
														<ListChecks className="size-3.5" />
													</Button>
												</fieldset>
											</div>
											{mode === "filter" ? (
												<div className="flex min-w-0 items-center gap-1.5">
													<Select
														value={rule.field || undefined}
														onValueChange={(field) =>
															setDispatchRules((current) => ({
																...current,
																[userId]: { ...rule, field: field ?? "" },
															}))
														}
													>
														<SelectTrigger className="h-7 min-w-0 flex-1 px-2 text-xs">
															<SelectValue placeholder={scopeFields.length ? "字段" : "无可筛选字段"} />
														</SelectTrigger>
														<SelectContent>
															{scopeFields.map((field) => (
																<SelectItem key={field.id} value={field.id}>
																	{field.label}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<Input
														aria-label={`${person?.label ?? "执行人"}的筛选值`}
														value={rule.value}
														onChange={(event) =>
															setDispatchRules((current) => ({
																...current,
																[userId]: { ...rule, value: event.target.value },
															}))
														}
														placeholder="值"
														className="h-7 w-28 shrink-0 px-2 text-xs"
													/>
												</div>
											) : (
												<div className="grid gap-1 rounded-md border border-border p-2">
													<p className="text-xs text-muted-foreground">
														已选 {dispatchManualRows[userId]?.length ?? 0} 行 · 可分配{" "}
														{Math.max(0, allocationRows.length - alreadyAllocated.size)} 行
													</p>
													{dispatchReportQuery.isPending ? (
														<p className="py-2 text-xs text-muted-foreground">正在加载数据行…</p>
													) : allocationRows.length === 0 ? (
														<p className="py-2 text-xs text-muted-foreground">父任务还没有可分配的数据行。</p>
													) : (
														<div className="max-h-44 overflow-y-auto">
															{allocationRows.map((entry, index) => {
																const selected = dispatchManualRows[userId]?.includes(entry.id) ?? false;
																const usedByOther = manualRowSelections.has(entry.id) && !selected;
																const disabled = alreadyAllocated.has(entry.id) || usedByOther;
																const summary = allocationPreviewFields
																	.slice(0, 4)
																	.map((field) => {
																		const raw = entry.values[field.id];
																		const value = Array.isArray(raw)
																			? raw.join("、")
																			: raw && typeof raw === "object"
																				? JSON.stringify(raw)
																				: String(raw ?? "—");
																		return `${field.label}：${value}`;
																	})
																	.join(" · ");
																return (
																	<div
																		key={entry.id}
																		className="flex min-h-8 items-center gap-2 rounded px-1.5 text-xs hover:bg-muted/40"
																	>
																		<Checkbox
																			aria-label={`第 ${index + 1} 行：${summary || "无可显示字段"}`}
																			checked={selected}
																			disabled={disabled}
																			onCheckedChange={(checked) =>
																				setDispatchManualRows((current) => {
																					const rows = new Set(current[userId] ?? []);
																					if (checked) rows.add(entry.id);
																					else rows.delete(entry.id);
																					return { ...current, [userId]: [...rows] };
																				})
																			}
																		/>
																		<span className="w-8 shrink-0 tabular-nums text-muted-foreground">
																			第 {index + 1} 行
																		</span>
																		<span className="min-w-0 truncate">{summary || "（无可显示字段）"}</span>
																		{alreadyAllocated.has(entry.id) ? (
																			<span className="shrink-0 text-muted-foreground">已分配</span>
																		) : null}
																	</div>
																);
															})}
														</div>
													)}
												</div>
											)}
										</div>
									);
								})}
							</div>
						</section>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={!dispatchIds.length || missingManualSelection || dispatchMutation.isPending}
						onClick={dispatchTasks}
					>
						{dispatchMutation.isPending ? "下发中…" : `下发${dispatchIds.length ? ` ${dispatchIds.length} 个` : ""}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
