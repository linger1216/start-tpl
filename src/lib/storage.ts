/**
 * 对象存储的统一入口 —— MinIO 实现在服务端按需加载。
 *
 * 实现文件**刻意扁平命名**(`storage-minio.ts`,不放 `storage/` 子目录)—— 同名文件 + 同名目录
 *   会让 `tsc` 与 Nitro 的 ESM 解析**不一致**:前者选文件、后者当目录,运行时才炸
 *   `Cannot find module '#/lib/storage'`(真实踩过);
 * ⚠️ **`minio` SDK 只在服务端加载**(`getStorage()` 里 dynamic import)——
 *    客户端组件 import 本文件**不会**把 SDK 拖进浏览器包(与 `#/db` 同一条纪律)。
 *
 * 约定(全文见 `doc/文件管理.md`):
 *  · 字节存桶里,元数据存 `sys_file`;**永远不要存 URL** —— 要的时候当场签;
 *  · 公开桶(默认 `app-public`)匿名只读、可直链;私有桶(默认 `app-private`)只能预签名;
 *  · `objectKey = {yyyy}/{MM}/{nanoid}.{ext}`,**不用原文件名**(躲开中文 / 特殊字符 / 重名)。
 */
import { newId } from "#/lib/ids";

/** 桶的用途 —— 决定"公开直链"还是"预签名" */
type BucketKind = "public" | "private";

function readStorageConfig() {
	const endpoint = process.env.MINIO_ENDPOINT;
	const accessKey = process.env.MINIO_ACCESS_KEY;
	const secretKey = process.env.MINIO_SECRET_KEY;
	if (!endpoint || !accessKey || !secretKey) {
		throw new Error(
			"缺 MinIO 配置:请在 .env.local 填 MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY(键名见 .env.example)",
		);
	}
	return {
		endpoint,
		port: Number(process.env.MINIO_PORT ?? 9000),
		useSSL: (process.env.MINIO_USE_SSL ?? "false") === "true",
		accessKey,
		secretKey,
		bucketPublic: process.env.MINIO_BUCKET_PUBLIC ?? "app-public",
		bucketPrivate: process.env.MINIO_BUCKET_PRIVATE ?? "app-private",
		/** 对外访问前缀(反代 / CDN);留空则用 endpoint 拼 */
		publicUrl: process.env.MINIO_PUBLIC_URL ?? "",
	};
}

/** 桶名 —— 业务侧只说"公开还是私有",不写死桶名(换桶只改 env) */
export function bucketFor(kind: BucketKind): string {
	const config = readStorageConfig();
	return kind === "public" ? config.bucketPublic : config.bucketPrivate;
}

/** 这个桶是不是公开桶(决定 `url` 接口走直链还是预签名) */
export function isPublicBucket(bucket: string): boolean {
	return bucket === readStorageConfig().bucketPublic;
}

/**
 * 公开桶的直链(**同步**,不签名、不发请求);私有桶返回 `null`。
 *
 * 列表页用它出缩略图:一行一次签名既慢又会把一堆签名 URL 塞进响应,能直链的就直链。
 */
export function publicUrlOf(bucket: string, objectKey: string): string | null {
	const config = readStorageConfig();
	if (bucket !== config.bucketPublic) return null;
	const base = config.publicUrl || `${config.useSSL ? "https" : "http"}://${config.endpoint}:${config.port}`;
	return `${base.replace(/\/+$/, "")}/${bucket}/${objectKey}`;
}

/** `{yyyy}/{MM}/{nanoid}.{ext}` —— 按月分目录,避免单目录堆几万个对象 */
export function buildObjectKey(ext: string | null | undefined, at: Date = new Date(), prefix = ""): string {
	const year = at.getFullYear();
	const month = String(at.getMonth() + 1).padStart(2, "0");
	const clean = (ext ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
	const head = prefix ? `${prefix.replace(/^\/+|\/+$/g, "")}/` : "";
	return `${head}${year}/${month}/${newId()}${clean ? `.${clean}` : ""}`;
}

type MinioStorage = ReturnType<typeof import("#/lib/storage-minio").createMinioStorage>;
let cached: MinioStorage | null = null;

/**
 * 拿存储实现(进程内单例)。
 *
 * ⚠️ 这里是 **dynamic import**:`minio` 只有服务端走到这一行才会被加载,
 * 所以客户端组件即使 import 了本文件,包里也不会有 SDK。
 */
export async function getStorage(): Promise<MinioStorage> {
	if (cached) return cached;
	const { createMinioStorage } = await import("#/lib/storage-minio");
	cached = createMinioStorage(readStorageConfig());
	return cached;
}

/** 公开预览使用直链；私有文件和所有下载使用预签名地址。 */
export async function getObjectUrl(bucket: string, objectKey: string, downloadName?: string): Promise<string> {
	const directUrl = downloadName === undefined ? publicUrlOf(bucket, objectKey) : null;
	if (directUrl) return directUrl;
	return (await getStorage()).presignGet(bucket, objectKey, undefined, downloadName);
}
