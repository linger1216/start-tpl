import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { FileRow } from "#/components/modules/settings/settings-files-table";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/**
 * 一条文件上传的公用链路:`算 hash → presign(含秒传短路)→ XHR 直传(带进度)→ confirm`。
 *
 * 为什么抽出来:上传对话框(文件管理)与头像字段要用**同一条**逻辑 ——
 * 底层步骤(直传必须用 `XMLHttpRequest` 才有进度、hash 必须在 presign **之前**算好才能秒传)
 * 藏在这个 hook 里,调用方只说"把这个文件传上去"。
 *
 * 秒传:hash 命中同桶同后缀的已有文件时,服务端**不会再签发上传地址**,直接给一条就绪的记录 ——
 * 这里表现为 `instant: true`、**一个字节都不发**。
 */

type UploadKind = "public" | "private";

type UploadResult = { ok: true; instant: boolean; row: FileRow } | { ok: false; message: string };

/** 算文件内容的 sha256(64 位十六进制)。失败返回 undefined —— hash 是可选元数据,不该拦住上传 */
async function sha256Of(file: File): Promise<string | undefined> {
	try {
		const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
		return Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
	} catch {
		return undefined;
	}
}

/**
 * 直传并回报进度 —— **必须用 XHR**(`fetch` 没有上传进度事件)。
 * 模块私有:`useFileUpload()` 是唯一入口,调用方只管"把这个文件传上去"。
 */
function putWithProgress(url: string, file: File, onPercent: (percent: number) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url);
		xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onPercent(Math.round((event.loaded / event.total) * 100));
		};
		xhr.onload = () =>
			xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`直传失败(${xhr.status})`));
		xhr.onerror = () => reject(new Error("直传失败(网络 / CORS)"));
		xhr.send(file);
	});
}

export function useFileUpload() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const presign = useMutation(trpc.file.presign.mutationOptions());
	const confirm = useMutation(trpc.file.confirm.mutationOptions());

	const upload = useCallback(
		async (file: File, kind: UploadKind, onPercent?: (percent: number) => void): Promise<UploadResult> => {
			try {
				// hash 必须在 presign **之前** —— 服务端要靠它判断能不能秒传
				const hash = await sha256Of(file);
				const ticket = await presign.mutateAsync({
					name: file.name,
					size: file.size,
					contentType: file.type || undefined,
					kind,
					hash,
				});

				let row = ticket.file;
				if (!ticket.instant || !row) {
					// 秒传路径没有 uploadUrl:有就是正常上传,照旧直传 + 确认
					if (!ticket.uploadUrl) throw new Error("服务端没有给出上传地址");
					await putWithProgress(ticket.uploadUrl, file, onPercent ?? (() => {}));
					row = await confirm.mutateAsync({ bucket: ticket.bucket, objectKey: ticket.objectKey, hash });
				}

				await queryClient.invalidateQueries(trpc.file.pathFilter());
				if (!row) throw new Error("上传完成但没拿到文件记录");
				return { ok: true, instant: ticket.instant, row };
			} catch (error) {
				return { ok: false, message: toApiError(error).message };
			}
		},
		[trpc, presign, confirm, queryClient],
	);

	return { upload };
}
