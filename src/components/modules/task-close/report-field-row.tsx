import { Library, X } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ActionIconButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { TagInput } from "#/components/ui/tag-input";
import { mergeReportOptions } from "#/lib/task/report-spec";

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
	handle,
	index,
	field,
	typeOptions,
	dictionaries,
	dictionariesLoading,
	dictionariesError,
	showAllowEmpty,
	deriveId,
	onPatch,
	onRemove,
	removeDisabled,
}: {
	prefix: string;
	handle?: ReactNode;
	index: number;
	field: DraftFieldLike;
	typeOptions: readonly FieldTypeOption[];
	dictionaries: readonly { code: string; name: string; labels: string[] }[];
	dictionariesLoading: boolean;
	dictionariesError: boolean;
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
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{handle}
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
				<div className="grid gap-2">
					{dictionariesError && (
						<p role="alert" className="text-xs text-destructive">
							字典加载失败，请关闭后重试。
						</p>
					)}
					<TagInput
						value={field.options.map((value) => ({ value }))}
						onChange={(next) => onPatch({ options: next.map((entry) => entry.value) })}
						max={100}
						placeholder="选项,逗号分隔或逐条回车添加"
						trailingAction={
							<SearchSelect
								label={`${prefix} ${n} 从字典填入`}
								placeholder="从字典填入"
								triggerIcon={<Library className="size-4" aria-hidden />}
								description="将字典选项复制到当前字段；之后修改字典不会同步。"
								value={undefined}
								options={dictionaries.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))}
								loading={dictionariesLoading}
								disabled={dictionariesLoading || dictionariesError}
								emptyText="没有可用的字典"
								onValueChange={(code) => {
									const dictionary = dictionaries.find((item) => item.code === code);
									if (!dictionary) return;
									const options = mergeReportOptions(field.options, dictionary.labels);
									if (!options) {
										toast.error("填入后选项超过 100 项，请先减少选项");
										return;
									}
									onPatch({ options });
								}}
							/>
						}
					/>
				</div>
			) : null}
		</>
	);
}
