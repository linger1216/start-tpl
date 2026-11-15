import { X } from "lucide-react";
import { ActionIconButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { TagInput } from "#/components/ui/tag-input";

/** 字段类型下拉的一项(真源在 `lib/task/report-spec.ts`) */
type FieldTypeOption = { value: string; label: string };

/**
 * 字段行可编辑的最小形状 —— 顶层字段与数组元素字段共用(元素层没有 `allowEmpty`)。
 *
 * **公共形状只写这一份**:模板编辑器的顶层字段(`Field`)与元素字段(`ItemField`)都从它派生,
 * 之前三处各抄一遍字段集,加一个属性要改三处。
 */
export type DraftFieldLike = {
	id: string;
	idEdited: boolean;
	label: string;
	type: string;
	required: boolean;
	allowEmpty?: boolean;
	options: string[];
};

/**
 * 填报模板的一行字段控件:名称 / 标识 / 类型 / 必填(/ 允许为空)/ 删除 + 选项。
 *
 * 顶层字段与「数组内字段」结构逐行相同,差异只有三处,都由 props 表达:
 *  - `prefix`(aria 前缀:「字段」/「元素字段」)
 *  - `showAllowEmpty`(只有顶层有)
 *  - `onPatch` / `onRemove`(顶层改自己,元素层改父字段的 `itemFields`)
 *
 * 名称改动会顺手按拼音预填标识(除非用户手改过)—— 两层的预填规则一致,所以收在这里。
 */
export function ReportFieldRow({
	prefix,
	index,
	field,
	typeOptions,
	showAllowEmpty,
	deriveId,
	onPatch,
	onRemove,
	removeDisabled,
}: {
	prefix: string;
	index: number;
	field: DraftFieldLike;
	typeOptions: readonly FieldTypeOption[];
	showAllowEmpty?: boolean;
	/** 名称 → 标识(拼音预填);标识被手改过就不会调它 */
	deriveId: (label: string) => string;
	onPatch: (patch: Partial<DraftFieldLike>) => void;
	onRemove: () => void;
	removeDisabled: boolean;
}) {
	const n = index + 1;
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{n}</span>
				<Input
					aria-label={`${prefix} ${n} 名称`}
					placeholder="字段名称"
					value={field.label}
					className="h-8 min-w-32 flex-1"
					onChange={(event) => {
						const label = event.target.value;
						onPatch({ label, ...(field.idEdited ? {} : { id: deriveId(label) }) });
					}}
				/>
				<Input
					aria-label={`${prefix} ${n} 标识`}
					placeholder="自动生成,可修改"
					value={field.id}
					className="h-8 w-28 font-mono text-xs"
					onChange={(event) => onPatch({ id: event.target.value, idEdited: true })}
				/>
				<Select
					items={[...typeOptions]}
					value={field.type}
					onValueChange={(value) => onPatch({ type: value ?? "text" })}
				>
					<SelectTrigger aria-label={`${prefix} ${n} 类型`} size="sm" className="w-28">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{typeOptions.map((type) => (
							<SelectItem key={type.value} value={type.value}>
								{type.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Checkbox
						aria-label={`${prefix} ${n} 必填`}
						checked={field.required}
						onCheckedChange={(required) => onPatch({ required: required === true, allowEmpty: false })}
					/>
					必填
				</span>
				{showAllowEmpty && field.type === "select" ? (
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<Checkbox
							aria-label={`${prefix} ${n} 允许为空`}
							checked={field.allowEmpty === true}
							onCheckedChange={(allowEmpty) => onPatch({ allowEmpty: allowEmpty === true, required: false })}
						/>
						允许为空
					</span>
				) : null}
				<ActionIconButton label={`删除${prefix} ${n}`} tone="danger" disabled={removeDisabled} onClick={onRemove}>
					<X className="size-3.5" />
				</ActionIconButton>
			</div>
			{field.type === "select" || field.type === "multiselect" ? (
				<TagInput
					value={field.options.map((value) => ({ value }))}
					onChange={(next) => onPatch({ options: next.map((entry) => entry.value) })}
					max={100}
					placeholder="选项,逗号分隔或逐条回车添加"
				/>
			) : null}
		</>
	);
}
