import { ArrowRight, Check, Lock, Paperclip, ReplyIcon, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { useFileUpload } from "#/hooks/use-file-upload";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { formatLocalMinute } from "#/lib/time";
import { cn } from "#/lib/utils";

/**
 * 流程脊 —— 这一页的**状态骨架**:把模板里的状态链横着铺开,标出「走过的 / 当前 / 未到」,
 * 走过的节点带首次到达时刻,当前节点在锁定期画成带锁的 `warn` 节点。
 *
 * ⚠️ **这里不放动作**。状态类按钮(发起审批 / 改状态)按用户要求留在**记录头右上角**的动作组里
 * (见 `task-close-detail-page.tsx` 与 `doc/task-close.md` 的「按钮去向」)—— 脊只回答「走到哪了」。
 * 同一个入口别在两处各握一半,否则人会来回找。
 */
export function TaskFlowSpine({
	statuses,
	current,
	visited,
	reachedAt,
	locked,
}: {
	statuses: WorkflowStatus[];
	current: string;
	/** 走过的状态(**不含**当前态) */
	visited: Set<string>;
	/** 状态 value → 首次到达时刻(ISO);给走过的节点当注脚 */
	reachedAt: Map<string, string>;
	/** 任务被未完成的审批动作锁住 —— 当前节点画成带锁的警示节点 */
	locked: boolean;
}) {
	return (
		<ol className="flex flex-wrap items-start gap-x-2 gap-y-3">
			{statuses.map((status, index) => {
				const isCurrent = status.value === current;
				const isVisited = !isCurrent && visited.has(status.value);
				const at = reachedAt.get(status.value);
				return (
					<li key={status.value} className="flex items-start gap-x-2">
						<span
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm",
								isCurrent
									? locked
										? "border-warn/40 bg-warn-soft font-semibold text-warn-fg"
										: "border-primary/40 bg-primary/5 font-semibold text-primary"
									: isVisited
										? "border-border text-muted-foreground"
										: "border-dashed border-border text-muted-foreground",
							)}
						>
							{isCurrent && locked ? (
								<Lock className="size-3 shrink-0" aria-hidden />
							) : isVisited ? (
								<Check className="size-3 shrink-0" aria-hidden />
							) : (
								<span
									aria-hidden
									className={cn("size-1.5 shrink-0 rounded-full", isCurrent ? "bg-current" : "bg-border")}
								/>
							)}
							{status.label}
							{at ? <span className="text-xs tabular-nums text-muted-foreground">{formatLocalMinute(at)}</span> : null}
						</span>
						{index < statuses.length - 1 ? (
							<ArrowRight className="mt-2 size-3.5 shrink-0 text-border" aria-hidden />
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

/** 动作条里的一条待办 —— 文案由页面拼(页面才有状态 label) */
export type TodoItem = {
	id: string;
	/** 一句话,如「甲 发起 进行中 → 待核验」;征询是「甲 发起征询」 */
	title: string;
	/** 「待答复」/「已发起」 */
	stateLabel: string;
	/** 只有「待答复」的能通过 / 驳回 / 回复 */
	actionable: boolean;
	/** **征询**不摊通过 / 驳回,只出「回复」(意见落成评论) */
	consult: boolean;
};

/** 待上传的回复附件(选完即传,与评论区同一 `useFileUpload` 链路) */
type ReplyFile = { id: string; name: string };
const MAX_REPLY_FILES = 10;

/**
 * 「轮到你了」动作条 —— 横向一条,就地处理指给**我**的动作。
 *
 * 两种形态(`todo.consult` 分流,同一处理入口不两处握半截):
 *  - **审批**(用户说"审批"):「通过 / 驳回」,驳回要走弹窗填原因;
 *  - **征询**:只有「回复」—— 意见 + 附件就地展开一个小输入行,提交后**意见直接落成一条评论**,
 *    动作即算处理完(征询不是审批,"通过"这个说法在这里没有意义)。
 */
export function TaskTodoStrip({
	items,
	busy,
	replyBusy,
	onApprove,
	onReject,
	onReply,
}: {
	items: TodoItem[];
	busy: boolean;
	replyBusy: boolean;
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
	onReply: (id: string, content: string, attachments: string[]) => void;
}) {
	const { upload } = useFileUpload();
	const fileRef = useRef<HTMLInputElement | null>(null);
	const [replyFor, setReplyFor] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [files, setFiles] = useState<ReplyFile[]>([]);
	const [uploading, setUploading] = useState(false);

	if (items.length === 0) return null;

	function openReply(id: string) {
		setReplyFor((prev) => (prev === id ? null : id));
		setText("");
		setFiles([]);
	}

	async function pickReplyFiles(list: FileList | null) {
		if (!list || list.length === 0) return;
		setUploading(true);
		try {
			for (const file of Array.from(list).slice(0, MAX_REPLY_FILES - files.length)) {
				const result = await upload(file, "private");
				if (!result.ok) {
					toast.error(result.message);
					continue;
				}
				setFiles((prev) => [...prev, { id: result.row.id, name: result.row.originName }]);
			}
		} finally {
			setUploading(false);
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	function submitReply(id: string) {
		if (!text.trim() || uploading || replyBusy) return;
		onReply(
			id,
			text.trim(),
			files.map((file) => file.id),
		);
		setReplyFor(null);
		setText("");
		setFiles([]);
	}

	return (
		<section className="grid gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3.5 py-3">
			<div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold tracking-wide text-warn-fg">
				<TriangleAlert className="size-3.5 shrink-0" aria-hidden />
				轮到你了 · {items.length} 项
			</div>
			<ul className="grid gap-2">
				{items.map((item) => (
					<li key={item.id} className="grid gap-1.5 text-sm">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
							<span className="inline-flex items-center gap-1.5">
								<span
									className={cn(
										"inline-flex h-[18px] items-center rounded px-1.5 text-xs font-semibold",
										item.actionable ? "bg-warn-fg/10 text-warn-fg" : "bg-foreground/5 text-muted-foreground",
									)}
								>
									{item.stateLabel}
								</span>
								<span className="text-foreground">{item.title}</span>
							</span>
							{item.actionable && !item.consult ? (
								<span className="inline-flex items-center gap-2">
									<Button size="sm" disabled={busy} onClick={() => onApprove(item.id)}>
										通过
									</Button>
									<ActionButton tone="danger" disabled={busy} onClick={() => onReject(item.id)}>
										驳回
									</ActionButton>
								</span>
							) : null}
							{item.actionable && item.consult ? (
								<Button size="sm" variant="outline" disabled={replyBusy} onClick={() => openReply(item.id)}>
									<ReplyIcon className="size-3.5" />
									回复
								</Button>
							) : null}
						</div>
						{/* 征询的回复就一行:意见 + 附件 → 提交后意见落成一条评论,动作即结 */}
						{item.actionable && item.consult && replyFor === item.id ? (
							<div className="rounded-lg border border-border bg-card focus-within:ring-2 focus-within:ring-ring/40">
								<textarea
									rows={2}
									value={text}
									onChange={(event) => setText(event.target.value)}
									placeholder="把意见写在这里,发表后进评论区…"
									aria-label="回复意见"
									className="block w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground"
								/>
								{files.length > 0 ? (
									<div className="flex flex-wrap gap-1.5 px-3 pt-2">
										{files.map((file) => (
											<span
												key={file.id}
												className="inline-flex max-w-64 items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
											>
												<span className="truncate">{file.name}</span>
												<button
													type="button"
													aria-label={`移除 ${file.name}`}
													className="text-muted-foreground hover:text-foreground"
													onClick={() => setFiles((prev) => prev.filter((row) => row.id !== file.id))}
												>
													<X className="size-3" />
												</button>
											</span>
										))}
									</div>
								) : null}
								<div className="flex items-center justify-between gap-2 px-3 py-2">
									<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
										<Paperclip className="size-3.5" aria-hidden />
										<input
											ref={fileRef}
											type="file"
											multiple
											className="w-44 text-xs text-muted-foreground file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-xs hover:file:bg-muted/70"
											aria-label="选择回复附件"
											onChange={(event) => void pickReplyFiles(event.target.files)}
										/>
										{uploading ? "上传中…" : null}
									</span>
									<span className="inline-flex items-center gap-2">
										<Button size="sm" variant="ghost" disabled={replyBusy} onClick={() => openReply(item.id)}>
											取消
										</Button>
										<Button
											size="sm"
											disabled={replyBusy || uploading || text.trim().length === 0}
											onClick={() => submitReply(item.id)}
										>
											{replyBusy ? "发表中…" : "发表"}
										</Button>
									</span>
								</div>
							</div>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}
