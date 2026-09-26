import { FileSpreadsheet, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/**
 * 文件拖拽上传区 —— 拖拽 / 点击选文件 + 校验 + 展示已选文件名。
 *
 * 只负责"把文件交出去",不负责解析:校验通过后回调,由调用方决定
 * `await file.arrayBuffer()` 之后干什么(解析表格 / 上传 / 预览图,用途各不相同)。
 *
 * **单文件用 `onFile`;多文件传 `multiple` + `onFiles`**(后者拿到的是**校验全通过**的那批,
 * 不合规的文件已被逐个 toast 拒绝、不会混进来)。`fileName` / `onClear` 是单文件那套的展示位;
 * 多选时由调用方自己列表展示 —— 它更清楚每行的进度与失败原因。
 *
 * `validate` 返回错误文案即拒绝该文件并 toast 提示;不传则只做大小校验(多选时逐个校验)。
 */

export function FileDropzone({
	onFile,
	onFiles,
	multiple = false,
	fileName,
	onClear,
	disabled = false,
	accept,
	maxSizeMb,
	/** 主文案,默认「把文件拖到这里,或点击选择」 */
	label,
	/** 副文案(格式 / 大小说明);不传则按 `accept` 与 `maxSizeMb` 自动生成 */
	hint,
	icon,
	validate,
	className,
}: {
	/** 校验通过后回调(单文件用这个) */
	onFile?: (file: File) => void | Promise<void>;
	/** 校验通过后回调(**多文件**用这个;`multiple` 为真时生效) */
	onFiles?: (files: File[]) => void;
	/** 允许多选 / 多拖(此时请用 `onFiles` 接收) */
	multiple?: boolean;
	/** 已选文件名(有值时展示"已选择"状态与清除按钮) */
	fileName?: string | null;
	onClear?: () => void;
	disabled?: boolean;
	/** input 的 accept,如 `.xlsx,.csv` */
	accept?: string;
	/** 单个文件大小上限(MB);不传则不限制 */
	maxSizeMb?: number;
	label?: ReactNode;
	hint?: ReactNode;
	/** 区内的提示图标,默认 `Upload` */
	icon?: ReactNode;
	/** 自定义校验:返回字符串表示拒绝(该字符串会 toast 出来) */
	validate?: (file: File) => string | null;
	className?: string;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [dragging, setDragging] = useState(false);

	const autoHint =
		accept || maxSizeMb
			? `支持 ${accept ?? "任意格式"}${maxSizeMb ? ` · 单个文件不超过 ${maxSizeMb}MB` : ""}${multiple ? " · 可多选" : ""}`
			: undefined;

	/** 逐个校验 —— **不合规的当场 toast 拒绝,合规的才交出去**(多选时不能因为一个坏文件丢一批) */
	function acceptFiles(list: FileList | null | undefined) {
		const picked = Array.from(list ?? []);
		if (picked.length === 0) return;
		const passed: File[] = [];
		for (const file of picked) {
			const rejected = validate?.(file);
			if (rejected) {
				toast.error(`${file.name}:${rejected}`);
				continue;
			}
			if (maxSizeMb !== undefined && file.size > maxSizeMb * 1024 * 1024) {
				toast.error(`${file.name}:不能超过 ${maxSizeMb}MB`);
				continue;
			}
			passed.push(file);
		}
		if (passed.length === 0) return;
		if (multiple) onFiles?.(passed);
		else void onFile?.(passed[0]);
	}

	return (
		<div className={cn("space-y-2", className)}>
			<button
				type="button"
				disabled={disabled}
				onClick={() => inputRef.current?.click()}
				onDragOver={(event) => {
					event.preventDefault();
					if (!disabled) setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					if (disabled) return;
					acceptFiles(event.dataTransfer.files);
				}}
				className={cn(
					"flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
					dragging ? "border-primary bg-primary/5" : "border-border hover:border-ring/60 hover:bg-secondary/50",
					disabled && "cursor-not-allowed opacity-60 hover:border-border hover:bg-transparent",
				)}
			>
				{icon ?? <Upload className="size-4 text-muted-foreground" />}
				<span className="text-sm text-foreground">
					{label ?? (
						<>
							把文件拖到这里,或<span className="text-primary">点击选择</span>
						</>
					)}
				</span>
				{(hint ?? autoHint) ? <span className="text-xs text-muted-foreground">{hint ?? autoHint}</span> : null}
			</button>

			<input
				ref={inputRef}
				type="file"
				accept={accept}
				multiple={multiple}
				className="hidden"
				onChange={(event) => {
					acceptFiles(event.target.files);
					// 允许连续选同一个文件(否则第二次 change 不触发)
					event.target.value = "";
				}}
			/>

			{fileName ? (
				<div className="flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-xs">
					<FileSpreadsheet className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate text-foreground">{fileName}</span>
					{onClear ? (
						<Button type="button" variant="ghost" size="icon-sm" aria-label="移除文件" onClick={onClear}>
							<X className="size-3.5" />
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
