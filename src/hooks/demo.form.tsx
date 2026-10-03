import { createFormHook } from "@tanstack/react-form";
import type { ChangeEvent, ReactNode } from "react";

import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Slider } from "#/components/ui/slider";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { cn } from "#/lib/utils";

import { fieldContext, formContext, useFieldContext, useFormContext } from "./demo.form-context";

/**
 * `useAppForm` —— 把内置 UI 原语注册进 TanStack Form 的字段 / 表单组件库。
 *
 * 这是**框架能力 demo** 专用的一组 —— 演示 `createFormHook` 的注册流程本身。
 * 业务页的表单没走它:设置模块那 7 个表单字段都很少(3~5 个),手写 `<Label> + <Input>` 更直接,
 * 也少一层 field-context 的间接。
 *
 * 字段组件刻意简化:label / 错误提示走模板自带的 `<Label>` / `<Input>`,不挂业务校验。
 */

function FieldShell({
	label,
	hint,
	error,
	children,
}: {
	label: string;
	hint?: string;
	error?: string;
	children: ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs">{label}</Label>
			{children}
			{hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
			{error ? <p className="text-xs text-danger-fg">{error}</p> : null}
		</div>
	);
}

function TextField({
	label,
	placeholder,
	type = "text",
}: {
	label: string;
	placeholder?: string;
	type?: "text" | "email";
}) {
	const field = useFieldContext<string>();
	return (
		<FieldShell label={label} error={field.state.meta.errors[0]?.toString()}>
			<Input
				type={type}
				value={field.state.value}
				onChange={(event: ChangeEvent<HTMLInputElement>) => field.handleChange(event.target.value)}
				onBlur={field.handleBlur}
				placeholder={placeholder}
				className={cn(field.state.meta.errors.length > 0 && "border-danger")}
			/>
		</FieldShell>
	);
}

function TextArea({ label, placeholder }: { label: string; placeholder?: string }) {
	const field = useFieldContext<string>();
	return (
		<FieldShell label={label} error={field.state.meta.errors[0]?.toString()}>
			<Textarea
				value={field.state.value}
				onChange={(event) => field.handleChange(event.target.value)}
				onBlur={field.handleBlur}
				placeholder={placeholder}
				rows={4}
				className={cn(field.state.meta.errors.length > 0 && "border-danger")}
			/>
		</FieldShell>
	);
}

function SelectField({
	label,
	placeholder,
	values,
}: {
	label: string;
	placeholder?: string;
	values: ReadonlyArray<{ label: string; value: string }>;
}) {
	const field = useFieldContext<string | null>();
	return (
		<FieldShell label={label} error={field.state.meta.errors[0]?.toString()}>
			<Select
				value={field.state.value ?? ""}
				onValueChange={(value: string | null) => {
					if (value !== null) field.handleChange(value as never);
				}}
			>
				<SelectTrigger className="h-9 w-full">
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{values.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FieldShell>
	);
}

function SwitchField({ label }: { label: string }) {
	const field = useFieldContext<boolean>();
	return (
		<div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
			<Label className="text-sm">{label}</Label>
			<Switch checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />
		</div>
	);
}

function SliderField({ label }: { label: string }) {
	const field = useFieldContext<number>();
	return (
		<FieldShell label={label} hint={`当前 ${field.state.value}`}>
			<Slider
				value={[field.state.value]}
				min={0}
				max={100}
				step={1}
				onValueChange={(value: number | readonly number[]) => {
					const next = Array.isArray(value) ? (value[0] ?? 0) : value;
					field.handleChange(next as never);
				}}
			/>
		</FieldShell>
	);
}

function SubscribeButton({ label = "提交" }: { label?: string }) {
	const form = useFormContext();
	return (
		<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
			{([canSubmit, isSubmitting]) => (
				<button
					type="submit"
					disabled={!canSubmit}
					className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-60"
				>
					{isSubmitting ? "提交中…" : label}
				</button>
			)}
		</form.Subscribe>
	);
}

export const { useAppForm } = createFormHook({
	fieldComponents: {
		TextField,
		TextArea,
		Select: SelectField,
		Switch: SwitchField,
		Slider: SliderField,
	},
	formComponents: {
		SubscribeButton,
	},
	fieldContext,
	formContext,
});
