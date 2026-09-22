/**
 * 标签路由 —— 读写 `sys_tag` 表(自关联树),供「系统设置 ▸ 标签管理」维护。
 *
 * 标签体系是两级树:**维度**(一级,`parent_id` 为 null)→ **标签**(叶子,`parent_id` 指向维度)。
 * 每个节点有 `label`(展示名)/ `value`(取值)/ `desc`(含义)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 全部标签行(按 `sort`,再按 `label`);树在前端拼 |
 * | `create` | mutation | 新增节点(`parent_id` + `label`,可选 `value` / `desc`);追加到同级末尾 |
 * | `update` | mutation | 改一个节点的 `label` / `value` / `desc` |
 * | `delete` | mutation | **级联删除**:连子节点 + 它们的关联关系一起删 |
 * | `move` | mutation | **同级重排 / 跨父迁移**:把节点挂到新父下,并按给定顺序重写同级 `sort` |
 *
 * 标签 ↔ 业务对象(sys_tag_relation)四个:
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `link` | mutation | **打标签**:给一个对象贴上某个标签(重复贴幂等,不报错) |
 * | `unlink` | mutation | **取消标签**:删掉这一条关联 |
 * | `objectsOfTag` | query | **查这个标签打在哪些对象上**(可按 objType 过滤,带分页) |
 * | `tagsOfObject` | query | **查这个对象身上有哪些标签**(带标签名,前端直接渲染) |
 * | `objectIdsOfTag` | query | **根据标签 id 查业务对象 id**(只要 id,给逻辑用) |
 * | `tagIdsOfObject` | query | **根据对象 id 查标签 id**(只要 id,给逻辑用) |

 * 树不在这里拼:服务端只回平铺行,拼树 + 过滤是纯函数,放前端更好测(见 `settings-tags-page.tsx` 的 `buildTagTree`)。
 */
import { TRPCError } from "@trpc/server";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysTag, sysTagRelation } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { createTRPCRouter, publicProcedure } from "../init";

/** 库行 → 接口出参(时间列不回,前端用不到) */
function toTagRow(row: typeof sysTag.$inferSelect) {
	return {
		id: row.id,
		parentId: row.parent_id ?? null,
		label: row.label,
		value: row.value ?? null,
		desc: row.desc ?? null,
		sort: Number(row.sort ?? 0),
	};
}

async function getTagRow(id: string) {
	const [row] = await db.select().from(sysTag).where(eq(sysTag.id, id)).limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个标签节点不存在(可能已被删除)" });
	return row;
}

/** 递归收集某节点及其全部子孙 id(级联删除用) */
async function collectSubtreeIds(rootId: string): Promise<string[]> {
	const result = [rootId];
	const queue = [rootId];
	while (queue.length > 0) {
		const current = queue.shift() as string;
		const children = await db.select({ id: sysTag.id }).from(sysTag).where(eq(sysTag.parent_id, current));
		for (const child of children) {
			result.push(child.id);
			queue.push(child.id);
		}
	}
	return result;
}

export const tagRouter = createTRPCRouter({
	list: publicProcedure.query(async () => {
		const rows = await db.select().from(sysTag).orderBy(asc(sysTag.sort), asc(sysTag.label));
		return rows.map(toTagRow);
	}),

	create: publicProcedure
		.input(
			z.object({
				parentId: z.string().nullable(),
				label: z.string().min(1, "名称不能为空").max(32),
				value: z.string().max(32).nullable().optional(),
				desc: z.string().max(2000).nullable().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const parentId = input.parentId ?? null;
			if (parentId) await getTagRow(parentId);
			const label = input.label.trim();

			// 同级同名 = 重复节点(业务键就是 (parent_id, label),种子脚本也按它判重)
			const [duplicate] = await db
				.select({ id: sysTag.id })
				.from(sysTag)
				.where(
					parentId === null
						? sql`${sysTag.parent_id} is null and ${sysTag.label} = ${label}`
						: sql`${sysTag.parent_id} = ${parentId} and ${sysTag.label} = ${label}`,
				)
				.limit(1);
			if (duplicate) {
				throw new TRPCError({ code: "CONFLICT", message: `同级下已经有「${label}」了` });
			}
			// 主键一律 nanoid;节点身份靠 (parent_id, label),不靠主键内容
			const id = newId();
			const siblings = await db
				.select({ sort: sysTag.sort })
				.from(sysTag)
				.where(parentId === null ? sql`${sysTag.parent_id} is null` : eq(sysTag.parent_id, parentId));
			const sort = siblings.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
			await db.insert(sysTag).values({
				id,
				parent_id: parentId,
				label,
				value: input.value?.trim() || null,
				desc: input.desc?.trim() || null,
				sort,
			});
			return toTagRow(await getTagRow(id));
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string().min(1),
				label: z.string().min(1, "名称不能为空").max(32),
				value: z.string().max(32).nullable().optional(),
				desc: z.string().max(2000).nullable().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			await getTagRow(input.id);
			await db
				.update(sysTag)
				.set({
					label: input.label.trim(),
					value: input.value?.trim() || null,
					desc: input.desc?.trim() || null,
				})
				.where(eq(sysTag.id, input.id));
			return toTagRow(await getTagRow(input.id));
		}),

	delete: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		await getTagRow(input.id);
		const ids = await collectSubtreeIds(input.id);
		// 关联关系先清:标签没了,「谁贴过它」的行留着就是脏数据(表上没有外键,不会自动清)
		const removedLinks = await db.delete(sysTagRelation).where(inArray(sysTagRelation.tag_id, ids));
		await db.delete(sysTag).where(eq(sysTag.id, input.id));
		// 级联:父被删,子节点也跟着删(子节点的 parent_id 现在指向已不存在的父,留着会变成孤儿)
		if (ids.length > 1) {
			await db.delete(sysTag).where(inArray(sysTag.id, ids.slice(1)));
		}
		const affected = (removedLinks as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
		return { deleted: ids.length, removedLinks: Number(affected) };
	}),

	/**
	 * 同级重排 / 跨父迁移。传入「目标父 + 该父下完整 id 顺序」,服务端:
	 *  ① 把被拖节点挂到新父下;② 按给定顺序重写同级 `sort`(要么全改、要么不改,包在事务里)。
	 */
	move: publicProcedure
		.input(
			z.object({
				id: z.string().min(1),
				newParentId: z.string().nullable(),
				orderedSiblingIds: z.array(z.string().min(1)).min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const newParentId = input.newParentId ?? null;
			if (newParentId) await getTagRow(newParentId);
			const siblings = await db
				.select({ id: sysTag.id, parentId: sysTag.parent_id })
				.from(sysTag)
				.where(newParentId === null ? sql`${sysTag.parent_id} is null` : eq(sysTag.parent_id, newParentId));
			const siblingIds = new Set(siblings.map((row) => row.id));
			const unknown = input.orderedSiblingIds.filter((sib) => !siblingIds.has(sib));
			if (unknown.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `只能放到同一级下,以下节点不属于该父:${unknown.join("、")}`,
				});
			}
			if (input.orderedSiblingIds.length !== siblingIds.size) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "顺序清单必须包含该级下全部节点" });
			}
			await db.transaction(async (tx) => {
				// 先改父(若跨父),再按序写 sort
				await tx.update(sysTag).set({ parent_id: newParentId }).where(eq(sysTag.id, input.id));
				for (const [index, sibId] of input.orderedSiblingIds.entries()) {
					await tx.update(sysTag).set({ sort: index }).where(eq(sysTag.id, sibId));
				}
			});
			const rows = await db.select().from(sysTag).orderBy(asc(sysTag.sort), asc(sysTag.label));
			return { updated: input.orderedSiblingIds.length, rows: rows.map(toTagRow) };
		}),

	// ── 标签 ↔ 业务对象(多态多对多,表 = `sys_tag_relation`)────────────────

	/**
	 * **打标签**:把某个标签贴到一个业务对象上。
	 *
	 * - `objType` 由调用方定(如 `archive` / `source`),服务端**不枚举**它 —— 加一种对象不用改这里;
	 * - 只允许贴**叶子标签**:给「维度」贴标签没有业务含义(维度是分类,不是取值),这里直接拦掉;
	 * - 重复贴同一个 (tag, obj) 是**幂等**的:返回 `created: false`,不报错 —— 调用方不必先查再插。
	 */
	link: publicProcedure
		.input(
			z.object({
				tagId: z.string().min(1).max(32),
				objId: z.string().min(1, "对象 id 不能为空").max(32),
				/** 业务对象类型是 **tinyint 码**(表定义如此),各业务自己登记码值 */
				objType: z.number().int().min(0).max(255),
			}),
		)
		.mutation(async ({ input }) => {
			const tag = await getTagRow(input.tagId);
			if (!tag.parent_id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "「维度」不能贴到对象上,请选维度下的标签" });
			}
			const [existing] = await db
				.select({ id: sysTagRelation.id })
				.from(sysTagRelation)
				.where(
					sql`${sysTagRelation.tag_id} = ${input.tagId} and ${sysTagRelation.obj_type} = ${input.objType} and ${sysTagRelation.obj_id} = ${input.objId}`,
				)
				.limit(1);
			if (existing) return { id: existing.id, created: false };

			const id = newId();
			await db.insert(sysTagRelation).values({
				id,
				tag_id: input.tagId,
				obj_id: input.objId,
				obj_type: input.objType,
			});
			return { id, created: true };
		}),

	/** **取消标签**:删掉这一条关联。不存在时返回 `removed: 0`(幂等,不抛错) */
	unlink: publicProcedure
		.input(
			z.object({
				tagId: z.string().min(1).max(32),
				objId: z.string().min(1).max(32),
				objType: z.number().int().min(0).max(255),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await db
				.delete(sysTagRelation)
				.where(
					sql`${sysTagRelation.tag_id} = ${input.tagId} and ${sysTagRelation.obj_type} = ${input.objType} and ${sysTagRelation.obj_id} = ${input.objId}`,
				);
			const affected = (result as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
			return { removed: Number(affected) };
		}),

	/**
	 * **根据标签 id 查业务对象 id** —— 只要 id,不带类型 / 时间那些附带信息。
	 *
	 * 与 `objectsOfTag` 的分工:那个是"列表页要展示"的(带 objType / 创建时间 / 分页),
	 * 这个是"逻辑要判/要算"的(`objIds.includes(...)`、喂给别的查询)。
	 * `objType` 可选:不传 = 该标签下所有类型的对象。
	 */
	objectIdsOfTag: publicProcedure
		.input(z.object({ tagId: z.string().min(1).max(32), objType: z.number().int().min(0).max(255).optional() }))
		.query(async ({ input }) => {
			const rows = await db
				.select({ objId: sysTagRelation.obj_id })
				.from(sysTagRelation)
				.where(
					input.objType === undefined
						? eq(sysTagRelation.tag_id, input.tagId)
						: sql`${sysTagRelation.tag_id} = ${input.tagId} and ${sysTagRelation.obj_type} = ${input.objType}`,
				);
			// 去重后排序:同一个对象只会有一条关联(唯一键),但排序让结果稳定可断言
			return [...new Set(rows.map((row) => row.objId))].sort();
		}),

	/**
	 * **根据对象 id 查标签 id** —— 只要 id。
	 *
	 * 与 `tagsOfObject` 的分工同上:那个回标签名 / 取值给界面渲染,这个回 id 给逻辑用
	 * (如"这个对象是否带某标签"、"把标签 id 传给别的接口")。
	 */
	tagIdsOfObject: publicProcedure
		.input(z.object({ objId: z.string().min(1).max(32), objType: z.number().int().min(0).max(255) }))
		.query(async ({ input }) => {
			const rows = await db
				.select({ tagId: sysTagRelation.tag_id })
				.from(sysTagRelation)
				.where(sql`${sysTagRelation.obj_type} = ${input.objType} and ${sysTagRelation.obj_id} = ${input.objId}`);
			return [...new Set(rows.map((row) => row.tagId))].sort();
		}),

	/** **查这个标签打在哪些对象上**:`objType` 可选(不传 = 所有类型的对象);带总数与分页 */
	objectsOfTag: publicProcedure
		.input(
			z.object({
				tagId: z.string().min(1).max(32),
				objType: z.number().int().min(0).max(255).optional(),
				limit: z.number().int().min(1).max(200).default(50),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ input }) => {
			const where =
				input.objType === undefined
					? sql`${sysTagRelation.tag_id} = ${input.tagId}`
					: sql`${sysTagRelation.tag_id} = ${input.tagId} and ${sysTagRelation.obj_type} = ${input.objType}`;
			const rows = await db
				.select()
				.from(sysTagRelation)
				.where(where)
				.orderBy(asc(sysTagRelation.create_time), asc(sysTagRelation.obj_id))
				.limit(input.limit)
				.offset(input.offset);
			const [counted] = await db.execute(sql`select count(*) as n from ${sysTagRelation} where ${where}`);
			const total = Number((counted as unknown as Array<{ n?: number }>)[0]?.n ?? 0);
			return {
				total,
				items: rows.map((row) => ({
					linkId: row.id,
					tagId: row.tag_id,
					objId: row.obj_id,
					objType: row.obj_type,
					createdAt: row.create_time ? row.create_time.toISOString() : null,
				})),
			};
		}),

	/** **查这个对象身上有哪些标签**:带标签名 / 取值,前端直接渲染,不必再查一次标签表 */
	tagsOfObject: publicProcedure
		.input(z.object({ objId: z.string().min(1).max(32), objType: z.number().int().min(0).max(255) }))
		.query(async ({ input }) => {
			const links = await db
				.select()
				.from(sysTagRelation)
				.where(sql`${sysTagRelation.obj_type} = ${input.objType} and ${sysTagRelation.obj_id} = ${input.objId}`);
			if (links.length === 0) return { items: [] };

			const tagIds = links.map((link) => link.tag_id);
			const tags = await db.select().from(sysTag).where(inArray(sysTag.id, tagIds));
			const tagById = new Map(tags.map((tag) => [tag.id, tag]));
			return {
				items: links
					.map((link) => {
						const tag = tagById.get(link.tag_id);
						return {
							linkId: link.id,
							tagId: link.tag_id,
							/** 标签被删掉时兜底显示 id,而不是整行消失(说明库里有脏关联) */
							label: tag?.label ?? link.tag_id,
							value: tag?.value ?? null,
							parentId: tag?.parent_id ?? null,
							createdAt: link.create_time ? link.create_time.toISOString() : null,
						};
					})
					.sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN")),
			};
		}),
});
