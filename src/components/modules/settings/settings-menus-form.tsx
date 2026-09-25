import { Save } from "lucide-react";
import { useEffect, useState } from "react";

import type { MenuTreeNode } from "#/components/layout/nav-menu";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { IconPicker } from "#/components/modules/shared/icon-picker";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { recordIdFromMenuDetailPath } from "#/lib/menu-detail-path";
import { asMenuType, MENU_TYPE_META, MENU_TYPES, type MenuType } from "#/lib/menu-spec";

/** 详情表单的值 */
export type MenuFormValues = {
	name: string;
	path: string;
	icon: string | null;
	visible: boolean;
	/** 1 目录 / 2 菜单 / 3 按钮 */
	type: MenuType;
	/** 权限标识;按钮必填 */
	perm: string;
};

export function menuFormValues(node: MenuTreeNode): MenuFormValues {
	return {
		name: node.name,
		path: node.path ?? "",
		icon: node.icon,
		visible: node.visible !== 0,
		type: asMenuType(node.type),
		perm: node.perm ?? "",
	};
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

	/**
	 * 类型下拉的 `{ value, label }` 列表 —— **同一份**同时喂给 `<Select items>` 和 `<SelectItem>`。
	 *
	 * ⚠️ `items` 不能省:Base UI **不会**从 `<SelectItem>` 子元素收集 label(Radix / shadcn 才会),
	 * 没有 `items` 时触发器兜底画**原始 value**(实测这里画的是 `"2"` 而不是"菜单")。
	 */
	const typeItems = MENU_TYPES.map((code) => ({ value: String(code), label: MENU_TYPE_META[code].label }));

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

			<DetailRow label="名称">
				<Input
					value={values.name}
					aria-label="菜单名称"
					className="h-8 text-[13px]"
					onChange={(event) => onChange({ ...values, name: event.target.value })}
				/>
			</DetailRow>

			<DetailRow label="类型">
				<Select
					items={typeItems}
					value={String(values.type)}
					onValueChange={(next) => onChange({ ...values, type: asMenuType(next) })}
				>
					<SelectTrigger className="h-8 text-[13px]" aria-label="菜单类型">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{typeItems.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-[11.5px] text-muted-foreground">{MENU_TYPE_META[values.type].hint}</p>
			</DetailRow>

			<DetailRow label="权限标识">
				<Input
					value={values.perm}
					aria-label="权限标识"
					placeholder="如 sys:role:write"
					className="h-8 font-mono text-[12.5px]"
					onChange={(event) => onChange({ ...values, perm: event.target.value })}
				/>
				<p className="text-[11.5px] text-muted-foreground">
					前端 <code className="font-mono">useHasPerm()</code> 认它;按钮必须有,目录 / 菜单可空。
				</p>
			</DetailRow>

			{detailRecordId ? (
				<div className="rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-[11.5px] text-muted-foreground">
					这是<span className="mx-0.5 font-medium text-primary">参数化菜单</span>:点它会打开记录
					<span className="mx-0.5 font-mono text-foreground">{detailRecordId}</span>
					的明细页。关联由对应的业务页维护,这里只展示。
				</div>
			) : null}

			<DetailRow label="路径">
				<Input
					value={values.path}
					aria-label="菜单路径"
					placeholder="分组留空;页面填路由,如 /archive/cases"
					className="h-8 font-mono text-[12.5px]"
					onChange={(event) => onChange({ ...values, path: event.target.value })}
				/>
				<p className="text-[11.5px] text-muted-foreground">路径全局唯一(重了会让两个菜单指向同一个页面)。</p>
			</DetailRow>

			<DetailRow label="图标">
				<IconPicker value={values.icon} onChange={(next) => onChange({ ...values, icon: next })} className="h-8" />
			</DetailRow>

			<DetailRow label="在侧边栏显示">
				<Switch
					aria-label="在侧边栏显示"
					checked={values.visible}
					onCheckedChange={(next) => onChange({ ...values, visible: next })}
				/>
			</DetailRow>

			{node ? <DetailMeta meta={{ createdAt: node.createTime, updatedAt: node.updateTime }} /> : null}

			<div className="flex flex-wrap items-center gap-2 pt-1">
				<Button size="sm" disabled={pending || !dirty} onClick={onSave}>
					<Save className="size-3.5" />
					{pending ? "保存中…" : "保存"}
				</Button>
				<ActionButton disabled={pending || !dirty} onClick={onReset}>
					还原
				</ActionButton>
			</div>

			<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
				<ActionButton disabled={pending} onClick={onAddSibling}>
					新增同级
				</ActionButton>
				<ActionButton disabled={pending} onClick={onAddChild}>
					新增子菜单
				</ActionButton>
				<ActionButton tone="danger" disabled={pending} onClick={onDelete}>
					删除
				</ActionButton>
			</div>
		</div>
	);
}
