import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MultiSelect } from "#/components/modules/shared/multi-select";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { NOTICE_LEVELS, type NoticeLevel } from "#/lib/notice-levels";

/** ⚠️ `items` 与 `<SelectItem>` **两边都要给**(Base UI 不从子元素收集 label,踩过) */
export type NoticeFormPayload = {
	userIds: string[];
	title: string;
	body?: string;
	path?: string;
	level: NoticeLevel;
};

/**
 * 手动发通知(**需要 `sys:notice:add`** —— 服务端由 `PERM_BY_PATH` 强制,前端只是不显示入口)。
 *
 * 一条通知一个收件人,所以是"选人 + 一次插多行";候选名单用 `MultiSelect`
 * (它的候选列表按原顺序不动、最多渲染 50 条 —— 与部门 / 角色那几处的口径一致)。
 */
export function NoticeForm({
	open,
	onOpenChange,
	pending,
	userOptions,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	userOptions: Array<{ value: string; label: string; hint?: string }>;
	onSubmit: (payload: NoticeFormPayload) => void;
}) {
	const [userIds, setUserIds] = useState<string[]>([]);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [path, setPath] = useState("");
	const [level, setLevel] = useState<NoticeLevel>("info");

	function submit() {
		if (userIds.length === 0) {
			toast.error("至少要选一个收件人");
			return;
		}
		if (!title.trim()) {
			toast.error("标题不能为空");
			return;
		}
		onSubmit({
			userIds,
			title: title.trim(),
			body: body.trim() || undefined,
			path: path.trim() || undefined,
			level,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader className="shrink-0">
					<DialogTitle>发通知</DialogTitle>
					<DialogDescription>
						选人 → 写标题 → 可选填一条**站内路径**,对方点开就能跳到那个页面(必须以 / 开头)。
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-1 py-1">
					<DetailRow label="收件人(可多选)">
						<div className="flex min-h-36 flex-col">
							<MultiSelect
								options={userOptions}
								value={userIds}
								onChange={setUserIds}
								fill
								placeholder="搜索姓名 / 邮箱…"
							/>
						</div>
					</DetailRow>
					<DetailRow label="标题" htmlFor="notice-title">
						<Input
							id="notice-title"
							className="h-8 text-sm"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="例如:有 3 个账号还没分配角色"
						/>
					</DetailRow>
					<DetailRow label="正文(可选)" htmlFor="notice-body">
						<Input
							id="notice-body"
							className="h-8 text-sm"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="一句话说明,最长 255 字"
						/>
					</DetailRow>
					<DetailRow label="跳转路径(可选)" htmlFor="notice-path">
						<Input
							id="notice-path"
							className="h-8 font-mono text-sm"
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="/settings/users"
						/>
					</DetailRow>
					<DetailRow label="类型">
						<Select items={NOTICE_LEVELS} value={level} onValueChange={(next) => setLevel(next as NoticeLevel)}>
							<SelectTrigger id="notice-level" size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{NOTICE_LEVELS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>
				</DialogBody>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button onClick={submit} disabled={pending}>
						<Plus className="size-3.5" />
						{pending ? "发送中…" : `发给 ${userIds.length > 0 ? userIds.length : ""} 个人`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
