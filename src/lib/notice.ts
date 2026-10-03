import { db } from "#/db";
import { sysNotice } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { logger } from "#/lib/logger";
import type { NoticeLevel } from "#/lib/notice-levels";

/**
 * 站内通知的**发送侧**(服务端专用)。
 *
 * 为什么不做公开的创建接口:站内通知不该被前端随便造 —— 发通知是**业务动作**
 * (审批通过了、任务跑完了、被指派了…),由服务端代码在那一刻调 `notify()` 即可。
 * 哪天真要给管理员一个"手动发通知"的入口,再加一个带权限点(`sys:notice:add`)的接口。
 *
 * 与 `lib/audit.ts` 的 `writeAudit` 同一个立场:**绝不抛** —— 通知失败不能影响业务。
 */

/**
 * 级别词表(`NOTICE_LEVELS` / 图标 / 长短标签)的**唯一真源**在 client-safe 的
 * `#/lib/notice-levels` —— 这里只转发类型,保持 `#/lib/notice` 这个既有引用路径不变
 * (本文件 import 了 `#/db`,客户端不能引它,要词表请直接引 `#/lib/notice-levels`)。
 */
export type { NoticeLevel };

type NoticePayload = {
	title: string;
	body?: string | null;
	/** 点击后跳转的**站内路径**,如 `/settings/files`;不传则点击只标已读 */
	path?: string | null;
	level?: NoticeLevel;
};

/**
 * 站内路径校验:必须以 `/` 开头,且只含路径安全字符。
 * 挡住 `javascript:` / `http://evil` / `//evil.com` 这类(通知的 path 是可以被数据携带的,
 * 所以它在**写入时**就要关门)。
 */
// ⚠️ `(?!\/)` 不能省:`//evil.example/x` 也是「以 / 开头 + 只含安全字符」,
//    但浏览器把它当**外部主机** —— 那就是开放跳转(实测被用例抓到)。
const NOTICE_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-/_.[\]]*$/;

function normalizePath(path: string | null | undefined): string | null {
	if (!path) return null;
	const trimmed = path.trim();
	return NOTICE_PATH_RE.test(trimmed) ? trimmed : null;
}

/** 给一个人发一条。**绝不抛** */
export async function notify(userId: string, payload: NoticePayload): Promise<void> {
	try {
		await db.insert(sysNotice).values({
			id: newId(),
			user_id: userId,
			title: payload.title.slice(0, 128),
			body: payload.body ? payload.body.slice(0, 255) : null,
			path: normalizePath(payload.path),
			level: payload.level ?? "info",
			read_at: null,
			create_time: new Date(),
		});
	} catch (error) {
		logger.warn("notice.write_failed", { userId, message: (error as Error).message });
	}
}

/**
 * 群发 —— 一条通知一个收件人,所以就是循环插行。
 * 模板场景够用;真要做"一条记录发给所有人 + 每人一份已读状态"再演进(那是另一张已读表)。
 */
export async function notifyMany(userIds: readonly string[], payload: NoticePayload): Promise<number> {
	let done = 0;
	for (const userId of userIds) {
		await notify(userId, payload);
		done += 1;
	}
	return done;
}
