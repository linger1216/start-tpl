import { Check, FileText, HardDrive, Plus, X, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { FileDropzone } from "#/components/ui/file-dropzone";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useFileUpload } from "#/hooks/use-file-upload";
import { useParaRaw } from "#/hooks/use-para-prefs";
import { formatBytes } from "#/lib/format";
import { FILE_ALLOW_EXT_DEFAULT, FILE_MAX_SIZE_MB_DEFAULT } from "#/lib/para-spec";

/**
 * 上传文件(**支持一次多个 + 秒传**)—— 具体链路在 `hooks/use-file-upload` 里,这里只排队列与展示状态。
 *
 * 秒传:hash 命中同桶同后缀的已有文件时,服务端不会签发上传地址 ⇒ **一个字节都不发**,
 * 队列行直接标「秒传」。多文件**顺序**传;单个失败不中断其余,失败原因留在行上、可原地重试。
 */
type QueueStatus = "wait" | "doing" | "done" | "error";

type QueueItem = {
	/** 行标识:File 对象本身不稳定,用自增序号 */
	id: number;
	file: File;
	percent: number;
	status: QueueStatus;
	/** 这次是秒传命中的(服务端已有同 hash 的对象) */
	instant?: boolean;
	/** 秒传复用到的是哪个已有文件(提示用;秒传是「返回已存在那一行」,不会新建记录) */
	reusedFrom?: string;
	error?: string;
};

/**
 * 桶的 `{ value, label }` 列表 —— **同一份**同时喂给 `<Select items>` 与 `<SelectItem>`。
 *
 * ⚠️ 两边都要:Base UI **不会**从 `<SelectItem>` 子元素收集 label(Radix / shadcn 才会),
 * 只给子元素时触发器画出原始 value(实测这里画的是 `private`);而只给 `items`、
 * 不写 `SelectTrigger/Value/Content`,触发器就是**空的**(实测过)。
 */
const BUCKET_ITEMS = [
	{ value: "private", label: "私有桶 —— 只能拿预签名地址看(附件默认)" },
	{ value: "public", label: "公开桶 —— 可直链、能被缓存(头像 / 图标)" },
];

const STATUS_TEXT: Record<QueueStatus, string> = { wait: "待上传", doing: "上传中", done: "已完成", error: "失败" };

export function SettingsFilesUpload({
	open,
	onOpenChange,
	onDone,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onDone: () => void;
}) {
	const { upload } = useFileUpload();
	const [items, setItems] = useState<QueueItem[]>([]);
	const [kind, setKind] = useState<"public" | "private">("private");
	const [busy, setBusy] = useState(false);

	// 策略来自参数管理。兜底值与后端 `readPolicy()`、参数管理页的 `PARA_DEFAULTS` 共用
	// `lib/para-spec.ts` 里那两份常量 —— 各写一遍字面量的年代已经过去了。
	// `file.allow_ext` 留空 = 不限制类型:不给出 accept/白名单提示,收所有后缀。
	const allowExt = useParaRaw("file.allow_ext");
	const maxSize = useParaRaw("file.max_size_mb");
	const acceptRaw = allowExt === undefined ? FILE_ALLOW_EXT_DEFAULT : allowExt;
	const accept = acceptRaw
		.split(",")
		.map((v) => v.trim().replace(/^\./, "").toLowerCase())
		.filter(Boolean)
		.map((ext) => `.${ext}`)
		.join(",");
	const maxSizeMb = Number(maxSize || FILE_MAX_SIZE_MB_DEFAULT);

	const working = busy || items.some((item) => item.status === "doing");
	const waiting = items.filter((item) => item.status === "wait" || item.status === "error");
	const uploaded = items.filter((item) => item.status === "done").length;

	/** 加法式入队:同名同大小的重复选择直接忽略(连续拖两次同一个文件不该排队两遍) */
	function addFiles(files: File[]) {
		setItems((prev) => {
			const seen = new Set(prev.map((item) => `${item.file.name}:${item.file.size}`));
			let nextId = prev.reduce((max, item) => Math.max(max, item.id), 0);
			const added: QueueItem[] = [];
			for (const file of files) {
				const key = `${file.name}:${file.size}`;
				if (seen.has(key)) continue;
				seen.add(key);
				added.push({ id: ++nextId, file, percent: 0, status: "wait" });
			}
			return [...prev, ...added];
		});
	}

	const patch = (id: number, changes: Partial<QueueItem>) =>
		setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));

	/** 顺序上传所有待上传行;单个失败只标它自己,继续下一个 */
	async function handleUpload() {
		const targets = items.filter((item) => item.status === "wait" || item.status === "error");
		if (targets.length === 0) {
			toast.error("先选文件");
			return;
		}
		setBusy(true);
		let ok = 0;
		let instant = 0;
		let failed = 0;
		for (const item of targets) {
			patch(item.id, { status: "doing", percent: 0, error: undefined, instant: undefined });
			const result = await upload(item.file, kind, (percent) => patch(item.id, { percent }));
			if (result.ok) {
				patch(item.id, {
					status: "done",
					percent: 100,
					instant: result.instant,
					reusedFrom: result.instant ? result.row.originName : undefined,
				});
				ok += 1;
				if (result.instant) instant += 1;
			} else {
				patch(item.id, { status: "error", percent: 0, error: result.message });
				failed += 1;
			}
		}
		setBusy(false);

		const suffix = instant > 0 ? `(${instant} 个内容相同,已秒传、未重复上传)` : "";
		if (failed === 0) {
			toast.success(`已上传 ${ok} 个文件`, { description: `已写入对象存储并登记${suffix}` });
		} else {
			toast.error(`成功 ${ok} 个,失败 ${failed} 个`, { description: "失败原因在每行上,可直接重试" });
		}
		if (ok > 0) {
			setItems((prev) => prev.filter((item) => item.status !== "done"));
			onDone();
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>上传文件</DialogTitle>
					<DialogDescription>
						可一次选多个;文件直接从浏览器传到对象存储,不经过应用服务器。内容相同的文件会**秒传**(不重复传字节)。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<FileDropzone
						multiple
						accept={accept}
						maxSizeMb={maxSizeMb}
						disabled={working}
						onFiles={addFiles}
						label={
							<>
								把文件拖到这里,或<span className="text-primary">点击选择</span>
								<span className="ml-1 text-muted-foreground">(可多选)</span>
							</>
						}
					/>

					{items.length > 0 ? (
						<div className="space-y-1">
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>
									共 {items.length} 个{uploaded > 0 ? `(已完成 ${uploaded})` : ""}
								</span>
								<span className="tabular-nums">
									合计 {formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))}
								</span>
							</div>
							{/* 队列自己滚(弹窗本身不滚) */}
							<ul className="max-h-48 space-y-1 overflow-auto pr-1">
								{items.map((item) => (
									<li key={item.id} className="flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5">
										<FileText className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate text-xs text-foreground">{item.file.name}</span>
										<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
											{formatBytes(item.file.size)}
										</span>
										{/* 状态格宽度固定,免得每行文字长短不一来回跳 */}
										{item.status === "doing" ? (
											<span className="flex w-24 shrink-0 items-center gap-1.5">
												<span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
													<span
														className="block h-full rounded-full bg-primary transition-[width] duration-200"
														style={{ width: `${item.percent}%` }}
													/>
												</span>
												<span className="w-7 text-right text-xs text-muted-foreground tabular-nums">
													{item.percent}%
												</span>
											</span>
										) : (
											<span
												className={
													item.status === "error"
														? "w-24 shrink-0 truncate text-right text-xs text-destructive"
														: "w-24 shrink-0 text-right text-xs text-muted-foreground"
												}
												title={
													item.error ??
													(item.reusedFrom ? `已存在相同内容:${item.reusedFrom}` : STATUS_TEXT[item.status])
												}
											>
												{item.status === "done" ? (
													<span className="inline-flex items-center gap-0.5">
														{item.instant ? <Zap className="size-3" /> : <Check className="size-3" />}
														{item.instant ? "已存在" : STATUS_TEXT.done}
													</span>
												) : (
													(item.error ?? STATUS_TEXT[item.status])
												)}
											</span>
										)}
										{item.status === "wait" || item.status === "error" ? (
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												aria-label={`移除 ${item.file.name}`}
												disabled={working}
												onClick={() => setItems((prev) => prev.filter((row) => row.id !== item.id))}
											>
												<X className="size-3.5" />
											</Button>
										) : null}
									</li>
								))}
							</ul>
						</div>
					) : null}

					<div className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">全部存到哪个桶</span>
						<Select items={BUCKET_ITEMS} value={kind} onValueChange={(next) => setKind(next as "public" | "private")}>
							<SelectTrigger id="file-bucket" size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{BUCKET_ITEMS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<DialogFooter>
					{uploaded > 0 ? (
						<Button variant="outline" onClick={() => setItems([])} disabled={working}>
							清空已完成
						</Button>
					) : null}
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
						取消
					</Button>
					<Button onClick={() => void handleUpload()} disabled={working || waiting.length === 0}>
						{working ? <HardDrive className="size-3.5 animate-pulse" /> : <Plus className="size-3.5" />}
						{working ? "上传中…" : waiting.length > 0 ? `上传 ${waiting.length} 个文件` : "上传文件"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
