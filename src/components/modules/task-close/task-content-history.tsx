import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TaskAttachmentList } from "#/components/modules/task-close/task-content-attachments";
import { TaskLinkBlocks } from "#/components/modules/task-close/task-link-blocks";
import { Button } from "#/components/ui/button";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import type { TaskAttachment } from "#/lib/task-payload";
import { formatLocalMinute } from "#/lib/time";

export function TaskContentHistory({
	taskId,
	onOpenAttachment,
}: {
	taskId: string;
	onOpenAttachment: (attachment: TaskAttachment) => void;
}) {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const trpc = useTRPC();
	const history = useQuery({ ...trpc.taskClose.contentHistory.queryOptions({ taskId }), enabled: open });
	const current = history.data?.find((item) => item.id === selected) ?? history.data?.[0];
	return (
		<>
			<Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
				说明修订
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
					<DialogHeader>
						<DialogTitle>说明修订历史</DialogTitle>
						<DialogDescription>保留每次修改后的说明和附件快照。</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-4">
						{history.isPending ? (
							<p className="text-sm text-muted-foreground">加载中…</p>
						) : history.isError ? (
							<p className="text-sm text-destructive">无法加载修订历史。</p>
						) : (
							<>
								<div className="flex flex-wrap gap-2">
									{history.data.map((item) => (
										<Button
											key={item.id}
											size="sm"
											variant={current?.id === item.id ? "default" : "outline"}
											onClick={() => setSelected(item.id)}
										>
											版本 {item.revision}
										</Button>
									))}
								</div>
								{current && (
									<>
										<p className="text-xs text-muted-foreground">
											{current.actorName} ·{" "}
											{current.createdAt ? formatLocalMinute(current.createdAt) : PLACEHOLDER_EMPTY}
										</p>
										{current.description && <p className="whitespace-pre-wrap text-sm">{current.description}</p>}
										<TaskLinkBlocks links={current.links} />
										<TaskAttachmentList attachments={current.attachments} onOpen={onOpenAttachment} />
									</>
								)}
							</>
						)}
					</DialogBody>
				</DialogContent>
			</Dialog>
		</>
	);
}
