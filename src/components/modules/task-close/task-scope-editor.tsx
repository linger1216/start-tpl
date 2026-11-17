import { X } from "lucide-react";
import { useState } from "react";
import { ActionButton, ActionIconButton } from "#/components/ui/action-button";
import { Avatar } from "#/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { isRecord } from "#/lib/task/json";
import { cn } from "#/lib/utils";

/** 一条数据范围规则 = `字段 = 值`(值用 JSON 串存,原样透传给接口) */
type ScopeRule = { field: string; value: string };
type Row = Record<string, unknown>;
type FieldOption = { id: string; label: string };
/** 规则挂在谁身上:选了执行人 = 每人一条;没选 = 任务本身(`key = ""`) */
type ScopeTarget = { key: string; label: string };

/**
 * 「带数下发」的数据范围编辑器(仅表格模板)。
 *
 * 导入 Excel 底表后,为每位执行人各划一条 `字段 = 值` 的等值范围。范围**可以重叠**:
 * 父任务读时组合,同一行最多出现两次,不会互相覆盖。未配范围的人默认拿到全部行。
 */
export function TaskScopeEditor({
	rows,
	fields,
	targets,
	rules,
	onChange,
}: {
	rows: Row[];
	fields: FieldOption[];
	targets: ScopeTarget[];
	rules: Record<string, ScopeRule>;
	onChange: (next: Record<string, ScopeRule>) => void;
}) {
	/** 展开的是哪张卡片(`key`) */
	const [openKey, setOpenKey] = useState<string | null>(null);

	/** 一行数据里某字段出现过的值(下拉候选) */
	const valuesOf = (field: string) => {
		const seen = new Map<string, unknown>();
		for (const row of rows) {
			const value = isRecord(row) ? row[field] : null;
			const key = JSON.stringify(value ?? null);
			if (!seen.has(key)) seen.set(key, value ?? null);
		}
		return [...seen.entries()].map(([key, value]) => ({ value: key, label: String(value ?? "空") }));
	};
	/** 一条规则命中的行数(空规则 = 全部行) */
	const matchedOf = (rule?: ScopeRule) => {
		if (!rule?.field || !rule.value) return rows.length;
		const target = JSON.parse(rule.value);
		return rows.filter((row) => (row[rule.field] ?? null) === target).length;
	};
	/** 卡片上那句「字段 = 值」 */
	const summaryOf = (rule?: ScopeRule) => {
		if (!rule?.field) return "全部数据";
		const fieldLabel = fields.find((field) => field.id === rule.field)?.label ?? rule.field;
		if (!rule.value) return `${fieldLabel} = 未选值`;
		return `${fieldLabel} = ${String(JSON.parse(rule.value) ?? "空")}`;
	};
	const setRule = (key: string, next: ScopeRule) => onChange({ ...rules, [key]: next });
	const clearRule = (key: string) => {
		const next = { ...rules };
		delete next[key];
		onChange(next);
		setOpenKey(null);
	};

	return (
		<div className="space-y-2.5">
			{rows.length > 0 ? (
				<div className="flex items-center gap-2 rounded-md border border-hue-blue-line bg-hue-blue-soft px-3 py-2">
					<span className="text-xs font-medium text-hue-blue-fg">已导入</span>
					<span className="text-sm font-semibold text-hue-blue-fg tabular-nums">{rows.length}</span>
					<span className="text-xs text-hue-blue-fg">行 · 列顺序见「ⓘ」</span>
				</div>
			) : (
				<p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
					还没有数据。用「文件导入」选一份 Excel,或用「下载模版」先填。
				</p>
			)}
			{rows.length > 0 && fields.length > 0 ? (
				<div className="space-y-2">
					<p className="text-xs font-medium tracking-wider text-muted-foreground">数据范围 · 按执行人</p>
					<div className="space-y-2">
						{targets.map((target) => {
							const rule = rules[target.key];
							const values = rule?.field ? valuesOf(rule.field) : [];
							const opened = openKey === target.key;
							const hit = matchedOf(rule);
							return (
								<article
									key={target.key || "self"}
									className={cn(
										"overflow-hidden rounded-md border transition-colors",
										opened ? "border-hue-blue-line" : "border-border",
									)}
								>
									<div className="flex items-center gap-2.5 px-3 py-2">
										{/* 点色圆头像:形态与颜色都走 `ui/avatar`(名字 hash 落桶,同人同色) */}
										<Avatar name={target.label} size="sm" aria-hidden />
										<span
											className="min-w-0 max-w-28 shrink-0 truncate text-sm font-medium text-foreground"
											title={target.label}
										>
											{target.label}
										</span>
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-xs",
												rule?.field ? "text-foreground" : "text-muted-foreground",
											)}
										>
											{summaryOf(rule)}
										</span>
										<span
											className={cn(
												"shrink-0 rounded-sm px-1.5 py-0.5 text-xs tabular-nums",
												hit > 0 ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg",
											)}
										>
											命中 {hit} 行
										</span>
										<ActionButton onClick={() => setOpenKey(opened ? null : target.key)}>
											{opened ? "收起" : "编辑"}
										</ActionButton>
										<ActionIconButton
											label={`清除 ${target.label} 的数据范围`}
											disabled={!rule?.field}
											onClick={() => clearRule(target.key)}
										>
											<X className="size-3.5" />
										</ActionIconButton>
									</div>
									{opened ? (
										<div className="grid grid-cols-2 gap-2 border-t border-hue-blue-line bg-hue-blue-soft/50 px-3 py-2.5">
											<div>
												<span className="mb-1 block text-[11px] tracking-wider text-muted-foreground">字段</span>
												<Select
													items={fields.map((field) => ({ value: field.id, label: field.label }))}
													value={rule?.field || null}
													onValueChange={(value) => setRule(target.key, { field: value ?? "", value: "" })}
												>
													<SelectTrigger size="sm" className="w-full" aria-label={`${target.label} 数据范围字段`}>
														<SelectValue placeholder="不限字段" />
													</SelectTrigger>
													<SelectContent>
														{fields.map((field) => (
															<SelectItem key={field.id} value={field.id}>
																{field.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
											<div>
												<span className="mb-1 block text-[11px] tracking-wider text-muted-foreground">值</span>
												<Select
													items={values}
													value={rule?.value || null}
													disabled={!rule?.field}
													onValueChange={(value) => {
														if (!rule?.field) return;
														setRule(target.key, { field: rule.field, value: value ?? "" });
													}}
												>
													<SelectTrigger size="sm" className="w-full" aria-label={`${target.label} 数据范围值`}>
														<SelectValue placeholder={rule?.field ? "选择值" : "先选字段"} />
													</SelectTrigger>
													<SelectContent>
														{values.map((item) => (
															<SelectItem key={item.value} value={item.value}>
																{item.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										</div>
									) : null}
								</article>
							);
						})}
					</div>
					<p className="text-xs text-muted-foreground">
						未划范围的人默认拿到全部 {rows.length} 行;范围重叠不会互相覆盖,但同一行会显示两次。
					</p>
				</div>
			) : null}
		</div>
	);
}
