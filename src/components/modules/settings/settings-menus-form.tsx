import { Save, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { MenuTreeNode } from "#/components/layout/nav-menu";
import { IconPicker } from "#/components/modules/shared/icon-picker";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { recordIdFromMenuDetailPath } from "#/lib/menu-detail-path";

/** 详情表单的值 */
export type MenuFormValues = {
	name: string;
	path: string;
	icon: string | null;
	visible: boolean;
};

export function menuFormValues(node: MenuTreeNode): MenuFormValues {
	return { name: node.name, path: node.path ?? "", icon: node.icon, visible: node.visible !== 0 };
}

/**
 * 右侧「菜单详情」——直接编辑选中节点(名称 / 路径 / 图标 / 是否显示)。
 *
 * 为什么带显式「保存」而不是失焦即存:菜单是全局导航,改一半就想撤回是常态;
 * 显式保存 + `未保存` 徒标,改动范围一目了然。
 */
export function SettingsMenusForm({
	node,
	values,
	dirty,
	pending,
	onChange,
	onSave,
	onReset,
	onDelete,
	onAddChild,
	onAddSibling,
}: {
	node: MenuTreeNode | null;
	values: MenuFormValues;
	dirty: boolean;
	pending: boolean;
	onChange: (next: MenuFormValues) => void;
	onSave: () => void;
	onReset: () => void;
	onDelete: () => void;
	onAddChild: () => void;
	onAddSibling: () => void;
}) {
	/** 参数化菜单(path = <前缀>/<记录 id>)→ 关联的记录 id(仅展示用,这里不改) */
	const detailRecordId = recordIdFromMenuDetailPath(node?.path);

	// 选中节点变了 → 让浏览器把输入框内部状态跟着重置(受控值来自 props,这里只是保持表单"干净")
	const [key, setKey] = useState(node?.id ?? "");
	useEffect(() => {
		setKey(node?.id ?? "");
	}, [node?.id]);

	if (!node) {
		return (
			<div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-muted-foreground">
				左侧选一个菜单,这里直接改它的名称 / 路径 / 图标
			</div>
		);
	}

	return (
		<div key={key} className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-[13.5px] font-medium text-foreground">{node.name}</div>
					<div className="truncate font-mono text-[11.5px] text-muted-foreground">{node.id}</div>
				</div>
				{dirty ? <span className="shrink-0 text-[11.5px] text-warn-fg">未保存</span> : null}
			</div>

			<div className="space-y-1">
				<Label className="text-[12px]">名称</Label>
				<Input
					value={values.name}
					aria-label="菜单名称"
					className="h-8 text-[13px]"
					onChange={(event) => onChange({ ...values, name: event.target.value })}
				/>
			</div>

			{detailRecordId ? (
				<div className="rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-[11.5px] text-muted-foreground">
					这是<span className="mx-0.5 font-medium text-primary">参数化菜单</span>:点它会打开记录
					<span className="mx-0.5 font-mono text-foreground">{detailRecordId}</span>
					的明细页。关联由对应的业务页维护,这里只展示。
				</div>
			) : null}

			<div className="space-y-1">
				<Label className="text-[12px]">路径</Label>
				<Input
					value={values.path}
					aria-label="菜单路径"
					placeholder="分组留空;页面填路由,如 /archive/cases"
					className="h-8 font-mono text-[12.5px]"
					onChange={(event) => onChange({ ...values, path: event.target.value })}
				/>
				<p className="text-[11.5px] text-muted-foreground">路径全局唯一(重了会让两个菜单指向同一个页面)。</p>
			</div>

			<div className="space-y-1">
				<Label className="text-[12px]">图标</Label>
				<IconPicker value={values.icon} onChange={(next) => onChange({ ...values, icon: next })} className="h-8" />
			</div>

			<div className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2">
				<div>
					<div className="text-[12.5px]">在侧边栏显示</div>
					<p className="text-[11.5px] text-muted-foreground">关掉后连同它的子菜单一起隐藏</p>
				</div>
				<Switch
					aria-label="在侧边栏显示"
					checked={values.visible}
					onCheckedChange={(next) => onChange({ ...values, visible: next })}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2 pt-1">
				<Button size="sm" disabled={pending || !dirty} onClick={onSave}>
					<Save className="size-3.5" />
					{pending ? "保存中…" : "保存"}
				</Button>
				<Button variant="outline" size="sm" disabled={pending || !dirty} onClick={onReset}>
					<Undo2 className="size-3.5" />
					还原
				</Button>
			</div>

			<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
				<Button variant="outline" size="sm" disabled={pending} onClick={onAddSibling}>
					新增同级
				</Button>
				<Button variant="outline" size="sm" disabled={pending} onClick={onAddChild}>
					新增子菜单
				</Button>
				<Button variant="outline" size="sm" className="text-destructive" disabled={pending} onClick={onDelete}>
					<Trash2 className="size-3.5" />
					删除
				</Button>
			</div>
		</div>
	);
}
