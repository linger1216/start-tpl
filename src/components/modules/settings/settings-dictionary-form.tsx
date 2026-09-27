import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
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
import { useStableKeys } from "#/hooks/use-stable-keys";
import type { DictFormValues, SettingsDictRow } from "./settings-dictionary-types";

/**
 * 字典编辑弹窗 —— 字典本身(名称 / 编码 / 说明 / 启停)+ **字典项表**。
 *
 * 字典项就是 `items = [{label, value}]`:label 是给人看的中文,value 是落库/程序里用的取值。
 * 数组顺序即下拉顺序,所以给了上移/下移(小字典,不用拖拽)。
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

	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= values.items.length) return;
		const items = [...values.items];
		const [moved] = items.splice(index, 1);
		if (moved) items.splice(target, 0, moved);
		onChange({ ...values, items });
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[52vh] flex-col sm:max-w-2xl">
				<DialogHeader className="shrink-0">
					<DialogTitle className="text-balance">{editing ? `编辑字典 · ${values.name}` : "新增字典"}</DialogTitle>
					<DialogDescription>
						字典是全系统共用的固定取值表(`sys_dict`):一个字典一行,字典项是 `label`(给人看)+ `value`(程序/落库用)。
					</DialogDescription>
				</DialogHeader>

				{/* 字段区自己滚 —— 弹窗本体永不出滚动条(高度铁律),与 settings-users-form 同形 */}
				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
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
								<div key={rowKeys[index]} className="flex flex-wrap items-center gap-1.5">
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
										aria-label={`第 ${index + 1} 项上移`}
										disabled={index === 0}
										onClick={() => move(index, -1)}
									>
										上移
									</ActionButton>
									<ActionButton
										aria-label={`第 ${index + 1} 项下移`}
										disabled={index === values.items.length - 1}
										onClick={() => move(index, 1)}
									>
										下移
									</ActionButton>
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
				</div>

				{error ? (
					<p
						role="alert"
						className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
					>
						{error}
					</p>
				) : null}

				{editing ? <DetailMeta meta={{ createdAt: editing.createTime, updatedAt: editing.updateTime }} /> : null}
				<DialogFooter className="shrink-0 gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={pending} onClick={onSubmit}>
						{pending ? "保存中…" : editing ? "保存" : "创建"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
