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
import { GROUP_LINES, GROUP_STATUSES, ROLE_NAMES } from "#/mocks/settings";
import {
	type SettingsGroupsSubmitValues,
	settingsGroupsFormSchema,
	toForm,
	toSubmit,
} from "./settings-groups-form-mappers";
import type { GroupRow } from "./settings-groups-table";

/**
 * 新建 / 编辑用户组。
 *
 * 固定五件套:`open` / `onOpenChange` / `initial` / `onSubmit` / `isPending`。
 * 这里只管组自身信息;成员与组权限分别由行内「成员/授权」弹窗的两个 tab 维护
 * (避免"编辑组信息"和"给组配置权限"互相覆盖)。
 */
export function SettingsGroupsFormDialog({
	open,
	onOpenChange,
	initial,
	onSubmit,
	isPending = false,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** null = 新建;传行数据 = 编辑 */
	initial: GroupRow | null;
	onSubmit: (values: SettingsGroupsSubmitValues) => void;
	isPending?: boolean;
}) {
	const form = useAppForm({
		defaultValues: toForm(initial),
		validators: { onBlur: settingsGroupsFormSchema, onSubmit: settingsGroupsFormSchema },
		onSubmit: ({ value }) => onSubmit(toSubmit(value)),
	});

	// 打开 / 切换编辑对象时同步初值
	useEffect(() => {
		if (open) form.reset(toForm(initial));
	}, [open, initial, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{initial ? "编辑用户组" : "新增用户组"}</DialogTitle>
					<DialogDescription>
						带 * 为必填项。成员的添加 / 移除请用行内「成员/授权」弹窗,本表单不覆盖成员与权限。
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
					<div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
						<form.AppField name="组名">{(field) => <field.TextField label="组名" required />}</form.AppField>
						<form.AppField name="所属条线">
							{(field) => <field.SelectField label="所属条线" values={GROUP_LINES} required />}
						</form.AppField>
						<form.AppField name="状态">
							{(field) => <field.SelectField label="状态" values={GROUP_STATUSES} required />}
						</form.AppField>
						<form.AppField name="创建时间">
							{(field) => <field.TextField label="创建时间" placeholder="YYYY-MM-DD" />}
						</form.AppField>
						<form.AppField name="已授权角色">
							{(field) => <field.TagField label="已授权角色" options={ROLE_NAMES} />}
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
