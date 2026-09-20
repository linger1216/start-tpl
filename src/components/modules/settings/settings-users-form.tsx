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
import { DEPARTMENTS, GROUP_NAMES, ROLE_NAMES, USER_STATUSES } from "#/mocks/settings";
import {
	type SettingsUsersSubmitValues,
	settingsUsersFormSchema,
	toForm,
	toSubmit,
} from "./settings-users-form-mappers";
import type { UserRow } from "./settings-users-table";

/**
 * 新建 / 编辑用户。
 *
 * 固定五件套:`open` / `onOpenChange` / `initial` / `onSubmit` / `isPending`。
 * 组件不知道数据从哪来、也不调数据层 —— 只把领域值回抛给编排壳。
 *
 *「所属用户组」与「角色」都是**多值标签字段**(一个人可同属多个组、持多个角色);
 * 用户组归属同时也能在用户组页的「管理成员」里维护,两个入口双向一致。
 */
export function SettingsUsersFormDialog({
	open,
	onOpenChange,
	initial,
	onSubmit,
	isPending = false,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** null = 新建;传行数据 = 编辑 */
	initial: UserRow | null;
	onSubmit: (values: SettingsUsersSubmitValues) => void;
	isPending?: boolean;
}) {
	const form = useAppForm({
		defaultValues: toForm(initial),
		validators: { onBlur: settingsUsersFormSchema, onSubmit: settingsUsersFormSchema },
		onSubmit: ({ value }) => onSubmit(toSubmit(value)),
	});

	// 打开 / 切换编辑对象时同步初值
	useEffect(() => {
		if (open) form.reset(toForm(initial));
	}, [open, initial, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{initial ? "编辑用户" : "新增用户"}</DialogTitle>
					<DialogDescription>带 * 为必填项。数据保存在前端内存中,刷新页面即回到初始 mock 数据。</DialogDescription>
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
						<form.AppField name="账号">{(field) => <field.TextField label="账号" required />}</form.AppField>
						<form.AppField name="姓名">{(field) => <field.TextField label="姓名" required />}</form.AppField>
						<form.AppField name="手机号">
							{(field) => <field.TextField label="手机号" required placeholder="11 位手机号" />}
						</form.AppField>
						<form.AppField name="所属部门">
							{(field) => <field.SelectField label="所属部门/条线" values={DEPARTMENTS} required />}
						</form.AppField>
						<form.AppField name="状态">
							{(field) => <field.SelectField label="状态" values={USER_STATUSES} required />}
						</form.AppField>
						<form.AppField name="最近登录时间">
							{(field) => <field.TextField label="最近登录时间" placeholder="YYYY-MM-DD HH:mm" />}
						</form.AppField>
						<form.AppField name="所属用户组">
							{(field) => <field.TagField label="所属用户组" options={GROUP_NAMES} />}
						</form.AppField>
						<form.AppField name="角色">{(field) => <field.TagField label="角色" options={ROLE_NAMES} />}</form.AppField>
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
