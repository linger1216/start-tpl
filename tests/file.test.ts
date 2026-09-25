/**
 * 文件管理(`sys_file` + MinIO)—— 集成测试。
 *
 * 与别处不同:**这条链路真的会连对象存储** —— 直调 tRPC procedure 拿预签名 URL,
 * 再用 `fetch` 把字节 PUT 上去,然后 `confirm` 回读校准。所以跑之前要有可用的 MinIO
 *(`pnpm db:minio:init` 初始化过,配置在 `.env.local`)。
 *
 * 表口径:`sys_file`(15 列里只用得到 id / bucket / object_key / origin_name / size / status)。
 * 数据用 `__test__` 前缀的**原始文件名**标识,`after` 里按 `object_key` 精确清掉 + 删对象。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { sysFile } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { getStorage } from "../src/lib/storage.ts";
import { assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const NAME = `${TEST_PREFIX}file.${SUFFIX}.png`;
/** 测试里创建的 object_key(按它精确清理,不靠 LIKE 前缀 —— `_` 是 SQL 通配符,踩过) */
const created: string[] = [];

/** 真把字节 PUT 到 MinIO(浏览器走的是同一条路,只是这里没有 CORS 限制) */
async function put(uploadUrl: string | null, body: string, contentType: string): Promise<number> {
	// 只有秒传命中时才会是 null —— 那时调用方压根不该调这个函数,所以这里直接断言
	assert.ok(uploadUrl, "这条用例本该拿到上传地址(凭空为 null 说明秒传误命中)");
	const res = await fetch(uploadUrl, { method: "PUT", body, headers: { "content-type": contentType } });
	assert.equal(res.status, 200, `PUT 到 MinIO 应成功,实际 ${res.status}`);
	return new TextEncoder().encode(body).length;
}

after(async () => {
	if (created.length > 0) {
		const rows = await db.select().from(sysFile).where(inArray(sysFile.object_key, created));
		const storage = await getStorage();
		for (const row of rows) await storage.remove(row.bucket, row.object_key);
		await db.delete(sysFile).where(inArray(sysFile.object_key, created));
	}
	await closeDb();
});

test("presign 拒绝白名单外的后缀", async () => {
	await assertRejects(
		() => caller.file.presign({ name: `${TEST_PREFIX}x.${SUFFIX}.html`, size: 10, kind: "private" }),
		"不允许的文件类型",
	);
});

test("presign 拒绝超过大小上限的文件", async () => {
	await assertRejects(
		() => caller.file.presign({ name: NAME, size: 999 * 1024 * 1024, kind: "private" }),
		"超过上限",
	);
});

test("两阶段上传:presign → PUT → confirm(大小以 MinIO 回的为准)", async () => {
	// 故意报一个假的 size:confirm 必须用 statObject 校准,而不是信这个数
	const presign = await caller.file.presign({ name: NAME, size: 999_999, kind: "private" });
	created.push(presign.objectKey);

	const bytes = await put(presign.uploadUrl, "hello minio 你好", "image/png");

	const hash = "a".repeat(64);
	const row = await caller.file.confirm({ bucket: presign.bucket, objectKey: presign.objectKey, hash });

	assert.equal(row.size, bytes, "confirm 后的大小应是真实字节数,而不是 presign 时报的 999999");
	assert.equal(row.status, 1, "confirm 之后 status 应为 1(正常)");
	assert.equal(row.objectKey, presign.objectKey);
	assert.equal(row.originName, NAME);
	assert.equal(row.hash, hash, "客户端给的 sha256 应落库");
});

test("url:私有桶给预签名(带签名参数),公开桶给直链(不带签名)", async () => {
	const privateFile = await caller.file.presign({ name: NAME, size: 10, kind: "private" });
	created.push(privateFile.objectKey);
	await put(privateFile.uploadUrl, "x", "image/png");
	await caller.file.confirm({ bucket: privateFile.bucket, objectKey: privateFile.objectKey });
	const [privateRow] = await db.select().from(sysFile).where(eq(sysFile.object_key, privateFile.objectKey));
	const signed = await caller.file.url({ id: privateRow.id });
	assert.equal(signed.isPublic, false);
	assert.ok(signed.url.includes("Signature"), "私有桶的 URL 必须带签名");

	const publicFile = await caller.file.presign({ name: NAME, size: 10, kind: "public" });
	created.push(publicFile.objectKey);
	await put(publicFile.uploadUrl, "y", "image/png");
	await caller.file.confirm({ bucket: publicFile.bucket, objectKey: publicFile.objectKey });
	const [publicRow] = await db.select().from(sysFile).where(eq(sysFile.object_key, publicFile.objectKey));
	const direct = await caller.file.url({ id: publicRow.id });
	assert.equal(direct.isPublic, true);
	assert.ok(!direct.url.includes("Signature"), "公开桶给的是直链,不该带签名");
});

test("confirm 拦掉存储型 XSS 载体(text/html)", async () => {
	const bad = await caller.file.presign({ name: NAME, size: 10, kind: "public" });
	created.push(bad.objectKey);
	await put(bad.uploadUrl, "<script>alert(1)</script>", "text/html");

	await assertRejects(() => caller.file.confirm({ bucket: bad.bucket, objectKey: bad.objectKey }), "脚本页");

	const [row] = await db.select().from(sysFile).where(eq(sysFile.object_key, bad.objectKey));
	assert.equal(row.status, 2, "被拦下的文件要直接标成已删除");
	const stat = await (await getStorage()).stat(bad.bucket, bad.objectKey);
	assert.equal(stat, null, "被拦下的对象要从桶里删掉,不能留在公开桶里");
});

test("列表:图片行带缩略图地址(私有桶走短时效预签名)", async () => {
	const presign = await caller.file.presign({ name: `${TEST_PREFIX}thumb.${SUFFIX}.png`, size: 10, kind: "private" });
	created.push(presign.objectKey);
	await put(presign.uploadUrl, "t", "image/png");
	await caller.file.confirm({ bucket: presign.bucket, objectKey: presign.objectKey });

	const rows = await caller.file.list({ status: 1 });
	const row = rows.find((item) => item.objectKey === presign.objectKey);
	assert.ok(row, "刚传的图片应出现在列表里");
	// ⚠️ 私有桶不能让列表拿到直链 —— 必须现签,否则缩略图永远出不来(踩过:只有图标没有预览图)
	assert.ok(row.thumbUrl?.includes("Signature"), `私有桶图片的缩略图应是预签名地址,实际:${row.thumbUrl}`);

	const res = await fetch(row.thumbUrl ?? "", { headers: { range: "bytes=0-0" } });
	assert.ok(res.status === 200 || res.status === 206, `缩略图地址应可用,实际 ${res.status}`);
	await res.arrayBuffer();

	// 非图片不该有缩略图地址(退回类型图标)
	const doc = await caller.file.presign({ name: `${TEST_PREFIX}thumb.${SUFFIX}.docx`, size: 10, kind: "private" });
	created.push(doc.objectKey);
	await put(doc.uploadUrl, "d", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
	await caller.file.confirm({ bucket: doc.bucket, objectKey: doc.objectKey });
	const docRow = (await caller.file.list({ status: 1 })).find((item) => item.objectKey === doc.objectKey);
	assert.equal(docRow?.thumbUrl ?? null, null, "非图片不该给缩略图地址");
});

/** 固定的假 hash:服务端只做字符串比较,不需要真去算 —— 顺便也说明"客户端声称的 hash 是被信任的" */
const fakeHash = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

test("秒传:同 hash 命中已有文件 → 不签发上传地址,直接返回已存在的那一行", async () => {
	const hash = fakeHash(`aaa${SUFFIX}`);
	const a = await caller.file.presign({ name: `${TEST_PREFIX}dup-a.${SUFFIX}.png`, size: 12, kind: "private", hash });
	assert.ok(a.uploadUrl, "首次上传应当有上传地址");
	created.push(a.objectKey);
	await put(a.uploadUrl, "same-bytes-1", "image/png");
	const aRow = await caller.file.confirm({ bucket: a.bucket, objectKey: a.objectKey, hash });

	const b = await caller.file.presign({ name: `${TEST_PREFIX}dup-b.${SUFFIX}.png`, size: 12, kind: "private", hash });
	assert.equal(b.instant, true, "同 hash 应命中秒传");
	assert.equal(b.uploadUrl, null, "秒传不该给上传地址(浏览器一个字节都不发)");
	assert.ok(b.file, "秒传应直接返回就绪记录");
	assert.equal(b.file.id, aRow.id, "秒传返回的就是**已存在的那一行**(一个对象只有一行)");
	assert.equal(b.objectKey, a.objectKey, "复用同一个对象键");
	assert.equal(b.file.status, 1, "那一行本来就是正常态");
	assert.equal(b.file.originName, aRow.originName, "名字也是原文件的 —— 秒传不会替你改名");
	assert.equal(b.file.size, aRow.size, "大小沿用原记录的");
});

test("秒传不产生第二行 ⇒ 删除就是直接删(不需要引用计数)", async () => {
	const hash = fakeHash(`bbb${SUFFIX}`);
	const a = await caller.file.presign({ name: `${TEST_PREFIX}share-a.${SUFFIX}.png`, size: 12, kind: "private", hash });
	created.push(a.objectKey);
	await put(a.uploadUrl, "shared-body", "image/png");
	const aRow = await caller.file.confirm({ bucket: a.bucket, objectKey: a.objectKey, hash });

	const b = await caller.file.presign({ name: `${TEST_PREFIX}share-b.${SUFFIX}.png`, size: 12, kind: "private", hash });
	assert.equal(b.instant, true);
	assert.equal(b.file?.id, aRow.id, "秒传不会插入第二行");

	// 同一个对象键在 sys_file 里只会有一行(uk_sys_file_object) ⇒ 不存在"被别的记录共用"的情况
	const dupRows = (await caller.file.list()).filter((row) => row.objectKey === a.objectKey);
	assert.equal(dupRows.length, 1, "同一个对象键只有一行");

	await caller.file.remove({ ids: [aRow.id] });
	assert.equal(await (await getStorage()).stat(a.bucket, a.objectKey), null, "删掉唯一一行后对象即清除");
});

test("秒传:后缀不同不命中(对象键里带着后缀,复用会永远对不上)", async () => {
	const hash = fakeHash(`ccc${SUFFIX}`);
	const png = await caller.file.presign({ name: `${TEST_PREFIX}ext.${SUFFIX}.png`, size: 12, kind: "private", hash });
	created.push(png.objectKey);
	await put(png.uploadUrl, "ext-body", "image/png");
	await caller.file.confirm({ bucket: png.bucket, objectKey: png.objectKey, hash });

	const jpg = await caller.file.presign({ name: `${TEST_PREFIX}ext.${SUFFIX}.jpg`, size: 12, kind: "private", hash });
	assert.equal(jpg.instant, false, "同 hash 但后缀不同 → 不秒传");
	assert.ok(jpg.uploadUrl, "不秒传就要正常签发上传地址");
});

test("秒传:桶不同不命中(对象在桶里,public 不能复用 private 的对象)", async () => {
	const hash = fakeHash(`ddd${SUFFIX}`);
	const priv = await caller.file.presign({ name: `${TEST_PREFIX}bucket.${SUFFIX}.png`, size: 12, kind: "private", hash });
	created.push(priv.objectKey);
	await put(priv.uploadUrl, "bucket-body", "image/png");
	await caller.file.confirm({ bucket: priv.bucket, objectKey: priv.objectKey, hash });

	const pub = await caller.file.presign({ name: `${TEST_PREFIX}bucket.${SUFFIX}.png`, size: 12, kind: "public", hash });
	assert.equal(pub.instant, false, "跨桶不秒传");
	assert.ok(pub.uploadUrl);
});

test("秒传:已删除的行不参与命中(它的对象可能已经被清理)", async () => {
	const hash = fakeHash(`eee${SUFFIX}`);
	const a = await caller.file.presign({ name: `${TEST_PREFIX}gone.${SUFFIX}.png`, size: 12, kind: "private", hash });
	created.push(a.objectKey);
	await put(a.uploadUrl, "gone-body", "image/png");
	const aRow = await caller.file.confirm({ bucket: a.bucket, objectKey: a.objectKey, hash });
	await caller.file.remove({ ids: [aRow.id] });

	const again = await caller.file.presign({ name: `${TEST_PREFIX}gone2.${SUFFIX}.png`, size: 12, kind: "private", hash });
	assert.equal(again.instant, false, "只剩已删除的行 → 不能秒传");
	assert.ok(again.uploadUrl, "应当照常走一遍真实上传");
});

test("下载:公开桶也走预签名,并带上原始文件名(Content-Disposition)", async () => {
	const presign = await caller.file.presign({ name: NAME, size: 10, kind: "public" });
	created.push(presign.objectKey);
	await put(presign.uploadUrl, "d", "image/png");
	await caller.file.confirm({ bucket: presign.bucket, objectKey: presign.objectKey });

	const [row] = await db.select().from(sysFile).where(eq(sysFile.object_key, presign.objectKey));
	const dl = await caller.file.url({ id: row.id, download: true });
	// ⚠️ 这条是回归:公开桶直链带不了 Content-Disposition,浏览器会按对象键(那串 nanoid)存盘
	assert.ok(dl.url.includes("Signature"), "要下载时公开桶也必须走预签名,否则文件名是对象键");
	assert.ok(dl.url.includes("response-content-disposition"), "预签名里要带 disposition 参数");

	// ⚠️ 必须用 **GET**(可以带 Range 只取 1 字节):S3 把请求方法也算进签名,拿 HEAD 请求 GET 签名会 403(探针踩过)
	const res = await fetch(dl.url, { headers: { range: "bytes=0-0" } });
	assert.ok(res.status === 200 || res.status === 206, `下载 URL 应可用,实际 ${res.status}`);
	await res.arrayBuffer();
	const disposition = res.headers.get("content-disposition") ?? "";
	assert.ok(disposition.startsWith("attachment"), `应是附件下载,实际:${disposition}`);
	assert.ok(disposition.includes(encodeURIComponent(NAME)), `下载名应是原始文件名,实际:${disposition}`);
});

test("remove:删对象 + 置 status=2(行保留)", async () => {
	const presign = await caller.file.presign({ name: NAME, size: 10, kind: "private" });
	created.push(presign.objectKey);
	await put(presign.uploadUrl, "z", "image/png");
	await caller.file.confirm({ bucket: presign.bucket, objectKey: presign.objectKey });

	const [row] = await db.select().from(sysFile).where(eq(sysFile.object_key, presign.objectKey));
	const result = await caller.file.remove({ ids: [row.id] });
	assert.equal(result.removed, 1);

	const after = await (await getStorage()).stat(presign.bucket, presign.objectKey);
	assert.equal(after, null, "对象应已从桶里删除");
	const [kept] = await db.select().from(sysFile).where(eq(sysFile.id, row.id));
	assert.equal(kept.status, 2, "行保留(便于审计),状态置为已删除");
});

test("remove:一次删多个 —— 批量删除走的就是这条路径", async () => {
	const stamp = `${SUFFIX}`;
	const rows: string[] = [];
	const keys: string[] = [];
	for (const tag of ["a", "b"]) {
		const ticket = await caller.file.presign({
			name: `${TEST_PREFIX}batch.${tag}.${stamp}.png`,
			size: 8,
			kind: "private",
		});
		assert.ok(ticket.uploadUrl);
		await put(ticket.uploadUrl, `batch-${tag}`, "image/png");
		const row = await caller.file.confirm({ bucket: ticket.bucket, objectKey: ticket.objectKey });
		rows.push(row.id);
		keys.push(ticket.objectKey);
		created.push(ticket.objectKey);
	}

	const { removed } = await caller.file.remove({ ids: rows });
	assert.equal(removed, 2, "一次提交两个 id 应该都删掉");

	const storage = await getStorage();
	for (const key of keys) {
		assert.equal(await storage.stat("app-private", key), null, "批量删除同样要把对象从桶里清掉");
	}
	const after = await caller.file.list();
	for (const id of rows) {
		const row = after.find((item) => item.id === id);
		assert.equal(row?.status, 2, "行保留、状态置为已删除");
	}
});

test("list:能按状态过滤", async () => {
	const rows = await caller.file.list({ status: 1 });
	assert.ok(Array.isArray(rows));
	assert.ok(
		rows.every((row) => row.status === 1),
		"按 status=1 过滤后不该混入别的状态",
	);
});
