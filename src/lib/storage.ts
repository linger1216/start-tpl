/**
 * 对象存储的**统一入口** —— 业务只依赖这个接口,不直接认识 MinIO。
 *
 * 为什么要这层:① 换后端(MinIO → S3 / OSS)只改一个实现文件;
 * ② 实现文件**刻意扁平命名**(`storage-minio.ts`,不放 `storage/` 子目录)—— 同名文件 + 同名目录
 *   会让 `tsc` 与 Nitro 的 ESM 解析**不一致**:前者选文件、后者当目录,运行时才炸
 *   `Cannot find module '#/lib/storage'`(真实踩过);
 * ② ⚠️ **`minio` SDK 只在服务端加载**(`getStorage()` 里 dynamic import)——
 *    客户端组件 import 本文件**不会**把 SDK 拖进浏览器包(与 `#/db` 同一条纪律)。
 *
 * 约定(全文见 `doc/文件管理.md`):
 *  · 字节存桶里,元数据存 `sys_file`;**永远不要存 URL** —— 要的时候当场签;
 *  · 公开桶(默认 `app-public`)匿名只读、可直链;私有桶(默认 `app-private`)只能预签名;
 *  · `objectKey = {yyyy}/{MM}/{nanoid}.{ext}`,**不用原文件名**(躲开中文 / 特殊字符 / 重名)。
 */
import { newId } from "#/lib/ids";

export type PresignedPut = {
	/** 浏览器直接 PUT 的目标地址 */
	url: string;
	/** 有效期(秒)—— 客户端别把它当永久的 */
	expiresIn: number;
};

export type StoredObject = {
	size: number;
	contentType: string;
	etag: string;
};

export interface Storage {
	/** 签一个 PUT URL(浏览器直传用) */
	presignPut(bucket: string, objectKey: string, contentType?: string, expiresSeconds?: number): Promise<PresignedPut>;
	/** 查对象元信息;**不存在返回 null**(不抛异常,调用方好判断) */
	stat(bucket: string, objectKey: string): Promise<StoredObject | null>;
	/** 签一个 GET URL(私有桶预览 / 下载用);`downloadName` 会变成附件下载名 */
	presignGet(bucket: string, objectKey: string, expiresSeconds?: number, downloadName?: string): Promise<string>;
	/** 公开桶的直链(不带签名,可被浏览器 / CDN 缓存);私有桶**不要**用 */
	publicUrl(bucket: string, objectKey: string): string;
	/** 删对象;**不存在也算成功**(幂等,清理任务会反复调) */
	remove(bucket: string, objectKey: string): Promise<void>;
}

/** 桶的用途 —— 决定"公开直链"还是"预签名" */
type BucketKind = "public" | "private";

const DEFAULT_EXPIRES_PUT = 600; // 10 分钟:够慢网传一个大文件,又不至于被拿去长期占用
const DEFAULT_EXPIRES_GET = 300; // 5 分钟:够打开一个预览,泄漏窗口也小

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

/** 拼公开直链的**纯函数** —— `Storage.publicUrl` 与列表页共用,别两处各写一遍 */
export function joinPublicUrl(base: string, bucket: string, objectKey: string): string {
	return `${base.replace(/\/+$/, "")}/${bucket}/${objectKey}`;
}

/**
 * 公开桶的直链(**同步**,不签名、不发请求);私有桶返回 `null`。
 *
 * 列表页用它出缩略图:一行一次签名既慢又会把一堆签名 URL 塞进响应,能直链的就直链。
 */
export function publicUrlOf(bucket: string, objectKey: string): string | null {
	if (!isPublicBucket(bucket)) return null;
	const config = readStorageConfig();
	const base = config.publicUrl || `${config.useSSL ? "https" : "http"}://${config.endpoint}:${config.port}`;
	return joinPublicUrl(base, bucket, objectKey);
}

/** `{yyyy}/{MM}/{nanoid}.{ext}` —— 按月分目录,避免单目录堆几万个对象 */
export function buildObjectKey(ext: string | null | undefined, at: Date = new Date(), prefix = ""): string {
	const year = at.getFullYear();
	const month = String(at.getMonth() + 1).padStart(2, "0");
	const clean = (ext ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
	const head = prefix ? `${prefix.replace(/^\/+|\/+$/g, "")}/` : "";
	return `${head}${year}/${month}/${newId()}${clean ? `.${clean}` : ""}`;
}

let cached: Storage | null = null;

/**
 * 拿存储实现(进程内单例)。
 *
 * ⚠️ 这里是 **dynamic import**:`minio` 只有服务端走到这一行才会被加载,
 * 所以客户端组件即使 import 了本文件,包里也不会有 SDK。
 */
export async function getStorage(): Promise<Storage> {
	if (cached) return cached;
	const { createMinioStorage } = await import("#/lib/storage-minio");
	cached = createMinioStorage(readStorageConfig(), {
		publicExpiresGet: DEFAULT_EXPIRES_GET,
		defaultExpiresPut: DEFAULT_EXPIRES_PUT,
	});
	return cached;
}

export { DEFAULT_EXPIRES_GET, DEFAULT_EXPIRES_PUT };
