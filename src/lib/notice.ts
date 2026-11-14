import { newId } from "#/lib/ids";
import type { NoticeLevel } from "#/lib/notice-levels";
import { sendNotification } from "#/lib/notification";

export type { NoticeLevel };

type NoticePayload = {
	title: string;
	body?: string | null;
	path?: string | null;
	level?: NoticeLevel;
};

const NOTICE_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-/_.[\]]*$/;

export async function notifyMany(userIds: readonly string[], payload: NoticePayload): Promise<number> {
	const recipients = [...new Set(userIds)];
	if (!recipients.length) return 0;
	const path = payload.path?.trim() ?? "";
	// 指向任务详情的通知归到 `task.notice` 源,点开时能定位到具体任务。
	// 前缀在这里内联写死(不复用 `task/close-spec`):`notice` 可以在裁掉任务闭环的项目里单独保留,
	// 引过去会在派生时留下悬空依赖(`features.json` 的裁剪规则会拦下)。
	const taskId = path.startsWith("/task-close/") ? path.slice("/task-close/".length) : null;
	await sendNotification({
		type: taskId ? "task.notice" : "notice.manual",
		source: taskId ? { type: "task", id: taskId } : undefined,
		// 标题与正文都不在这里截:`slice` 按 UTF-16 码元切,前缀长度为奇数时会劈开 emoji 的代理对。
		// 标题交给 `createNotification` 按码点截到列宽;正文列是 `text`,装得下各调用点的上限
		// (手动通知 255、退回原因 2000)—— 在这里截到 255 会静默砍掉业务数据。
		title: payload.title,
		content: payload.body ?? null,
		payload: { path: NOTICE_PATH_RE.test(path) ? path : null, level: payload.level ?? "info" },
		dedupeKey: newId(),
		recipients: recipients.map((userId) => ({ userId, channel: "in_app" })),
	});
	return recipients.length;
}

export async function notify(userId: string, payload: NoticePayload): Promise<void> {
	await notifyMany([userId], payload);
}
