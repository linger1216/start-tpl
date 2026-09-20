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
import { DATA_SCOPES, ROLE_STATUSES } from "#/mocks/settings";
import {
	type SettingsRolesSubmitValues,
	settingsRolesFormSchema,
	toForm,
	toSubmit,
} from "./settings-roles-form-mappers";
import type { RoleRow } from "./settings-roles-table";

/**
 * 新建 / 编辑角色。
 *
 * 固定五件套:`open` / `onOpenChange` / `initial` / `onSubmit` / `isPending`。
 * 角色的权限点不在这里配 —— 行内「配置权限」的权限树才是唯一入口(`setRolePermissions`)。
 */
export function SettingsRolesFormDialog({
	open,
	onOpenChange,
	initial,
	onSubmit,
	isPending = false,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** null = 新建;传行数据 = 编辑 */
	initial: RoleRow | null;
	onSubmit: (values: SettingsRolesSubmitValues) => void;
	isPending?: boolean;
}) {
	const form = useAppForm({
		defaultValues: toForm(initial),
		validators: { onBlur: settingsRolesFormSchema, onSubmit: settingsRolesFormSchema },
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
					<DialogTitle>{initial ? "编辑角色" : "新增角色"}</DialogTitle>
					<DialogDescription>
						带 * 为必填项。权限点请在角色列表的行内「配置权限」里勾选,本表单不覆盖已配置的权限。
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
						<form.AppField name="角色名">{(field) => <field.TextField label="角色名" required />}</form.AppField>
						<form.AppField name="角色编码">
							{(field) => <field.TextField label="角色编码" required placeholder="ROLE_AUDITOR" />}
						</form.AppField>
						<form.AppField name="数据范围">
							{(field) => <field.SelectField label="数据范围" values={DATA_SCOPES} required />}
						</form.AppField>
						<form.AppField name="状态">
							{(field) => <field.SelectField label="状态" values={ROLE_STATUSES} required />}
						</form.AppField>
						<form.AppField name="创建时间">
							{(field) => <field.TextField label="创建时间" placeholder="YYYY-MM-DD" />}
						</form.AppField>
						<div className="sm:col-span-2">
							<form.AppField name="备注">
								{(field) => <field.TextAreaField label="备注" rows={2} placeholder="角色的用途说明" />}
							</form.AppField>
						</div>
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
