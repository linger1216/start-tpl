import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTRPC } from "#/integrations/trpc/react";

/** 打开一条通知要的最少信息 —— 铃铛与台账页的行都满足 */
type OpenableNotice = { id: string; read: boolean; path: string | null };

/**
 * 「打开一条通知」—— **先标已读,再按 `path` 跳转**,跳不动就给一句提示(不白屏)。
 *
 * 这段语义原先在 `notification-bell.tsx` 与 `notice-page.tsx` 各写一遍,
 * 连错误文案都逐字相同。两处的差别只有铃铛会先 `setOpen(false)` 收起下拉 ——
 * 那是铃铛独有的下拉行为,留在调用点。
 *
 * ⚠️ **只覆盖「打开」这条**。台账页的「详情」按钮只标已读、不跳转(那是看内容不是跳走),
 * 它自己调 `useNoticeRead()`。
 */
export function useNoticeOpen(onRead?: () => void) {
	const trpc = useTRPC();
	const router = useRouter();
	const read = useMutation(trpc.notice.read.mutationOptions({ onSuccess: onRead }));

	return async (item: OpenableNotice) => {
		// 标已读失败(比如已被别处删掉)不拦跳转 —— 用户要的是「打开那个页面」
		if (!item.read) await read.mutateAsync({ id: item.id }).catch(() => {});
		if (!item.path) return;
		await router.navigate({ to: item.path }).catch(() =>
			// `path` 是数据携带的:写入时已校验,这里只是兜底(比如目标路由后来被删了)
			toast.error("这条通知的跳转地址已失效", { description: item.path }),
		);
	};
}

/** 「只标已读,不跳转」—— 台账页的「详情」用 */
export function useNoticeRead(onRead?: () => void) {
	const trpc = useTRPC();
	return useMutation(trpc.notice.read.mutationOptions({ onSuccess: onRead }));
}

/**
 * 「全部已读」—— 铃铛与台账页的按钮行为完全一样(含那句 toast),收在这里。
 *
 * `onDone` 是失效缓存的回调(各页面自己的 `invalidate`,口径不同:铃铛只失效 notice,
 * 台账页同理,但将来可能带上别的)。
 */
export function useNoticeReadAll(onDone?: () => void) {
	const trpc = useTRPC();
	return useMutation(
		trpc.notice.readAll.mutationOptions({
			onSuccess: async (outcome) => {
				await onDone?.();
				if (outcome.updated > 0) toast.success(`已把 ${outcome.updated} 条标为已读`);
			},
		}),
	);
}
