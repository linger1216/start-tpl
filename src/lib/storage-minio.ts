/**
 * `Storage` 的 MinIO 实现 —— **只被 `#/lib/storage` 动态 import**,不要从业务代码直接引。
 *
 * ⚠️ 文件名是**扁平**的(`storage-minio.ts`)而不是 `storage/minio.ts`:后者会让
 * `#/lib/storage` 同时指向文件和目录,`tsc` 与 Nitro 的 ESM 解析各选一边,运行时才报
 * `Cannot find module '#/lib/storage'`(真实踩过,见 `doc/文件管理.md` 的排障表)。
 *
 * 与 `sys_file` / `doc/文件管理.md` 的对应关系:这里只负责"签 URL / 查元信息 / 删对象",
 * 元数据落库、白名单、大小校验、两阶段状态机都在路由层(`trpc/routers/file.ts`)。
 */
import { Client } from "minio";

import { logger } from "#/lib/logger";
import { joinPublicUrl, type PresignedPut, type Storage, type StoredObject } from "#/lib/storage";

type MinioConfig = {
	endpoint: string;
	port: number;
	useSSL: boolean;
	accessKey: string;
	secretKey: string;
	bucketPublic: string;
	bucketPrivate: string;
	publicUrl: string;
};

type Options = {
	defaultExpiresPut: number;
	publicExpiresGet: number;
};

/** MinIO 的 S3 错误:只有"对象不存在"该被吞掉,其余要往上抛 */
function isNotFound(error: unknown): boolean {
	const code = (error as { code?: string } | null)?.code ?? "";
	return code === "NotFound" || code === "NoSuchKey" || code === "NoSuchBucket";
}

/**
 * 对象存储这条链路**不经过 tRPC 的日志**,失败必须自己留一声。
 * 「上传签不出 URL / 确认时对象不在 / 删除失败」是线上最常见的三类问题,现象又都只是"操作没成功"。
 */
function logFailure(op: string, bucket: string, objectKey: string, error: unknown): never {
	logger.warn("storage.failed", {
		op,
		bucket,
		objectKey,
		message: error instanceof Error ? error.message : String(error),
	});
	throw error;
}

export function createMinioStorage(config: MinioConfig, options: Options): Storage {
	const client = new Client({
		endPoint: config.endpoint,
		port: config.port,
		useSSL: config.useSSL,
		accessKey: config.accessKey,
		secretKey: config.secretKey,
	});

	return {
		async presignPut(
			bucket,
			objectKey,
			_contentType,
			expiresSeconds = options.defaultExpiresPut,
		): Promise<PresignedPut> {
			// ⚠️ 预签名里**不绑 Content-Type**:绑了浏览器就得一模一样地发,少一个分号就 403。
			// 真实类型在 `confirm` 阶段用 `stat` 回读并写库(见 doc/文件管理.md「两阶段」)。
			try {
				const url = await client.presignedUrl("PUT", bucket, objectKey, expiresSeconds);
				return { url, expiresIn: expiresSeconds };
			} catch (error) {
				logFailure("presign_put", bucket, objectKey, error);
			}
		},

		async stat(bucket, objectKey): Promise<StoredObject | null> {
			try {
				const info = await client.statObject(bucket, objectKey);
				const meta = (info.metaData ?? {}) as Record<string, string>;
				return {
					size: Number(info.size ?? 0),
					contentType: meta["content-type"] ?? "application/octet-stream",
					etag: String(info.etag ?? ""),
				};
			} catch (error) {
				if (isNotFound(error)) return null;
				logFailure("stat", bucket, objectKey, error);
			}
		},

		async presignGet(bucket, objectKey, expiresSeconds = options.publicExpiresGet, downloadName): Promise<string> {
			// `response-content-disposition` 让"另存为"用回原始文件名(否则是 objectKey 那串 nanoid)。
			// 用 **RFC 5987/6266 的双保险**:`filename=` 给纯 ASCII 兜底、`filename*=` 给真名(百分号编码)——
			// 实测 MinIO 两种都认(单个 `filename*=` 也认,但老浏览器会退化成对象键)。
			let reqParams: Record<string, string> | undefined;
			if (downloadName) {
				// 纯 ASCII 就用原名当兜底,否则退化成 `download.<ext>`(只有 `filename*` 才是真名)
				const ascii = /^[\x20-\x7e]*$/.test(downloadName)
					? downloadName
					: `download${downloadName.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ""}`;
				reqParams = {
					"response-content-disposition": `attachment; filename="${ascii.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
				};
			}
			return await client.presignedGetObject(bucket, objectKey, expiresSeconds, reqParams).catch((error: unknown) => {
				logFailure("presign_get", bucket, objectKey, error);
			});
		},

		publicUrl(bucket, objectKey): string {
			const base = config.publicUrl || `${config.useSSL ? "https" : "http"}://${config.endpoint}:${config.port}`;
			return joinPublicUrl(base, bucket, objectKey);
		},

		async remove(bucket, objectKey): Promise<void> {
			try {
				await client.removeObject(bucket, objectKey);
			} catch (error) {
				// 幂等:清理任务会对同一 key 反复调,不存在不是错误
				if (!isNotFound(error)) logFailure("remove", bucket, objectKey, error);
			}
		},
	};
}
