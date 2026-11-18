import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { ArrayReportTable } from "#/components/modules/task-close/array-report-table";
import {
	type ReportFieldLike,
	type ReportFile,
	textControlAttrs,
	textValueOf,
	type Value,
} from "#/components/modules/task-close/report-types";
import { AttachmentChip } from "#/components/modules/task-close/task-content-attachments";
import { useAttachmentPreview } from "#/components/modules/task-close/use-attachment-preview";
import { useAttachmentUpload } from "#/components/modules/task-close/use-attachment-upload";
import { useConfirm } from "#/components/modules/task-close/use-confirm";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DatePicker } from "#/components/ui/date-picker";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { isRecord } from "#/lib/task/json";
import { MAX_ATTACHMENTS } from "#/lib/task/payload";
import { MAX_ARRAY_ITEMS, updateKeyedItem } from "#/lib/task/report-spec";
import { formatLocalDate, parseLocalDateTime } from "#/lib/time";
import { cn } from "#/lib/utils";

function ClearButton({ label, onClear, className }: { label: string; onClear: () => void; className?: string }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
				"hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
				className,
			)}
			onClick={onClear}
		>
			<X className="size-3.5" />
		</button>
	);
}

/** 文本类输入框 —— 右侧内嵌「清空」(有值才出现);日期 / 选择类控件各自带原生图标,清空按钮放在外面 */
function ClearableInput({
	clearLabel,
	onClear,
	className,
	value,
	disabled,
	...props
}: React.ComponentProps<typeof Input> & { clearLabel: string; onClear: () => void }) {
	const filled = typeof value === "string" ? value !== "" : value != null;
	return (
		<div className="relative">
			<Input value={value} disabled={disabled} className={cn(filled && "pr-8", className)} {...props} />
			{filled && !disabled ? (
				<ClearButton label={clearLabel} onClear={onClear} className="absolute right-1 top-1/2 -translate-y-1/2" />
			) : null}
		</div>
	);
}

export function ReportField({
	taskId,
	field,
	value,
	disabled,
	invalid,
	files,
	arrayLayout = "form",
	onChange,
}: {
	/** 现签附件地址要用它(预览弹窗);只读预览不传 */
	taskId?: string;
	field: ReportFieldLike;
	value: Value | undefined;
	disabled: boolean;
	/** 校验点名了这个字段 —— 走 `aria-invalid`,与表单里的必填错同一套红 */
	invalid?: boolean;
	/** 附件字段要按 id 找文件名(reportGet 带回来的) */
	files?: readonly ReportFile[];
	/** 数组字段的排布 —— `table` 时整个数组渲染成表格(子任务的表单模式用,省空间) */
	arrayLayout?: "form" | "table";
	onChange: (value: Value) => void;
}) {
	/** 附件字段:选完即传,存 id 列表;展示用 reportGet 解析回来的文件名,点名字开预览 */
	if (field.type === "attachment")
		return (
			<ReportAttachmentField
				taskId={taskId}
				field={field}
				value={value}
				disabled={disabled}
				files={files}
				onChange={onChange}
			/>
		);
	/** 数组字段:元素是一组对象 —— 给「添加」按钮,一次加一个空对象再逐项填 */
	if (field.type === "array")
		return (
			<ReportArrayField
				taskId={taskId}
				field={field}
				value={value}
				disabled={disabled}
				invalid={invalid}
				files={files}
				layout={arrayLayout}
				onChange={onChange}
			/>
		);
	/** 文本类(文本 / 手机 / 邮箱 / 整数 / 小数):一个输入框 + 内嵌「清空」 */
	if (
		field.type === "text" ||
		field.type === "phone" ||
		field.type === "email" ||
		field.type === "integer" ||
		field.type === "decimal"
	) {
		const kind = field.type === "integer" || field.type === "decimal" ? "number" : "text";
		const text = Array.isArray(value) ? String(value) : textValueOf(value);
		return (
			<ClearableInput
				aria-label={field.label}
				aria-invalid={invalid || undefined}
				{...textControlAttrs(field)}
				value={text}
				disabled={disabled}
				clearLabel={`清空${field.label}`}
				onClear={() => onChange(null)}
				onChange={(event) => {
					const raw = event.target.value;
					onChange(raw === "" ? null : kind === "number" ? Number(raw) : raw);
				}}
			/>
		);
	}
	if (field.type === "multiselect") {
		const picked = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
		return (
			<div className="flex flex-wrap items-center gap-3">
				{field.options?.map((option) => (
					<span key={option} className="flex items-center gap-2 text-sm">
						<Checkbox
							aria-label={`${field.label}: ${option}`}
							checked={picked.includes(option)}
							disabled={disabled}
							onCheckedChange={(checked) =>
								onChange(checked ? [...picked, option] : picked.filter((item) => item !== option))
							}
						/>
						{option}
					</span>
				))}
				{picked.length > 0 ? <ClearButton label={`清空${field.label}`} onClear={() => onChange([])} /> : null}
			</div>
		);
	}
	if (field.type === "select") {
		const picked = typeof value === "string" ? value : "";
		/** 有值时「清空」顶掉触发器自己的箭头 —— 一个位置只放一个动作,窄表格里也不会挤 */
		const clearable = !!picked && !disabled;
		return (
			<div className="relative">
				<Select
					items={[
						...(field.allowEmpty ? [{ value: null, label: "（空）" }] : []),
						...(field.options ?? []).map((option) => ({ value: option, label: option })),
					]}
					value={picked || null}
					disabled={disabled}
					onValueChange={(next) => onChange(next ?? null)}
				>
					<SelectTrigger
						aria-label={field.label}
						aria-invalid={invalid || undefined}
						className={cn("w-full", clearable && "pr-8 [&>svg]:hidden")}
					>
						<SelectValue placeholder="请选择" />
					</SelectTrigger>
					<SelectContent>
						{field.allowEmpty && <SelectItem value={null}>（空）</SelectItem>}
						{field.options?.map((option) => (
							<SelectItem key={option} value={option}>
								{option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{clearable ? (
					<ClearButton
						label={`清空${field.label}`}
						onClear={() => onChange(null)}
						className="absolute right-1 top-1/2 -translate-y-1/2"
					/>
				) : null}
			</div>
		);
	}
	// 日期时间字段仍以 ISO 保存；日历按本地日期显示，修改时使用当天零点。
	const isDateTime = field.type === "datetime";
	const date = isDateTime ? formatLocalDate(value as string | null) : String(value ?? "");
	return (
		<DatePicker
			aria-label={field.label}
			aria-invalid={invalid || undefined}
			value={date}
			disabled={disabled}
			className="w-full min-w-36"
			onChange={(next) => onChange(!next ? null : isDateTime ? parseLocalDateTime(`${next}T00:00`) : next)}
		/>
	);
}

function ReportAttachmentField({
	taskId,
	field,
	value,
	disabled,
	files,
	onChange,
}: {
	taskId?: string;
	field: ReportFieldLike;
	value: Value | undefined;
	disabled: boolean;
	files?: readonly ReportFile[];
	onChange: (value: Value) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	/**
	 * **刚传上来的**那几个附件的名字与大小(按 id)。
	 *
	 * `reportGet.files` 是查询快照:上传只刷新文件列表,不会重取填报 —— 新附件的 id 不在里面,
	 * 于是文件名回退成 id、预览显示 0B(用户报过这个现象,尤其是同一批里后传的那个)。
	 * 上传结果本身就带 `originName / size`,就地记下来,不必等下一次查询。
	 */
	const [uploaded, setUploaded] = useState<Record<string, ReportFile>>({});
	/** 点文件名开预览(地址现签,按原始附件名下载) */
	const preview = useAttachmentPreview<ReportFile>(taskId);
	const ids = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
	/** 当前值的最新快照:上传是异步的,合并要基于**完成时**的 id 列表,不能用在 `await` 之前的 */
	const idsRef = useRef(ids);
	idsRef.current = ids;
	const { uploading, pick } = useAttachmentUpload({
		limit: MAX_ATTACHMENTS,
		existing: () => idsRef.current.length,
		onRows: (rows) => {
			// 多选要攒齐再写一次(逐个 onChange 会拿同一个旧值)
			const picked: string[] = [];
			const meta: Record<string, ReportFile> = {};
			for (const row of rows) {
				meta[row.id] = { id: row.id, name: row.originName, size: row.size, contentType: row.contentType };
				if (!idsRef.current.includes(row.id) && !picked.includes(row.id)) picked.push(row.id);
			}
			if (Object.keys(meta).length > 0) setUploaded((prev) => ({ ...prev, ...meta }));
			if (picked.length > 0) onChange([...idsRef.current, ...picked]);
		},
		resetInput: () => {
			if (inputRef.current) inputRef.current.value = "";
		},
	});
	const fileOf = (id: string): ReportFile =>
		files?.find((file) => file.id === id) ?? uploaded[id] ?? { id, name: id, size: 0, contentType: null };

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{ids.map((id) => (
				<AttachmentChip
					key={id}
					file={fileOf(id)}
					onPreview={() => preview.preview(fileOf(id))}
					onRemove={disabled ? undefined : () => onChange(ids.filter((item) => item !== id))}
				/>
			))}
			{disabled ? null : (
				<>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						aria-label={uploading ? "上传中" : `添加${field.label}`}
						title={uploading ? "上传中…" : "添加附件"}
						disabled={uploading || ids.length >= MAX_ATTACHMENTS}
						onClick={() => inputRef.current?.click()}
					>
						{uploading ? (
							<span className="size-3.5 animate-pulse rounded-full bg-primary/60" />
						) : (
							<Plus className="size-4" />
						)}
					</Button>
					<input
						ref={inputRef}
						type="file"
						multiple
						className="hidden"
						aria-label={`${field.label} 附件`}
						onChange={(event) => void pick(event.target.files)}
					/>
				</>
			)}
			{preview.dialog}
		</div>
	);
}

/** 数组字段 —— 元素是一组对象:点「添加」加一个空对象,再逐项填 */
function ReportArrayField({
	taskId,
	field,
	value,
	disabled,
	invalid,
	files,
	layout = "form",
	onChange,
}: {
	taskId?: string;
	field: ReportFieldLike;
	value: Value | undefined;
	disabled: boolean;
	invalid?: boolean;
	files?: readonly ReportFile[];
	/** `form` = 一项一框竖排;`table` = 整张数组渲染成表格(省空间) */
	layout?: "form" | "table";
	onChange: (value: Value) => void;
}) {
	const items = (Array.isArray(value) ? value : []).filter((item): item is Record<string, Value> => isRecord(item));
	/**
	 * 元素数组的**最新值**。附件上传是异步的(几秒),回调里若用发起时的 `items` 快照重建数组,
	 * 期间新增的元素会被整段抹掉 —— 现象就是「第二个元素里传的附件,上传完成却没保存上」。
	 * 写回一律从 `itemsRef.current` 起算;再往上的 `update()` 也是函数式更新,两层都不吃旧快照。
	 */
	const itemsRef = useRef(items);
	itemsRef.current = items;
	// 删除或异步上传需按行身份定位；按位置复用的 useStableKeys 无法保留删除后的身份。
	const itemKeysRef = useRef<string[]>(items.map(() => crypto.randomUUID()));
	while (itemKeysRef.current.length < items.length) itemKeysRef.current.push(crypto.randomUUID());
	if (itemKeysRef.current.length > items.length) itemKeysRef.current.length = items.length;
	const setItem = (itemKey: string, fieldKey: string, next: Value) => {
		if (!itemKeysRef.current.includes(itemKey)) return;
		onChange(
			updateKeyedItem(itemsRef.current, itemKeysRef.current, itemKey, (item) => ({ ...item, [fieldKey]: next })),
		);
	};
	const itemFields = field.itemFields ?? [];
	const itemKeys = itemKeysRef.current;
	/** 待确认删除的数组项 —— 用 itemKey 定位,避免确认期间数组顺序变化时误删 */
	const del = useConfirm<{ key: string; index: number }>();
	const removeItem = (itemKey: string) => {
		const index = itemKeysRef.current.indexOf(itemKey);
		if (index < 0) return;
		itemKeysRef.current = itemKeysRef.current.filter((key) => key !== itemKey);
		onChange(itemsRef.current.filter((_, i) => i !== index));
	};
	const addItem = () => {
		itemKeysRef.current = [...itemKeysRef.current, crypto.randomUUID()];
		onChange([...itemsRef.current, {}]);
	};
	const removeConfirm = (
		<del.Dialog
			title={`删除第 ${(del.target?.index ?? 0) + 1} 项`}
			description={() => "这一项会从当前数组草稿中移除；自动保存后无法撤销。"}
			onConfirm={(t) => {
				removeItem(t.key);
				del.dismiss();
			}}
		/>
	);
	/** 表格与竖排两个分支共用的「添加一项」按钮 */
	const addButton = disabled ? null : (
		<Button
			variant="outline"
			size="sm"
			className="justify-self-start"
			disabled={items.length >= MAX_ARRAY_ITEMS}
			onClick={addItem}
		>
			<Plus className="size-3.5" />
			添加
		</Button>
	);
	/** 数组整体渲染成表格 —— 表头一行是元素字段,每行一个元素(只读那侧同款口径) */
	if (layout === "table")
		return (
			<div className={cn("grid gap-2", invalid && "rounded-md ring-1 ring-destructive/40")}>
				{items.length === 0 ? <p className="text-xs text-muted-foreground">还没有数据,点下面「添加」。</p> : null}
				{items.length > 0 ? (
					<ArrayReportTable
						items={items}
						itemKeys={itemKeys}
						fields={itemFields}
						editable
						renderCell={(item, sub, index) => (
							<ReportField
								taskId={taskId}
								field={sub}
								value={item[sub.id]}
								disabled={disabled || sub.readOnly}
								files={files}
								onChange={(next) => setItem(itemKeys[index], sub.id, next)}
							/>
						)}
						renderAction={
							disabled
								? undefined
								: (index) => (
										<ActionButton
											tone="danger"
											aria-label={`删除第 ${index + 1} 项`}
											onClick={() => del.ask({ key: itemKeys[index], index })}
										>
											删除
										</ActionButton>
									)
						}
					/>
				) : null}
				{addButton}
				{removeConfirm}
			</div>
		);
	return (
		<div className={cn("grid gap-2", invalid && "rounded-md ring-1 ring-destructive/40")}>
			{items.length === 0 ? <p className="text-xs text-muted-foreground">还没有数据,点下面「添加」。</p> : null}
			{items.map((item, index) => (
				<div key={itemKeys[index]} className="grid gap-1.5 rounded-md border border-border p-2">
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-muted-foreground">第 {index + 1} 项</span>
						{disabled ? null : (
							<ActionButton
								tone="danger"
								aria-label={`删除第 ${index + 1} 项`}
								onClick={() => del.ask({ key: itemKeys[index], index })}
							>
								删除
							</ActionButton>
						)}
					</div>
					{itemFields.map((sub) => (
						<div key={sub.id} className="grid gap-1">
							<span className="text-xs text-muted-foreground">
								{sub.label}
								{sub.required ? " *" : ""}
							</span>
							<ReportField
								taskId={taskId}
								field={sub}
								value={item[sub.id]}
								disabled={disabled || sub.readOnly}
								files={files}
								onChange={(next) => setItem(itemKeys[index], sub.id, next)}
							/>
						</div>
					))}
				</div>
			))}
			{addButton}
			{removeConfirm}
		</div>
	);
}
