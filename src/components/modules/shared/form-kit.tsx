import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SearchSelect } from "#/components/ui/search-select";
import { TagInput } from "#/components/ui/tag-input";
import { Textarea as UiTextarea } from "#/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/** 表单基座 —— TanStack Form 与 `components/ui` 原语之间的接线层。
 *
 * 定位:这是"该封装"的部分(见 `doc/前端结构与组件约定.md` §3.3)——
 * 字段的排版(标签 + 控件 + 错误)与"UI 原语 ↔ 表单值"的转换在 40+ 个弹窗里完全一致,
 * 各域自己写一遍只会漂移;**但表格绝不封装**,每个业务域自己调用 TanStack Table(§0 第 3 条)。
 *
 * 用法(各域 `<域>-form.tsx` 内):
 *   const form = useAppForm({ defaultValues: toForm(initial), validators: { onSubmit: schema },
 *                             onSubmit: ({ value }) => onSubmit(toSubmit(value)) });
 *   <form.AppField name="名称">{(field) => <field.TextField label="名称 *" />}</form.AppField>
 *
 * 自研复合字段(字段映射编辑器这类含多行子控件的)在域内用 `form.AppField` +
 * `field.state.value / field.handleChange` 直连,错误排版复用本文件的 `FieldRow`;
 * 错误数组可能带 `undefined`(TanStack Form 的 ValidationError 形状),用 `fieldMessages` 过一道再传。
 */

const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();

/** TanStack Form 的错误既可能是字符串,也可能是标准 schema 校验器给的对象 */
export type FieldError = string | { message: string };

const errorText = (error: FieldError) => (typeof error === "string" ? error : error.message);

/** 过滤掉 `undefined` 项(TanStack Form 的 `meta.errors` 元素类型允许 undefined) */
export function fieldMessages(errors: ReadonlyArray<FieldError | undefined>): FieldError[] {
	return errors.filter((error): error is FieldError => Boolean(error));
}

/** 字段排布:控件在上,错误在下(全站统一)。域内自研字段也用它,别各写一套。 */
export function FieldRow({ children, errors }: { children: ReactNode; errors: ReadonlyArray<FieldError | undefined> }) {
	return (
		<div className="space-y-1.5">
			{children}
			{fieldMessages(errors).map((error) => (
				<p key={errorText(error)} className="text-[12px] font-medium text-destructive">
					{errorText(error)}
				</p>
			))}
		</div>
	);
}

/** 单行文本 / 数字 / 日期 */
export function TextField({
	label,
	placeholder,
	type = "text",
	required,
}: {
	label: string;
	placeholder?: string;
	type?: "text" | "number" | "date";
	required?: boolean;
}) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const id = useId();

	return (
		<FieldRow errors={errors}>
			<Label htmlFor={id}>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			<Input
				id={id}
				type={type}
				value={field.state.value}
				placeholder={placeholder}
				aria-invalid={errors.length > 0}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
		</FieldRow>
	);
}

/** 多行文本 */
export function TextAreaField({
	label,
	placeholder,
	rows = 3,
	required,
}: {
	label: string;
	placeholder?: string;
	rows?: number;
	required?: boolean;
}) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const id = useId();

	return (
		<FieldRow errors={errors}>
			<Label htmlFor={id}>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			<UiTextarea
				id={id}
				rows={rows}
				value={field.state.value}
				placeholder={placeholder}
				aria-invalid={errors.length > 0}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
		</FieldRow>
	);
}

/** 可搜索下拉(枚举字段);空串表示"未选择",组件只吃字符串,数字化发生在边界 */
export function SelectField({
	label,
	placeholder,
	values,
	required,
}: {
	label: string;
	placeholder?: string;
	values: readonly string[];
	required?: boolean;
}) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const id = useId();

	return (
		<FieldRow errors={errors}>
			<Label htmlFor={id}>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			<SearchSelect
				value={field.state.value === "" ? undefined : field.state.value}
				onValueChange={(value) => {
					field.handleChange(value);
					field.handleBlur();
				}}
				options={values.map((item) => ({ value: item, label: item }))}
				placeholder={placeholder ?? `请选择${label}`}
				triggerClassName="h-9 w-full"
			/>
		</FieldRow>
	);
}

/**
 * 多值标签字段。
 *
 * 表单值是 `string[]`(数据模型就是这个形状),而 `TagInput` 需要 `{ value }[]`
 * —— 这层转换收在组件里,各域不必重复;候选标签来自 `#/mocks/tags.ts`。
 */
export function TagField({
	label,
	options,
	placeholder,
	max = 12,
	required,
}: {
	label: string;
	options?: readonly string[];
	placeholder?: string;
	max?: number;
	required?: boolean;
}) {
	const field = useFieldContext<string[]>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const chosen = new Set(field.state.value);

	return (
		<FieldRow errors={errors}>
			<Label>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			<TagInput
				value={field.state.value.map((value) => ({ value }))}
				onChange={(next) => {
					field.handleChange(next.map((entry) => entry.value));
					field.handleBlur();
				}}
				max={max}
				placeholder={placeholder ?? `输入${label}后回车`}
			/>
			{options && options.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{options.map((option) => (
						<button
							key={option}
							type="button"
							disabled={chosen.has(option)}
							onClick={() => field.handleChange([...field.state.value, option])}
							className={
								chosen.has(option)
									? "cursor-not-allowed rounded-full border border-border px-2 py-0.5 text-[12px] opacity-40"
									: "cursor-pointer rounded-full border border-border px-2 py-0.5 text-[12px] transition-colors hover:border-ring/60 hover:bg-secondary"
							}
						>
							{option}
						</button>
					))}
				</div>
			) : null}
		</FieldRow>
	);
}

/**
 * 数字字段(整数,可空)。
 *
 * 值类型是 `number | null`:空串写回 `null` 而不是 0 —— 「没填」和「填了 0」是两件事
 * (优先级 0 表示最低,不是未填写)。边界由 `min` / `max` 约束,超界即 clamp。
 */
export function NumberField({
	label,
	placeholder,
	min = 0,
	max = 999,
	hint,
	required,
}: {
	label: string;
	placeholder?: string;
	min?: number;
	max?: number;
	/** 输入框下方的说明文案(如「数值越大优先级越高」) */
	hint?: string;
	required?: boolean;
}) {
	const field = useFieldContext<number | null>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const id = useId();

	return (
		<FieldRow errors={errors}>
			<Label htmlFor={id}>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			<Input
				id={id}
				type="number"
				inputMode="numeric"
				value={field.state.value === null || field.state.value === undefined ? "" : field.state.value}
				placeholder={placeholder}
				min={min}
				max={max}
				aria-invalid={errors.length > 0}
				onBlur={field.handleBlur}
				onChange={(event) => {
					const raw = event.target.value;
					if (raw === "") {
						field.handleChange(null);
						return;
					}
					const num = Number(raw);
					if (Number.isNaN(num)) return;
					field.handleChange(Math.max(min, Math.min(max, Math.round(num))));
				}}
			/>
			{hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
		</FieldRow>
	);
}

/**
 * 单选字段(卡片式,带说明文案)。
 *
 * 值类型与选项的 `value` 同型(如接入方式的 `1 | 2`),不做字符串化 ——
 * 需要数字化的事发生在域内 mapper,不在这里。
 */
export function RadioField<V extends string | number>({
	label,
	options,
	columns = 2,
	required,
}: {
	label: string;
	options: readonly { value: V; label: string; description?: string }[];
	/** 选项排几列(窄屏始终一列) */
	columns?: 1 | 2 | 3;
	required?: boolean;
}) {
	const field = useFieldContext<V>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const groupName = useId();

	return (
		<FieldRow errors={errors}>
			<Label>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			{/* 用原生 radio(同 name 即一组):键盘方向键切换、读屏语义都由浏览器给,
			    不自己造 role="radio" —— 那属于"重新发明控件" */}
			<div
				className={cn(
					"grid gap-2",
					columns === 1 && "grid-cols-1",
					columns === 2 && "grid-cols-1 sm:grid-cols-2",
					columns === 3 && "grid-cols-1 sm:grid-cols-3",
				)}
			>
				{options.map((option) => {
					const active = field.state.value === option.value;
					return (
						<label
							key={String(option.value)}
							className={cn(
								"flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
								active ? "border-primary bg-primary/5" : "border-border hover:border-ring/50 hover:bg-secondary/60",
							)}
						>
							<input
								type="radio"
								name={groupName}
								className="sr-only"
								checked={active}
								onChange={() => {
									field.handleChange(option.value);
									field.handleBlur();
								}}
							/>
							<span
								className={cn(
									"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
									active ? "border-primary" : "border-border",
								)}
							>
								{active ? <span className="size-2 rounded-full bg-primary" /> : null}
							</span>
							<span className="min-w-0 space-y-0.5">
								<span className="block text-[13px] font-medium text-foreground">{option.label}</span>
								{option.description ? (
									<span className="block text-[12px] leading-snug text-muted-foreground">{option.description}</span>
								) : null}
							</span>
						</label>
					);
				})}
			</div>
		</FieldRow>
	);
}

/**
 * 引用型下拉:值与文案不同(部门 id / 部门名、字典 value / 文案)。
 *
 * `SelectField` 是「值即文案」的自在枚举;这里收 `{ value, label }` 选项,
 * 值仍以字符串落库(如 `DEPT-03`),展示走 label。
 */
export function RefSelectField({
	label,
	options,
	placeholder,
	required,
}: {
	label: string;
	options: readonly { value: string; label: string }[];
	placeholder?: string;
	required?: boolean;
}) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);
	const id = useId();

	return (
		<FieldRow errors={errors}>
			<Label htmlFor={id}>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			<SearchSelect
				value={field.state.value === "" ? undefined : field.state.value}
				onValueChange={(value) => {
					field.handleChange(value);
					field.handleBlur();
				}}
				options={[...options]}
				placeholder={placeholder ?? `请选择${label}`}
				triggerClassName="h-9 w-full"
			/>
		</FieldRow>
	);
}

/** 提交按钮:订阅 `isSubmitting`,提交中自动禁用 */
export function SubmitButton({ label = "保存" }: { label?: string }) {
	const form = useFormContext();

	return (
		<form.Subscribe selector={(state) => state.isSubmitting}>
			{(isSubmitting) => (
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting ? "保存中…" : label}
				</Button>
			)}
		</form.Subscribe>
	);
}

/** 注册后的 `useAppForm`:用法与 TanStack Form 的 `useForm` 一致 */
export const { useAppForm } = createFormHook({
	fieldComponents: { TextField, TextAreaField, SelectField, TagField, NumberField, RadioField, RefSelectField },
	formComponents: { SubmitButton },
	fieldContext,
	formContext,
});

// ── 分组与排版件(不依赖 form context,任何受控表单都能用)──────────────
//
// 这三件此前是「接入配置」那套弹窗私有的排版件,但它回答的是通用问题:
// 十几个字段的面板怎么不把说明堆成墙、怎么按容器宽度分列。凡是字段数 > 8
// 的表单都会遇到同样的问题,因此收进 form-kit,而不是各域各写一套。

/**
 * 字段说明:两行写法(**强制**)
 *  1. `spec`:`参数=值`,直接对应存下来的东西(等宽字体);
 *  2. `effect`:它落到**哪个 SQL / 哪个 query 参数 / 哪个字段**上。
 *
 * 例:`firstFull=false` / `true → 不传 from,只带 to`。
 * 不要写科普语气 —— 这块配置是给专业人员看的,直接说后果。
 */
export function FieldHint({ spec, effect }: { spec: string; effect?: string }) {
	return (
		<span className="block space-y-1">
			<span className="block font-mono text-[11px]">{spec}</span>
			{effect ? <span className="block text-[11px] opacity-80">{effect}</span> : null}
		</span>
	);
}

/**
 * 带标签的字段位(受控件,不吃 form context)。
 * 有 `hint` 时把说明收进 hover —— 十几个字段各带一行说明,面板高度近乎翻倍;
 * 说明只在要填那一项时才有价值。
 */
export function LabeledField({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: React.ReactNode;
	children: React.ReactNode;
}) {
	const text = <span className="block truncate text-[11.5px] text-muted-foreground">{label}</span>;
	return (
		<div className="min-w-0 space-y-1">
			{hint ? (
				<TooltipProvider delay={120}>
					<Tooltip>
						<TooltipTrigger
							render={
								<button
									type="button"
									className="flex w-full items-center gap-1 text-left"
									aria-label={`${label}说明`}
								/>
							}
						>
							{text}
							<Info className="size-3 shrink-0 text-muted-foreground/60" />
						</TooltipTrigger>
						<TooltipContent side="top" align="start" className="max-w-xs text-[11px] leading-[1.5]">
							{hint}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : (
				<Label>{text}</Label>
			)}
			{children}
		</div>
	);
}

/** 表单分组:一条标题线 + 内部自适应网格(窄 2 列 / 宽 3~4 列) */
export function FormSection({
	title,
	columns = 4,
	description,
	children,
}: {
	title: string;
	columns?: 2 | 3 | 4;
	description?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="border-t border-border pt-2.5 first:border-t-0 first:pt-0">
			<div className="mb-1.5 flex items-center gap-2">
				<span className="text-[11.5px] font-medium text-foreground">{title}</span>
				{description ? <span className="text-[11px] text-muted-foreground">{description}</span> : null}
				<span className="h-px flex-1 bg-border" />
			</div>
			<div
				className={cn(
					"grid gap-x-3 gap-y-2",
					columns === 2 && "sm:grid-cols-2",
					columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
					columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
				)}
			>
				{children}
			</div>
		</section>
	);
}
