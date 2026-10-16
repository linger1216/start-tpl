import { GripVertical } from "lucide-react";
import { useState } from "react";

import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { ActionButton } from "#/components/ui/action-button";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { cn } from "#/lib/utils";
import type { SettingsDictRow } from "./settings-dictionary-table";

/** 编辑弹窗的表单值 */
export type DictFormValues = {
	/** 字典编码(业务键):新建时必填;编辑时不可改(规则里按它引用) */
	code: string;
	name: string;
	remark: string;
	status: boolean;
	items: Array<{ label: string; value: string }>;
};

export function emptyDictForm(): DictFormValues {
	return { code: "", name: "", remark: "", status: true, items: [{ label: "", value: "" }] };
}

export function dictToForm(row: SettingsDictRow): DictFormValues {
	return {
		code: row.code,
		name: row.name,
		remark: row.remark ?? "",
		status: row.status === 1,
		items: row.items.length > 0 ? row.items.map((item) => ({ ...item })) : [{ label: "", value: "" }],
	};
}

/**
 * 字典编辑弹窗 —— 字典本身(名称 / 编码 / 说明 / 启停)+ **字典项表**。
 *
 * 字典项就是 `items = [{label, value}]`:label 是给人看的中文,value 是落库/程序里用的取值。
 * 数组顺序即下拉顺序,所以字典项列表行首有拖拽把手 —— **按住把手拖动行**来调整顺序。
 */
export function SettingsDictionaryForm({
	open,
	onOpenChange,
	editing,
	values,
	onChange,
	pending,
	error,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** 传 null = 新建;编辑时整行都传进来(底部要显示创建 / 更新时间) */
	editing: SettingsDictRow | null;
	values: DictFormValues;
	onChange: (next: DictFormValues) => void;
	pending: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const rowKeys = useStableKeys(values.items.length, "dict-item-row");

	// 打开时聚焦到第一个输入(桌面端;不 autofocus 移动端)
	function setItem(index: number, patch: Partial<{ label: string; value: string }>) {
		const items = [...values.items];
		items[index] = { ...items[index], ...patch };
		onChange({ ...values, items });
	}

	function reorder(from: number, to: number) {
		if (from === to || from < 0 || to < 0 || from >= values.items.length || to >= values.items.length) return;
		const items = [...values.items];
		const [moved] = items.splice(from, 1);
		if (moved) items.splice(to, 0, moved);
		onChange({ ...values, items });
	}

	// 拖拽排序(HTML5 DnD,列设置面板同款):整行 draggable,拖过谁谁高亮,松手落在那一行
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle className="text-balance">{editing ? `编辑字典 · ${values.name}` : "新增字典"}</DialogTitle>
					<DialogDescription>
						字典是全系统共用的固定取值表(`sys_dict`):一个字典一行,字典项是 `label`(给人看)+ `value`(程序/落库用)。
					</DialogDescription>
				</DialogHeader>

				{/* 字段区自己滚(DialogBody)—— 弹窗本体永不出滚动条(高度铁律),高度随内容长、封顶 85vh */}
				<DialogBody className="flex flex-col gap-3 pr-1">
					<div className="flex flex-col gap-1">
						<DetailRow label="字典名称" htmlFor="dict-name">
							<Input
								id="dict-name"
								value={values.name}
								className="h-8 text-sm"
								placeholder="如 档案类型…"
								autoComplete="off"
								onChange={(event) => onChange({ ...values, name: event.target.value })}
							/>
						</DetailRow>
						<DetailRow label="字典编码" htmlFor="dict-id">
							<Input
								id="dict-id"
								value={values.code}
								readOnly={Boolean(editing)}
								aria-readonly={editing ? "true" : undefined}
								translate="no"
								spellCheck={false}
								placeholder="entity_category…"
								className={
									editing
										? "h-8 cursor-default bg-muted/40 font-mono text-xs text-muted-foreground"
										: "h-8 font-mono text-xs"
								}
								onChange={(event) => onChange({ ...values, code: event.target.value })}
							/>
							<p className="text-xs text-muted-foreground">
								{editing
									? "编码是主键,也被别的功能引用,创建后不可改。"
									: "小写字母/数字/下划线,以字母开头;创建后不可改。"}
							</p>
						</DetailRow>
						<DetailRow label="说明" htmlFor="dict-remark">
							<Input
								id="dict-remark"
								value={values.remark}
								className="h-8 text-sm"
								placeholder="这个字典是给谁用的…"
								onChange={(event) => onChange({ ...values, remark: event.target.value })}
							/>
						</DetailRow>
						<DetailRow label="启用这个字典">
							<Switch
								aria-label="启用这个字典"
								checked={values.status}
								onCheckedChange={(next) => onChange({ ...values, status: next })}
							/>
						</DetailRow>
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-2">
							<Label className="text-xs">字典项(顺序即下拉顺序)</Label>
							<ActionButton onClick={() => onChange({ ...values, items: [...values.items, { label: "", value: "" }] })}>
								新增字典项
							</ActionButton>
						</div>
						<div className="space-y-1.5">
							{values.items.map((item, index) => (
								// biome-ignore lint/a11y/noStaticElementInteractions: 行只承载拖放(HTML5 DnD);真正可操作的是把手、两个输入框与删除按钮
								<div
									key={rowKeys[index]}
									draggable
									onDragStart={() => setDragIndex(index)}
									onDragEnd={() => {
										setDragIndex(null);
										setOverIndex(null);
									}}
									onDragOver={(event) => {
										event.preventDefault();
										setOverIndex(index);
									}}
									onDrop={(event) => {
										event.preventDefault();
										if (dragIndex !== null) reorder(dragIndex, index);
										setDragIndex(null);
										setOverIndex(null);
									}}
									className={cn(
										"flex flex-wrap items-center gap-1.5 rounded-md px-1.5 py-0.5",
										dragIndex === index && "opacity-50",
										// 拖过的目标行高亮一次(column-toggle 面板同款)
										overIndex === index && dragIndex !== null && dragIndex !== index
											? "bg-brand-faint ring-1 ring-primary/40"
											: "",
									)}
								>
									<GripVertical aria-hidden="true" className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
									<Input
										value={item.label}
										aria-label={`第 ${index + 1} 项的显示名`}
										placeholder="显示名(label)…"
										className="h-8 w-44 text-sm"
										onChange={(event) => setItem(index, { label: event.target.value })}
									/>
									<span aria-hidden="true" className="text-muted-foreground">
										=
									</span>
									<Input
										value={item.value}
										aria-label={`第 ${index + 1} 项的值`}
										placeholder="取值(value)…"
										translate="no"
										spellCheck={false}
										className="h-8 w-44 font-mono text-xs"
										onChange={(event) => setItem(index, { value: event.target.value })}
									/>
									<ActionButton
										aria-label={`删除第 ${index + 1} 项`}
										tone="danger"
										onClick={() => onChange({ ...values, items: values.items.filter((_, i) => i !== index) })}
									>
										删除
									</ActionButton>
								</div>
							))}
							{values.items.length === 0 ? (
								<p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
									还没有字典项(可以保存成空字典,之后再补)。
								</p>
							) : null}
						</div>
					</div>
				</DialogBody>

				{error ? (
					<Alert variant="danger" title="保存失败" className="mx-1">
						{error}
					</Alert>
				) : null}

				<DialogFooter className="shrink-0 gap-2">
					{editing ? (
						<DetailMeta meta={{ id: editing.id, createdAt: editing.createTime, updatedAt: editing.updateTime }} />
					) : null}
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					{/* 必填:名称 / 编码为空不能发出请求(与其余台账表单同口径) */}
					<Button
						disabled={pending || values.name.trim().length === 0 || values.code.trim().length === 0}
						onClick={onSubmit}
					>
						{pending ? "保存中…" : editing ? "保存" : "创建"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
