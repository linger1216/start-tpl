import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type DataScopeRow, ruleShapeText } from "#/components/modules/settings/settings-data-scope-table";
import { Badge } from "#/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/**
 * 一行规则的「预览」弹窗 —— **这条规则上线之后,当前身份在这张表上能看见哪些行**。
 *
 * 为什么要有它(而不是让配规则的人猜):数据权限改的是"别人能看见哪些行",配错的方向恰好是
 * **多看见**;而值域是弱类型,一条写错的规则在真跑之前看不出任何异常。所以每条规则旁边都留一个
 * 只读的试算口。
 *
 * **版面按"先看数据、再看依据"排**(数据是主区、占满剩余高度):
 *  1. 结论带 —— 可见几行 / 共几行、这条规则让行数怎么变、贴几行;
 *  2. 判断依据 —— 规则长什么样(判据)、按谁算、以及**引擎真跑的两条 SQL**(`?` 占位 + 参数);
 *  3. **真实数据** —— `select *` 出来的真行(主区,表头粘住、可横竖滚动);
 *     一行都没放行时,这一块整块换成"**断在哪一步**"的原因清单,不留一句"没有数据"让人猜。
 *
 * 等效条件与上下文卡片**不放这儿**(m23422):判断依据那一格已经把"按谁算"说完了,
 * 多一块等于把同一件事说两遍。
 *
 * 数据全部来自 `dataScope.trial`(与规则表单共用同一个编译路径,所以这里看到的就是引擎会执行的):
 *  · 基线 = 按库里**当前上线**的规则算(不带 `ruleId`);
 *  · 试算 = 把**这一条**当成上线规则一起算(带 `ruleId`),也就是"点「上线」之后的样子"。
 * 两个数并排给出来,差额就是这条规则的作用 —— 已经把这条上线的规则再点一次也是安全的
 * (引擎按 id 去重)。
 *
 * 换人试算不在这个弹窗里:它只回答"这条规则本身对不对",要看别的身份就用系统的「切换身份」。
 */
const SAMPLE_LIMIT_ITEMS = [
	{ value: "5", label: "5 行" },
	{ value: "10", label: "10 行" },
	{ value: "20", label: "20 行" },
];

/** 规则的结局(与 `src/lib/data-scope.ts` 的 `RuleBreakdown.effect` 一一对应) */
type RuleEffect = "all" | "filter" | "empty" | "skipped" | "not-matched";

const EFFECT_META: Record<RuleEffect, { label: string; tone: string }> = {
	all: { label: "整类可见", tone: "bg-hue-teal-soft text-hue-teal-fg" },
	filter: { label: "按值筛行", tone: "bg-hue-blue-soft text-hue-blue-fg" },
	empty: { label: "取不到值 ⇒ 一行看不到", tone: "bg-hue-rose-soft text-hue-rose-fg" },
	skipped: { label: "插件不可用 ⇒ 一行看不到", tone: "bg-hue-amber-soft text-hue-amber-fg" },
	"not-matched": { label: "与这个人无关", tone: "bg-muted text-muted-foreground" },
};

function cellText(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "boolean") return value ? "是" : "否";
	return String(value);
}

/** 参数在 SQL 里长什么样:`?` 那一格真值是多少,摊开写 */
function paramText(value: string | number | boolean | null): string {
	if (value === null) return "NULL";
	if (typeof value === "string") {
		const shown = value.length > 48 ? `${value.slice(0, 48)}…` : value;
		return `'${shown}'`;
	}
	return String(value);
}

/** 一条规则的账里这一屏真正用到的几格(结构子集,免得把整份返回类型抄一遍) */
type RuleAccount = {
	subject: string;
	effect: RuleEffect;
	detail: string;
	values: string[] | null;
};

type EmptyReasonArgs = {
	/** 引擎回的试算结果里这一屏只读两个字段(结构子集,类型仍由 router 推出来) */
	data: { total: number; warning?: string };
	/** 这一条规则自己的账(没传 `ruleId` 时为 `undefined`) */
	mine?: RuleAccount;
	visible: number;
	sampled: number;
	resourceLabel: string;
	column: string | null;
};

/**
 * 「一行都没显示」到底断在哪一步 —— **全部来自引擎回的账,不猜**。
 *
 * 顺序就是引擎的顺序:表本身有没有数据 → 主体认不认这个人 → 插件给不给得出值 → 值对不对得上行 →
 * 样张取不取得到。一句话都不该是"可能"。
 */
function emptyReasons({ data, mine, visible, sampled, resourceLabel, column }: EmptyReasonArgs): string[] {
	const reasons: string[] = [];
	if (data.total === 0) {
		reasons.push(`${resourceLabel} 这张表本身一行数据都没有 —— 不是权限挡的。`);
	} else if (visible === 0) {
		if (mine?.effect === "not-matched") {
			reasons.push(`主体「${mine.subject}」不含当前这个人 ⇒ 这条规则对 TA 不起作用,更不会让他多看行。`);
		} else if (mine?.effect === "empty") {
			reasons.push("值域插件这次一个值都没取到(这个人没有角色 / 部门?)⇒ 这条规则把范围收成 0 行(失败关闭)。");
		} else if (mine?.effect === "skipped") {
			reasons.push("规则里的列名或插件取不到 ⇒ 这条规则被当成不存在(不是放行);能筛行的规则一条都不剩,于是一行看不到。");
		} else if (mine?.effect === "filter") {
			const got = mine.values?.length ?? 0;
			reasons.push(
				`值取到了 ${got} 个,但这张表没有一行的「${column ?? "判据列"}」命中这些值 ⇒ 0 行。` +
					"值域配错列(比如拿镇名去配行政区号)就是这种症状。",
			);
		} else {
			reasons.push("库里已上线的规则没有一条命中这个人 ⇒ 失败关闭:一行也看不到。");
		}
	}
	// 可见行数与样张不一致:计数过了、取样挂了(表锁 / 权限 / 超时),两件事要分开说
	if (sampled === 0 && visible > 0) {
		reasons.push(data.warning ?? `能看到 ${visible} 行,但样张这次没取出来。`);
	}
	if (reasons.length === 0) {
		reasons.push(data.warning ?? "这次没有取到行 —— 上面「依据」里的 SQL 与规则账能看出断在哪一步。");
	}
	return reasons;
}

export function SettingsDataScopePreviewDialog({
	row,
	open,
	onOpenChange,
}: {
	/** 要预览的那条规则(`null` = 没开) */
	row: DataScopeRow | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const [sampleLimit, setSampleLimit] = useState("10");

	const resource = row?.resource ?? "";
	const ruleId = row?.id ?? "";
	const limit = Number(sampleLimit) || 10;
	const ready = open && resource !== "";

	/** 现在(只按库里已上线的规则) */
	const baselineQuery = useQuery({
		...trpc.dataScope.trial.queryOptions({ resource, sampleLimit: limit }),
		enabled: ready,
		placeholderData: keepPreviousData,
	});

	/** 试算:把这一条一起算进去 —— 也就是「点上线之后」 */
	const afterQuery = useQuery({
		...trpc.dataScope.trial.queryOptions({ resource, ruleId, sampleLimit: limit }),
		enabled: ready && ruleId !== "",
		placeholderData: keepPreviousData,
	});

	const baseline = baselineQuery.data;
	const after = afterQuery.data;
	const data = after ?? baseline;
	const error = (afterQuery.error ?? baselineQuery.error) as unknown;
	const rows = (data?.rows ?? []) as Array<Record<string, unknown>>;
	const rowColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
	// 只读样张,同样避免下标 key
	const rowKeys = useStableKeys(rows.length, "scope-preview-row");
	/** 这一条规则自己算出来的账(别的规则的账不在这儿摊,那是台账的角度) */
	const mine = (after?.rules ?? []).find((rule) => rule.id === ruleId) as RuleAccount | undefined;
	const effect = mine ? (EFFECT_META[mine.effect] ?? EFFECT_META["not-matched"]) : null;
	const visible = after?.visible ?? baseline?.visible ?? 0;
	const nowRows = baseline?.visible;
	/** 这条规则让可见行数变了多少(两个数都在才算) */
	const delta = nowRows !== undefined && after ? after.visible - nowRows : undefined;
	const sql = data?.sql;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>
						预览 · {row?.subjectLabel ?? ""} · {row?.resourceLabel ?? resource}
					</DialogTitle>
					<DialogDescription>
						把这条规则当成已上线,拿真实数据算一遍 —— 下面就是引擎真正放行的行;一行都没放行时,直接写清断在哪一步。
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-destructive">
						算不出来:{error instanceof Error ? error.message : toApiError(error).message}
					</div>
				) : !data ? (
					<div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">正在算…</div>
				) : (
					<div className="flex max-h-[78vh] flex-col gap-3 overflow-y-auto pr-1">
						{/* ① 结论带:一行看完整张表的结论 */}
						<div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
							<div className="flex items-baseline gap-2">
								<span className="text-2xl font-semibold tabular-nums text-foreground">{visible}</span>
								<span className="text-xs text-muted-foreground">/ {data.total} 行可见</span>
							</div>
							<div className="text-xs text-muted-foreground">
								现在 <span className="font-semibold tabular-nums text-foreground">{nowRows ?? "—"}</span> 行{" → "}
								上线后 <span className="font-semibold tabular-nums text-foreground">{after?.visible ?? "—"}</span> 行
								{delta !== undefined && delta !== 0 ? (
									<span className={delta > 0 ? "text-hue-teal-fg" : "text-hue-amber-fg"}>
										(这条规则{delta > 0 ? "多放行" : "少放行"} {Math.abs(delta)} 行)
									</span>
								) : null}
							</div>
							<div className="ms-auto flex items-center gap-2">
								<span className="text-xs text-muted-foreground">贴几行</span>
								<Select
									items={SAMPLE_LIMIT_ITEMS}
									value={sampleLimit}
									onValueChange={(next) => setSampleLimit(next ?? "10")}
								>
									<SelectTrigger size="sm" className="w-24">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{SAMPLE_LIMIT_ITEMS.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* ② 判断依据:规则长什么样 + 按谁算 + 引擎真跑的 SQL */}
						<div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-2">
							<div className="flex min-w-0 flex-col gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">数据判断依据</span>
								<span translate="no" className="font-mono text-xs break-all text-foreground">
									{row ? ruleShapeText(row) : "—"}
								</span>
								<span className="text-xs text-muted-foreground">
									按 <span className="text-foreground">{data.userName}</span>
									{data.isMe ? "(我本人)" : "(换人试算)"}算 · 角色 {data.roles?.join("、") || "无"} · 部门链{" "}
									{data.ancestors?.map((dept) => dept.name).join(" → ") || "无"}
								</span>
								{mine && effect ? (
									<div className="mt-1 flex flex-wrap items-center gap-2">
										<Badge className={`text-[10px] ${effect.tone}`}>{effect.label}</Badge>
										<span className="text-xs text-foreground">{mine.detail}</span>
									</div>
								) : null}
								{mine?.values && mine.values.length > 0 ? (
									<p translate="no" className="font-mono text-[11px] break-all text-muted-foreground">
										值:{mine.values.slice(0, 6).join(", ")}
										{mine.values.length > 6 ? ` …(共 ${mine.values.length} 个)` : ""}
									</p>
								) : null}
							</div>
							<div className="flex min-w-0 flex-col gap-1.5">
								<span className="text-xs font-medium text-muted-foreground">SQL(引擎真跑的)</span>
								{sql ? (
									<>
										<pre
											translate="no"
											className="max-h-32 overflow-auto rounded-lg border border-border bg-muted p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground"
										>
											{`-- 数出「能看到几行」\n${sql.count.text}\n-- 参数\n${sql.count.params.map((value, index) => `?${index + 1} = ${paramText(value)}`).join("\n") || "(无)\n"}\n\n-- 贴出这些行\n${sql.rows.text}\n-- 参数\n${sql.rows.params.map((value, index) => `?${index + 1} = ${paramText(value)}`).join("\n") || "(无)"}`}
										</pre>
										<span className="text-[11px] text-muted-foreground">
											表名与列名拼在语句里(过 isSafeIdent 白名单),值一律走 ? 参数。
										</span>
									</>
								) : (
									<span className="text-xs text-muted-foreground">
										这次没取到 SQL 文本(达梦那条线上可能渲染不出来)。
									</span>
								)}
							</div>
						</div>

						{/* ③ 主体:真实数据(取不到就整块换成原因) */}
						<div className="flex min-h-56 flex-col gap-2">
							<div className="flex items-center justify-between gap-3">
								<span className="text-sm font-medium text-foreground">
									引擎放行的真实数据{rows.length > 0 ? `(贴了 ${rows.length} 行)` : ""}
								</span>
								<span className="text-xs text-muted-foreground">
									可见 {visible} 行 · 这张表共 {data.total} 行 · 只读
								</span>
							</div>
							{rows.length > 0 ? (
								<div className="max-h-[42vh] overflow-auto rounded-lg border border-border">
									<Table className="text-xs">
										<TableHeader>
											<TableRow>
												{rowColumns.map((column) => (
													<TableHead
														key={column}
														className="h-8 bg-muted/60 px-2 font-mono text-[11px] text-muted-foreground"
													>
														{column}
													</TableHead>
												))}
											</TableRow>
										</TableHeader>
										<TableBody>
											{rows.map((item, index) => (
												<TableRow key={rowKeys[index]}>
													{rowColumns.map((column) => (
														<TableCell
															key={column}
															className="max-w-[18rem] truncate px-2 py-1.5 text-xs text-foreground"
														>
															{cellText(item[column])}
														</TableCell>
													))}
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							) : (
								<div className="flex flex-1 flex-col gap-1.5 rounded-lg border border-hue-amber-fg bg-hue-amber-soft px-3 py-2.5">
									<span className="text-sm font-medium text-hue-amber-fg">一行都没有显示 —— 原因:</span>
									<ul className="list-disc space-y-1 pl-5 text-xs text-hue-amber-fg">
										{emptyReasons({
											data,
											mine,
											visible,
											sampled: rows.length,
											resourceLabel: row?.resourceLabel ?? resource,
											column: row?.column ?? null,
										}).map((reason) => (
											<li key={reason}>{reason}</li>
										))}
									</ul>
									<span className="text-[11px] text-hue-amber-fg">
										改完再点一次「预览」重算;数字对了,回台账点这一行的「上线」。
									</span>
								</div>
							)}
						</div>

						{/* 主体命中但仍有别的注意事项(比如没取到样张)时补一句;0 行那一块已经把原因列全了 */}
						{rows.length > 0 && data.warning ? <p className="text-xs text-hue-amber-fg">⚠ {data.warning}</p> : null}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
