import { Save } from "lucide-react";
import { useState } from "react";

import type { DeptTreeNode } from "#/components/modules/settings/settings-departments-tree";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";

/** 详情表单的值 */
export type DeptFormValues = {
	name: string;
	parentId: string | null;
	status: boolean;
	remark: string;
};

export function deptFormValues(node: DeptTreeNode): DeptFormValues {
	return { name: node.name, parentId: node.parentId, status: node.status !== 0, remark: node.remark ?? "" };
}

type DeptMemberRow = {
	id: string;
	userId: string;
	/** 成员当前的角色 id(members 接口返回;界面靠 roleName 展示,id 供"行内改角色"这类需求) */
	roleId: string;
	userName: string;
	userEmail: string;
	roleName: string;
};

/**
 * 右侧「部门详情」—— 改名称 / 上级 / 启停 / 备注,并在同一张卡里管**这个部门的成员**。
 *
 * 成员放在这里而不是单独一个页面:授权最常见的动作就是"这个部门加个人、给他一个角色",
 * 分两个页面会让人来回跳。
 */
export function SettingsDepartmentsForm({
	node,
	values,
	dirty,
	pending,
	parentOptions,
	members,
	roleOptions,
	userOptions,
	membersLoading,
	onChange,
	onSave,
	onReset,
	onDelete,
	onAddChild,
	onAddMember,
	onRemoveMember,
}: {
	node: DeptTreeNode | null;
	values: DeptFormValues;
	dirty: boolean;
	pending: boolean;
	/** 可选的上级部门(已排除自己与自己的后代) */
	parentOptions: Array<{ id: string; label: string }>;
	members: DeptMemberRow[];
	roleOptions: Array<{ id: string; name: string }>;
	userOptions: Array<{ id: string; name: string; email: string }>;
	membersLoading: boolean;
	onChange: (next: DeptFormValues) => void;
	onSave: () => void;
	onReset: () => void;
	onDelete: () => void;
	onAddChild: () => void;
	onAddMember: (userId: string, roleId: string) => void;
	onRemoveMember: (userId: string) => void;
}) {
	const [addUserId, setAddUserId] = useState("");
	const [addRoleId, setAddRoleId] = useState("");

	if (!node) {
		return (
			<div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground">
				左侧选一个部门,这里改它的名称 / 上级,并管理成员
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-[13.5px] font-medium text-foreground">{node.name}</div>
					<div className="truncate font-mono text-[11.5px] text-muted-foreground">{node.id}</div>
				</div>
				{dirty ? <span className="shrink-0 text-[11.5px] text-warn-fg">未保存</span> : null}
			</div>

			<div className="space-y-1">
				<Label className="text-[12px]">部门名</Label>
				<Input
					value={values.name}
					aria-label="部门名"
					className="h-8 text-[13px]"
					onChange={(event) => onChange({ ...values, name: event.target.value })}
				/>
			</div>

			<div className="space-y-1">
				<Label className="text-[12px]">上级部门</Label>
				<Select
					value={values.parentId ?? "__root__"}
					onValueChange={(next) => onChange({ ...values, parentId: next === "__root__" ? null : next })}
				>
					<SelectTrigger className="h-8 text-[13px]" aria-label="上级部门">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__root__">(顶级部门)</SelectItem>
						{parentOptions.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-1">
				<Label className="text-[12px]">备注</Label>
				<Textarea
					value={values.remark}
					aria-label="备注"
					rows={2}
					className="text-[12.5px]"
					onChange={(event) => onChange({ ...values, remark: event.target.value })}
				/>
			</div>

			<div className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2">
				<div>
					<div className="text-[12.5px]">启用</div>
					<p className="text-[11.5px] text-muted-foreground">停用的部门不参与权限计算(成员还在,只是不生效)</p>
				</div>
				<Switch
					aria-label="启用"
					checked={values.status}
					onCheckedChange={(next) => onChange({ ...values, status: next })}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2 pt-1">
				<Button size="sm" disabled={pending || !dirty} onClick={onSave}>
					<Save className="size-3.5" />
					{pending ? "保存中…" : "保存"}
				</Button>
				<ActionButton disabled={pending || !dirty} onClick={onReset}>
					还原
				</ActionButton>
				<ActionButton disabled={pending} onClick={onAddChild}>
					新增子部门
				</ActionButton>
				<ActionButton tone="danger" disabled={pending} onClick={onDelete}>
					删除
				</ActionButton>
			</div>

			{/* ── 成员:谁在这个部门、是什么角色 ───────────────────────── */}
			<div className="space-y-2 border-t border-border pt-3">
				<div className="flex items-center justify-between">
					<div className="text-[13px] font-medium">成员({members.length})</div>
					<span className="text-[11.5px] text-muted-foreground">一个人在同一个部门只有一个角色</span>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Select value={addUserId} onValueChange={(next) => setAddUserId(next ?? "")}>
						<SelectTrigger className="h-8 min-w-40 flex-1 text-[12.5px]" aria-label="选用户">
							<SelectValue placeholder="选用户…" />
						</SelectTrigger>
						<SelectContent>
							{userOptions.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									{option.name || option.email}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={addRoleId} onValueChange={(next) => setAddRoleId(next ?? "")}>
						<SelectTrigger className="h-8 min-w-32 flex-1 text-[12.5px]" aria-label="选角色">
							<SelectValue placeholder="选角色…" />
						</SelectTrigger>
						<SelectContent>
							{roleOptions.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									{option.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<ActionButton
						disabled={pending || !addUserId || !addRoleId}
						onClick={() => {
							onAddMember(addUserId, addRoleId);
							setAddUserId("");
							setAddRoleId("");
						}}
					>
						加入
					</ActionButton>
				</div>

				{membersLoading ? (
					<p className="text-[12px] text-muted-foreground">加载中…</p>
				) : members.length === 0 ? (
					<p className="text-[12px] text-muted-foreground">这个部门还没有人</p>
				) : (
					<ul className="space-y-1">
						{members.map((member) => (
							<li
								key={member.id}
								className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5"
							>
								<div className="min-w-0">
									<span className="truncate text-[12.5px]">{member.userName || member.userEmail}</span>
									<span className="ml-2 text-[11.5px] text-muted-foreground">{member.roleName}</span>
								</div>
								<ActionButton tone="danger" disabled={pending} onClick={() => onRemoveMember(member.userId)}>
									移出
								</ActionButton>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
