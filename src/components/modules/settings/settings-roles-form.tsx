import { useEffect, useState } from "react";

import type { RoleRow } from "#/components/modules/settings/settings-roles-table";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";

export type RoleFormPayload = {
	code: string;
	name: string;
	status: boolean;
	remark: string | null;
};

/**
 * 角色信息表单(新增 / 编辑)。
 *
 * 版式对齐「参数管理」的表单对话框:标题 + 说明 + 字段 + 底部「取消 / 保存」。
 * 权限点**不在这里** —— 它走自己的对话框(那棵树很高,塞进这个表单会把字段挤没)。
 */
export function SettingsRolesForm({
	role,
	creating,
	open,
	pending,
	onOpenChange,
	onSubmit,
}: {
	role: RoleRow | null;
	creating: boolean;
	open: boolean;
	pending: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (payload: RoleFormPayload) => void;
}) {
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [remark, setRemark] = useState("");
	const [status, setStatus] = useState(true);

	// 打开时把当前值灌进来(关掉不清,免得关闭动画期间闪一下空值)
	useEffect(() => {
		if (!open) return;
		setName(role?.name ?? "");
		setCode(role?.code ?? "");
		setRemark(role?.remark ?? "");
		setStatus(role ? role.status !== 0 : true);
	}, [open, role]);

	const invalid = name.trim().length === 0 || code.trim().length === 0;

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{creating ? "新增角色" : `编辑角色 · ${role?.name ?? ""}`}</DialogTitle>
					<DialogDescription>
						角色是**全局定义**的("谁在哪个部门是什么角色"记在部门成员上)—— 所以这里不会因为部门变多而复制出一堆角色。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="space-y-1">
						<Label htmlFor="role-name" className="text-[12px]">
							角色名
						</Label>
						<Input
							id="role-name"
							value={name}
							placeholder="如:部门主管"
							className="text-[13px]"
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="role-code" className="text-[12px]">
							标识(程序里认它)
						</Label>
						<Input
							id="role-code"
							value={code}
							placeholder="如:dept_manager"
							className="font-mono text-[12.5px]"
							onChange={(event) => setCode(event.target.value)}
						/>
						<p className="text-[11.5px] text-muted-foreground">全库唯一;建议小写下划线。</p>
					</div>
					<div className="space-y-1">
						<Label htmlFor="role-remark" className="text-[12px]">
							说明
						</Label>
						<Textarea
							id="role-remark"
							value={remark}
							rows={2}
							placeholder="给人看的说明"
							className="text-[12px]"
							onChange={(event) => setRemark(event.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2">
						<div>
							<div className="text-[12.5px]">启用</div>
							<p className="text-[11.5px] text-muted-foreground">停用的角色不参与权限计算(成员还在,只是不生效)</p>
						</div>
						<Switch aria-label="启用" checked={status} onCheckedChange={setStatus} />
					</div>
				</div>

				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={pending || invalid}
						onClick={() => onSubmit({ name: name.trim(), code: code.trim(), status, remark: remark.trim() || null })}
					>
						{pending ? "保存中…" : creating ? "创建" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
