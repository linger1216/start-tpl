import { toast } from "sonner";

import { toApiError } from "#/lib/api/error";

/**
 * 写接口（create / update / remove）的**统一收尾样板**。
 *
 * 台账页过去每页每动作手抄一遍「onSuccess: await invalidate → 关弹窗 → toast.success;
 * onError → toast.error(toApiError)」,十几页十几份;抽成两个函数之后,
 * 「写完失效哪些查询」「失败时吐司长什么样」只在这一个文件里定义。
 *
 * 用法(不包 useMutation,`mutationOptions` 的类型推断原样保留):
 * ```ts
 * const updateMutation = useMutation(
 * 	trpc.user.update.mutationOptions({
 * 		onSuccess: writeSuccess(invalidate, { close: () => setEditing(null), message: (u) => `已保存 ${u.name}` }),
 * 		onError: writeError,
 * 	}),
 * );
 * ```
 *
 * 有额外副作用的 onSuccess(如导入整批失败要留在对话框里展示)不走这里,原样手写。
 */

/** 统一的错误吐司 —— 各页 onError 的唯一写法 */
export function writeError(error: unknown): void {
	toast.error(toApiError(error).message);
}

type WriteSuccessOptions<T> = {
	close?: (data: T) => void;
	message?: (data: T) => string;
	description?: (data: T) => string;
};

/**
 * 统一的成功收尾:先失效本路由的查询,再关弹窗、吐司。
 * 传了 `message` 才吐司(像「导出后静默刷新」这类不说话的成功,不传即可)。
 */
export function writeSuccess<T>(
	invalidate: () => void | Promise<void>,
	opts: WriteSuccessOptions<T> = {},
): (data: T) => Promise<void> {
	return async (data: T) => {
		await invalidate();
		opts.close?.(data);
		const message = opts.message?.(data);
		if (message) toast.success(message, { description: opts.description?.(data) });
	};
}
