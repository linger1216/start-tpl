import { useEffect } from "react";

import { useAppForm } from "#/components/modules/shared/form-kit";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Label } from "#/components/ui/label";
import {
	type SettingsTagDimensionSubmitValues,
	type SettingsTagsSubmitValues,
	settingsTagDimensionFormSchema,
	settingsTagsFormSchema,
	toDimensionForm,
	toDimensionSubmit,
	toTagForm,
	toTagSubmit,
} from "./settings-tags-form-mappers";
import type { TagDimension, TagItem } from "./settings-tags-table";

/**
 * 标签维度 · 新建 / 编辑弹窗。
 *
 * 固定五件套:`open` / `onOpenChange` / `initial` / `onSubmit` / `isPending`。
 * 本页是标签体系派生出的**额外增补**功能,不在菜单清单之列。
 */
export function SettingsTagDimensionFormDialog({
	open,
	onOpenChange,
	initial,
	onSubmit,
	isPending = false,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	initial: TagDimension | null;
	onSubmit: (values: SettingsTagDimensionSubmitValues) => void;
	isPending?: boolean;
}) {
	const form = useAppForm({
		defaultValues: toDimensionForm(initial),
		validators: { onBlur: settingsTagDimensionFormSchema, onSubmit: settingsTagDimensionFormSchema },
		onSubmit: ({ value }) => onSubmit(toDimensionSubmit(value)),
	});

	useEffect(() => {
		if (open) form.reset(toDimensionForm(initial));
	}, [open, initial, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{initial ? "编辑标签维度" : "新增标签维度"}</DialogTitle>
					<DialogDescription>
						带 * 为必填项。维度是标签的分类口径,标签明细通过「所属维度」挂到维度下。
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault;
						event.stopPropagation;
						form.handleSubmit;
					}}
					className="space-y-4"
				>
					<div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
						<form.AppField name="维度">{(field) => <field.TextField label="维度" required />}</form.AppField>
						<form.AppField name="适用对象">
							{(field) => <field.TextField label="适用对象" required placeholder="如 安全监管企业 / 重点场所" />}
						</form.AppField>
						<form.AppField name="来源">
							{(field) => <field.TextField label="来源" placeholder="如 监管规范 / 业务规范" />}
						</form.AppField>
						<form.AppField name="备注">
							{(field) => <field.TextAreaField label="备注" rows={3} placeholder="原文未枚举完整时在此记录补齐口径" />}
						</form.AppField>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							取消
						</Button>
						<form.AppForm>
							<form.SubmitButton label={initial ? "保存" : "新增"} />
						</form.AppForm>
					</DialogFooter>
				</form>
				{isPending ? <p className="text-[12px] text-muted-foreground">正在写入…</p> : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * 标签明细 · 新建 / 编辑弹窗。
 *
 * 「所属维度」:编辑时用 `SearchSelect`(维度表可增删,候选由编排壳注入);
 * **从某个维度的明细弹窗里新建时**,维度由 `lockDimension` 锁死为只读展示 ——
 * 不允许从维度 A 的弹窗里建出维度 B 的标签。
 * 「含义」用多行文本 —— 原始需求给的就是一句解释。
 */
export function SettingsTagsFormDialog({
	open,
	onOpenChange,
	initial,
	dimensions,
	lockDimension,
	onSubmit,
	isPending = false,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	initial: TagItem | null;
	/** 维度候选(由编排壳从维度表当前行注入) */
	dimensions: readonly string[];
	/** 新建时的锁定维度(由明细弹窗传入;编辑已有标签时不锁,允许换维度) */
	lockDimension?: string;
	onSubmit: (values: SettingsTagsSubmitValues) => void;
	isPending?: boolean;
}) {
	const dimensionLocked = lockDimension !== undefined && initial === null;
	const defaultDimension = initial ? initial.维度 : (lockDimension ?? dimensions[0] ?? "");

	const form = useAppForm({
		defaultValues: toTagForm(initial, defaultDimension),
		validators: { onBlur: settingsTagsFormSchema, onSubmit: settingsTagsFormSchema },
		onSubmit: ({ value }) => onSubmit(toTagSubmit(value)),
	});

	useEffect(() => {
		if (open) form.reset(toTagForm(initial, defaultDimension));
	}, [open, initial, defaultDimension, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{initial ? "编辑标签" : "新增标签"}</DialogTitle>
					<DialogDescription>带 * 为必填项。标签的含义会作为 tooltip 出现在各业务页面的标签列上。</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault;
						event.stopPropagation;
						form.handleSubmit;
					}}
					className="space-y-4"
				>
					<div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
						{dimensionLocked ? (
							<div className="space-y-1.5">
								<Label>所属维度</Label>
								{/* 只读:值仍在表单里(来自 defaultValues),提交时落到该维度下 */}
								<div className="flex h-9 items-center rounded-lg border border-input bg-secondary/50 px-3 text-[13px] text-muted-foreground">
									{defaultDimension || "—"}
									<span className="ml-2 text-[11px]">(由当前标签维度决定,不可修改)</span>
								</div>
							</div>
						) : (
							<form.AppField name="维度">
								{(field) => <field.SelectField label="所属维度" values={dimensions} required />}
							</form.AppField>
						)}
						<form.AppField name="标签">
							{(field) => <field.TextField label="标签" required placeholder="如 红色 / 已走访 / 已立项" />}
						</form.AppField>
						<form.AppField name="含义">
							{(field) => <field.TextAreaField label="含义" rows={3} required placeholder="原始需求给出的标签含义" />}
						</form.AppField>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							取消
						</Button>
						<form.AppForm>
							<form.SubmitButton label={initial ? "保存" : "新增"} />
						</form.AppForm>
					</DialogFooter>
				</form>
				{isPending ? <p className="text-[12px] text-muted-foreground">正在写入…</p> : null}
			</DialogContent>
		</Dialog>
	);
}
