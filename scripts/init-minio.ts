/**
 * MinIO 初始化 —— 幂等,可重复跑:建两个桶 + 公开桶匿名只读 + 私有桶 `tmp/` 生命周期。
 *
 * 用法:`pnpm db:minio:init`(读 `.env.local` 的 `MINIO_*`,见 `doc/文件管理.md`)
 *
 * ⚠️ **CORS 这个脚本设不了**:`minio` 客户端没有 `setBucketCors`,`mc` 也没有等价于 SDK 的稳定入口。
 * 不配 CORS 的症状是「浏览器直传被拦(preflight 失败)」,用脚本末尾打印的那条 `mc cors set` 配一次即可。
 */
import { Client } from "minio";

const endpoint = process.env.MINIO_ENDPOINT ?? "127.0.0.1";
const port = Number(process.env.MINIO_PORT ?? 9000);
const useSSL = (process.env.MINIO_USE_SSL ?? "false") === "true";
const accessKey = process.env.MINIO_ACCESS_KEY ?? "";
const secretKey = process.env.MINIO_SECRET_KEY ?? "";
const publicBucket = process.env.MINIO_BUCKET_PUBLIC ?? "app-public";
const privateBucket = process.env.MINIO_BUCKET_PRIVATE ?? "app-private";

if (!accessKey || !secretKey) {
	console.error("✗ 缺 MINIO_ACCESS_KEY / MINIO_SECRET_KEY(去看 .env.example)");
	process.exit(1);
}

const client = new Client({ endPoint: endpoint, port, useSSL, accessKey, secretKey });

/** 公开桶的匿名只读策略:只放行 GetObject,不给 ListBucket(列桶没必要开放) */
const PUBLIC_READ_POLICY = JSON.stringify({
	Version: "2012-10-17",
	Statement: [
		{
			Effect: "Allow",
			Principal: { AWS: ["*"] },
			Action: ["s3:GetObject"],
			Resource: [`arn:aws:s3:::${publicBucket}/*`],
		},
	],
});

async function ensureBucket(name: string): Promise<void> {
	if (await client.bucketExists(name)) {
		console.log(`  · ${name} 已存在`);
		return;
	}
	await client.makeBucket(name);
	console.log(`  ✓ 新建桶 ${name}`);
}

console.log(`连接 ${useSSL ? "https" : "http"}://${endpoint}:${port}`);
await ensureBucket(publicBucket);
await ensureBucket(privateBucket);

await client.setBucketPolicy(publicBucket, PUBLIC_READ_POLICY);
console.log(`  ✓ ${publicBucket} 已设匿名只读(这个桶可以直链)`);

await client.setBucketLifecycle(privateBucket, {
	Rule: [
		{
			ID: "tmp-1d",
			Status: "Enabled",
			Filter: { Prefix: "tmp/" },
			Expiration: { Days: 1 },
		},
	],
});
console.log(`  ✓ ${privateBucket} 的 tmp/ 前缀已设 1 天过期(与 DB 扫 status=0 双保险)`);

console.log(`
────────────────────────────────────────────────────────────
还差一步(脚本设不了):给桶配 CORS,否则浏览器直传会被拦。

  用 mc:
    mc alias set local http://${endpoint}:${port} <ACCESS_KEY> <SECRET_KEY>
    mc cors set local/${publicBucket}  --config /dev/stdin <<'JSON'
    {"corsRules":[{"allowedOrigins":["*"],"allowedMethods":["GET","PUT","HEAD"],
      "allowedHeaders":["*"],"exposeHeaders":["ETag"],"maxAgeSeconds":3600}]}
    JSON
    # ${privateBucket} 同样配一遍

  或直接开控制台点:http://${endpoint}:9001 → Buckets → 选中桶 → CORS Configuration
────────────────────────────────────────────────────────────`);

process.exit(0);
