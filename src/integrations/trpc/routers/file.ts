/**
 * 文件路由 —— 「系统设置 ▸ 文件管理」+ 各处上传。
 *
 * 表是 **`sys_file`**(字节存 MinIO,见 `doc/文件管理.md`);上传是**两阶段**:
 * `presign`(签 URL + 落 status=0)→ 浏览器直传 → `confirm`(stat 校准 + status=1)。
 *
 * ⚠️ 别在别处"顺手"加一个 REST 上传路由:`presign`/`confirm` 都是 tRPC 小 JSON,
 * 只有**浏览器 ↔ MinIO** 那一段是外部服务(见 AGENTS「接口铁律」)。
 *
 * ✅ 服务端登录校验:本路由的过程全是 `protectedProcedure`(=`init.ts` 的 `requireUser` 中间件),
 * 无会话直发 tRPC ⇒ `UNAUTHORIZED「请先登录」`(与另外 12 个路由同口径,`tests/auth.test.ts`
 * 用匿名 caller 断言过)。直调 caller 的测试自己注入 `ctx.user` —— `requireUser` 优先取注入值,
 * 而 `getCurrentUserId()` 在没有请求上下文时恒为 null:别把校验写成"只认 `getCurrentUserId()`"。
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysFile } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { FILE_ALLOW_EXT_DEFAULT, FILE_MAX_SIZE_MB_DEFAULT } from "#/lib/para-spec";
import { bucketFor, buildObjectKey, getStorage, isPublicBucket, publicUrlOf } from "#/lib/storage";
import { getParaMap } from "#/lib/sys-para";
import { createTRPCRouter, protectedProcedure } from "../init";

const MAX_NAME = 255;

/** 从文件名里取小写后缀(没有后缀给空串) */
function extOf(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return "";
	return name
		.slice(dot + 1)
		.replace(/[^a-z0-9]/gi, "")
		.toLowerCase();
}

/** 读上传策略(参数化,界面改参数即生效;读不到就用 `para-spec.ts` 里那份兜底值) */
async function readPolicy() {
	const map = await getParaMap();
	const maxMb = Number(map.get("file.max_size_mb") ?? FILE_MAX_SIZE_MB_DEFAULT);
	const allowExt = (map.get("file.allow_ext") ?? FILE_ALLOW_EXT_DEFAULT)
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
	return {
		maxBytes: Math.max(1, maxMb) * 1024 * 1024,
		/** 空名单 = **不限制后缀**,收所有文件类型(仍受大小上限与 Content-Type 防线约束) */
		allowExt,
	};
}

/** 缩略图地址的有效期:列表里给图片用,过期后前端 `onError` 会退回图标(下一次列表刷新又是新的) */
const THUMB_TTL_SECONDS = 900;

/**
 * 库行 → 接口出参。
 *
 * `thumbUrl` 是**列表缩略图**专用:图片行在服务端**批量签一次**(一次请求签完 20 行),
 * 而不是让前端每行各发一次 tRPC(那才是 N+1)。
 * ⚠️ 公开桶用直链、私有桶用短时效预签名 —— 私有桶**不能**给直链。
 */
const toFile = async (row: typeof sysFile.$inferSelect) => {
	const isImage = (row.content_type ?? "").startsWith("image/");
	const ready = Number(row.status ?? 0) === 1;
	const thumbUrl =
		ready && isImage
			? (publicUrlOf(row.bucket, row.object_key) ??
				(await (await getStorage()).presignGet(row.bucket, row.object_key, THUMB_TTL_SECONDS)))
			: null;
	return {
		// 与 sys_file 的列一一对应 —— 台账页要能看全字段
		id: row.id,
		bucket: row.bucket,
		objectKey: row.object_key,
		originName: row.origin_name,
		ext: row.ext,
		contentType: row.content_type,
		size: Number(row.size ?? 0),
		hash: row.hash,
		status: Number(row.status ?? 0),
		thumbUrl,
		createTime: row.created_at ? row.created_at.toISOString() : null,
		updateTime: row.updated_at ? row.updated_at.toISOString() : null,
	};
};

export const fileRouter = createTRPCRouter({
	/** 列表(台账页;**服务端加上限**,前端在此之上做客户端分页)—— 全表无上限会把"一次请求"
	 *  变成"全表扫描 + 每图片行一次签名",行数大到几千时是真实DoS自己;上限 500 覆盖模板场景,
	 *  派生场景更大时改传 `limit` 或改成服务端分页 */
	list: protectedProcedure
		.input(
			z
				.object({
					keyword: z.string().max(64).optional(),
					status: z.number().int().min(0).max(2).optional(),
					limit: z.number().int().min(1).max(1000).default(500),
				})
				.optional(),
		)
		.query(async ({ input }) => {
			// 「状态筛选 + 关键字搜索」是**与**关系(两个条件都要满足)—— 别用 `or(...conditions)` 拼,
			// 那样 status 会让关键字失效(实测过:丢了筛选条件,把不该出现的行也捞出来)。
			const conditions = [];
			if (input?.status !== undefined) conditions.push(eq(sysFile.status, input.status));
			if (input?.keyword) {
				const kw = `%${input.keyword}%`;
				conditions.push(or(like(sysFile.origin_name, kw), like(sysFile.object_key, kw)));
			}
			const rows = await db
				.select()
				.from(sysFile)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(sysFile.created_at))
				.limit(input?.limit ?? 500);
			// 图片行的预签名在这里**并发**发(Promise.all 同批),不是逐行 await —— 别改回串行
			return await Promise.all(rows.map((row) => toFile(row)));
		}),

	/** ① 签 PUT URL + 落一行 status=0。校验白名单与大小上限(**服务端登录校验见文件头的「已知缺口」**) */
	presign: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(MAX_NAME),
				size: z.number().int().nonnegative(),
				contentType: z.string().max(128).optional(),
				/**
				 * 文件内容的 sha256(64 位十六进制)。**有它才能秒传** ——
				 * 命中同桶同后缀的"正常"文件时,直接复制那条记录的对象,浏览器一个字节都不用传。
				 * 不传就是普通上传(老客户端 / 不想算的场景)。
				 */
				hash: z.string().length(64).optional(),
				/** public = 头像/图标(匿名只读、可直链);private = 附件(只能预签名) */
				kind: z.enum(["public", "private"]).default("private"),
			}),
		)
		.mutation(async ({ input }) => {
			const policy = await readPolicy();
			const ext = extOf(input.name);
			// 名单为空 = 收所有后缀;配了名单才做白名单校验
			if (!ext || (policy.allowExt.length > 0 && !policy.allowExt.includes(ext))) {
				throw new TRPCError({ code: "BAD_REQUEST", message: `不允许的文件类型(${policy.allowExt.join(" / ")})` });
			}
			if (input.size > policy.maxBytes) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `文件超过上限 ${Math.round(policy.maxBytes / 1024 / 1024)}MB`,
				});
			}

			const bucket = bucketFor(input.kind);

			// ── 秒传:hash 命中"同桶 + 同后缀 + 正常状态"的行,就复用它的对象,不再传字节 ──
			// 三个条件都不能少 —— 对象在桶里(所以必须同桶);`ext` 决定对象键,不同后缀共用会永远对不上;
			// 只认 status=1(待确认的对象可能压根没传上来,已删除的可能已被清理)。
			if (input.hash) {
				const [hit] = await db
					.select()
					.from(sysFile)
					.where(
						and(eq(sysFile.hash, input.hash), eq(sysFile.bucket, bucket), eq(sysFile.ext, ext), eq(sysFile.status, 1)),
					)
					.limit(1);
				if (hit) {
					// ⚠️ **直接把已存在的那一行返回,不另插一行** —— 表上有唯一索引 `uk_sys_file_object(bucket, object_key)`,
					// 即"一个对象只能有一行";硬插第二行会被数据库挡回来(实测 `[-6625] 违反唯一性约束`)。
					// 这也正好对上了需求原话:「**返回已经存在的那个文件**」。
					// 好处:不存在"多条记录共用一个对象" ⇒ **不需要 ref_count、也不需要删除时的额外判断**。
					return {
						instant: true as const,
						bucket: hit.bucket,
						objectKey: hit.object_key,
						uploadUrl: null,
						expiresIn: 0,
						file: await toFile(hit),
					};
				}
			}

			const objectKey = buildObjectKey(ext);
			const storage = await getStorage();
			const { url, expiresIn } = await storage.presignPut(bucket, objectKey, input.contentType);

			// 先登记再上传:status=0 是"签发了但还没传上来"的**正常中间态**,清理任务按它扫
			await db.insert(sysFile).values({
				id: newId(),
				bucket,
				object_key: objectKey,
				origin_name: input.name,
				ext,
				size: 0, // confirm 时用 statObject 校准
				status: 0,
			});

			return { instant: false as const, bucket, objectKey, uploadUrl: url, expiresIn, file: null };
		}),

	/** ② 上传完成确认:回读真实大小 / 类型,不符就把对象删掉 */
	confirm: protectedProcedure
		.input(
			z.object({ bucket: z.string().max(64), objectKey: z.string().max(512), hash: z.string().length(64).optional() }),
		)
		.mutation(async ({ input }) => {
			const [row] = await db.select().from(sysFile).where(eq(sysFile.object_key, input.objectKey)).limit(1);
			if (!row || row.bucket !== input.bucket) {
				throw new TRPCError({ code: "NOT_FOUND", message: "没有这条上传登记" });
			}

			const storage = await getStorage();
			const info = await storage.stat(input.bucket, input.objectKey);
			if (!info) throw new TRPCError({ code: "BAD_REQUEST", message: "对象还没传上来" });

			// ⚠️ 拦掉存储型 XSS:公开桶是**直链**,浏览器会按 `Content-Type` 渲染 ——
			// 传个 `text/html` 或 `image/svg+xml` 上去就等于在自己域名下挂了个脚本页。
			const reported = info.contentType.toLowerCase();
			if (
				reported.startsWith("text/html") ||
				reported.startsWith("image/svg") ||
				reported.startsWith("application/xhtml")
			) {
				await storage.remove(input.bucket, input.objectKey);
				await db.update(sysFile).set({ status: 2, updated_at: new Date() }).where(eq(sysFile.id, row.id));
				throw new TRPCError({ code: "BAD_REQUEST", message: "这个类型会把桶变成脚本页,已拒绝" });
			}

			const policy = await readPolicy();
			// 两头都校验:presign 时的 size 是客户端自己报的,可以造假
			if (info.size > policy.maxBytes) {
				await storage.remove(input.bucket, input.objectKey);
				await db.update(sysFile).set({ status: 2, updated_at: new Date() }).where(eq(sysFile.id, row.id));
				throw new TRPCError({ code: "BAD_REQUEST", message: "实际大小超过上限,已丢弃" });
			}

			await db
				.update(sysFile)
				.set({
					size: info.size,
					content_type: info.contentType,
					hash: input.hash ?? row.hash,
					status: 1,
					updated_at: new Date(),
				})
				.where(eq(sysFile.id, row.id));

			// 回读再返回:以前是拿"更新前的行"拼的,于是 `hash` 明明写进库了、接口却回 null(测试抓到的)
			const [fresh] = await db.select().from(sysFile).where(eq(sysFile.id, row.id)).limit(1);
			return await toFile(fresh ?? row);
		}),

	/** 访问地址:公开桶直链 / 私有桶预签名(私有桶**永远**不要返回直链) */
	url: protectedProcedure
		.input(z.object({ id: z.string().max(32), download: z.boolean().optional() }))
		.query(async ({ input }) => {
			const [row] = await db.select().from(sysFile).where(eq(sysFile.id, input.id)).limit(1);
			if (!row || Number(row.status) === 2) throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在或已删除" });
			const storage = await getStorage();
			// ⚠️ **要下载就必须走预签名** —— 公开桶的直链没法带 `Content-Disposition`,
			// 浏览器会拿对象键(`{yyyy}/{MM}/{nanoid}.{ext}` 那串)当文件名存盘,
			// 而不是原始文件名(需求就是"按文件名下载",这里踩过)。
			const url =
				input.download || !isPublicBucket(row.bucket)
					? await storage.presignGet(
							row.bucket,
							row.object_key,
							undefined,
							input.download ? row.origin_name : undefined,
						)
					: storage.publicUrl(row.bucket, row.object_key);
			return { url, originName: row.origin_name, contentType: row.content_type, isPublic: isPublicBucket(row.bucket) };
		}),

	/** 改**展示用**的文件名(不动对象键、不动物件)—— 详情 / 列表都能改 */
	rename: protectedProcedure
		.input(z.object({ id: z.string().max(32), name: z.string().min(1).max(MAX_NAME) }))
		.mutation(async ({ input }) => {
			const [row] = await db.select().from(sysFile).where(eq(sysFile.id, input.id)).limit(1);
			if (!row || Number(row.status) === 2) throw new TRPCError({ code: "NOT_FOUND", message: "文件不存在或已删除" });
			await db.update(sysFile).set({ origin_name: input.name, updated_at: new Date() }).where(eq(sysFile.id, row.id));
			const [fresh] = await db.select().from(sysFile).where(eq(sysFile.id, row.id)).limit(1);
			return await toFile(fresh ?? row);
		}),

	/** 批量删除:先删对象再置 status=2(行保留,便于审计与排查) */
	remove: protectedProcedure
		.input(z.object({ ids: z.array(z.string().max(32)).min(1) }))
		.mutation(async ({ input }) => {
			const rows = await db.select().from(sysFile).where(inArray(sysFile.id, input.ids));
			const storage = await getStorage();
			for (const row of rows) {
				// 秒传**不会**产生"多条记录共用一个对象"(`uk_sys_file_object` 唯一索引保证),
				// 所以这里不需要引用计数、也不需要"还有没有别人在用"的判断 —— 直接删。
				await storage.remove(row.bucket, row.object_key);
			}
			if (rows.length > 0) {
				await db
					.update(sysFile)
					.set({ status: 2, updated_at: new Date() })
					.where(
						inArray(
							sysFile.id,
							rows.map((row) => row.id),
						),
					);
			}
			return { removed: rows.length };
		}),
});
