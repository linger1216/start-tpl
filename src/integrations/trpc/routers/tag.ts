/**
 * 标签路由 —— 读写 `sys_tag` 表(自关联树),供「系统设置 ▸ 标签管理」维护。
 *
 * 软删口径见 `lib/soft-delete.ts`:`sys_tag` 有 `deleted_at`(删除 = 写时间戳,行留在库里给审计留痕),
 * 所以本文件**所有** `from(sysTag)` 的读路径都要带 `alive(sysTag)`;`sys_tag_relation` 是纯 join 表
 * (没有这一列),继续硬删 —— 但凡是 join 到 `sys_tag` 的读都要保证 tag 行活着。
 *
 * 标签体系是两级树:**维度**(一级,`parent_id` 为 null)→ **标签**(叶子,`parent_id` 指向维度)。
 * 每个节点有 `label`(展示名)/ `value`(取值)/ `desc`(含义)。
 *
 * | procedure | 类型 | 作用 |
 * | --- | --- | --- |
 * | `list` | query | 全部标签行(按 `sort`,再按 `label`);树在前端拼 |
 * | `create` | mutation | 新增节点(`parent_id` + `label`,可选 `value` / `desc`);追加到同级末尾 |
 * | `update` | mutation | 改一个节点的 `label` / `value` / `desc` |
 * | `delete` | mutation | **级联软删**:根 + 子节点一起写 `deleted_at`;关联关系行硬删(join 表,没有软删列) |
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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysTag, sysTagRelation } from "#/db/data-base-schema";
import { newId } from "#/lib/ids";
import { alive, softDeleted } from "#/lib/soft-delete";
import { createTRPCRouter, protectedProcedure } from "../init";

/** 库行 → 接口出参(时间列不回,前端用不到) */
function toTag(row: typeof sysTag.$inferSelect) {
	return {
		id: row.id,
		parentId: row.parent_id ?? null,
		label: row.label,
		value: row.value ?? null,
		desc: row.desc ?? null,
		sort: Number(row.sort ?? 0),
		createTime: row.create_time ? row.create_time.toISOString() : null,
		updateTime: row.update_time ? row.update_time.toISOString() : null,
	};
}

/** 读路径取行:已软删的节点**等同不存在**(报的还是同一句 NOT_FOUND,对外文案不变) */
async function getAliveTagRow(id: string) {
	const [row] = await db
		.select()
		.from(sysTag)
		.where(and(eq(sysTag.id, id), alive(sysTag)))
		.limit(1);
	if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "这个标签节点不存在(可能已被删除)" });
	return row;
}

/** 递归收集某节点及其全部子孙 id(级联软删用)。**只看活着的节点** —— 否则会顺着已软删的中间节点捞出一堆无关 id */
async function collectSubtreeIds(rootId: string): Promise<string[]> {
	const result = [rootId];
	const queue = [rootId];
	while (queue.length > 0) {
		const current = queue.shift() as string;
		const children = await db
			.select({ id: sysTag.id })
			.from(sysTag)
			.where(and(eq(sysTag.parent_id, current), alive(sysTag)));
		for (const child of children) {
			result.push(child.id);
			queue.push(child.id);
		}
	}
	return result;
}

export const tagRouter = createTRPCRouter({
	list: protectedProcedure.query(async () => {
		const rows = await db.select().from(sysTag).where(alive(sysTag)).orderBy(asc(sysTag.sort), asc(sysTag.label));
		return rows.map(toTag);
	}),

	create: protectedProcedure
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
			// 父节点必须**活着**:挂在已软删的维度下面,这条新标签在树上永远挂不出来
			if (parentId) await getAliveTagRow(parentId);
			const label = input.label.trim();

			// 同级同名 = 重复节点(业务键就是 (parent_id, label),种子脚本也按它判重);
			// **只看活着的行** —— 软删不是真删,同一个名字软删之后必须还能重建
			const [duplicate] = await db
				.select({ id: sysTag.id })
				.from(sysTag)
				.where(
					and(
						parentId === null
							? sql`${sysTag.parent_id} is null and ${sysTag.label} = ${label}`
							: sql`${sysTag.parent_id} = ${parentId} and ${sysTag.label} = ${label}`,
						alive(sysTag),
					),
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
				.where(
					and(parentId === null ? sql`${sysTag.parent_id} is null` : eq(sysTag.parent_id, parentId), alive(sysTag)),
				);
			const sort = siblings.reduce((max, row) => Math.max(max, Number(row.sort ?? 0)), -1) + 1;
			await db.insert(sysTag).values({
				id,
				parent_id: parentId,
				label,
				value: input.value?.trim() || null,
				desc: input.desc?.trim() || null,
				sort,
			});
			return toTag(await getAliveTagRow(id));
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				label: z.string().min(1, "名称不能为空").max(32),
				value: z.string().max(32).nullable().optional(),
				desc: z.string().max(2000).nullable().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			// 已软删的节点等同不存在:不能再改(否则会写回一行谁也看不见的数据)
			await getAliveTagRow(input.id);
			await db
				.update(sysTag)
				.set({
					label: input.label.trim(),
					value: input.value?.trim() || null,
					desc: input.desc?.trim() || null,
					update_time: new Date(),
				})
				.where(eq(sysTag.id, input.id));
			return toTag(await getAliveTagRow(input.id));
		}),

	delete: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
		// 这一行就是删除过程要操作的目标,**故意不带 `alive()`**(墓碑已经把 id 让出去了,
		// 但 id 是主键、不参与让位;重复删除仍按原语义报 NOT_FOUND)——
		// 读路径请用上面的 `getAliveTagRow()`,别把已软删的节点当"存在"
		const [target] = await db.select().from(sysTag).where(eq(sysTag.id, input.id)).limit(1);
		if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "这个标签节点不存在(可能已被删除)" });
		const ids = await collectSubtreeIds(input.id);
		// 关联关系先清:标签软删之后「谁贴过它」的行留着就是脏数据(表上没有外键,不会自动清)。
		// `sys_tag_relation` 是纯 join 表(**没有 `deleted_at`**),所以这一处仍然是硬删。
		const removedLinks = await db.delete(sysTagRelation).where(inArray(sysTagRelation.tag_id, ids));
		// 根 + 全部后代一起**软删**:写 `deleted_at` 而不是删行,审计里还看得见"删掉了哪棵树";
		// 读路径统一带 `alive(sysTag)`,所以列表 / 树上不会再出现。
		// (级联的意义不变:父没了、子还活着就会变成树上挂不出来的孤儿)
		await db.update(sysTag).set(softDeleted()).where(inArray(sysTag.id, ids));
		const affected = (removedLinks as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
		return { deleted: ids.length, removedLinks: Number(affected) };
	}),

	/**
	 * 同级重排 / 跨父迁移。传入「目标父 + 该父下完整 id 顺序」,服务端:
	 *  ① 把被拖节点挂到新父下;② 按给定顺序重写同级 `sort`(要么全改、要么不改,包在事务里)。
	 */
	move: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				newParentId: z.string().nullable(),
				orderedSiblingIds: z.array(z.string().min(1)).min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const newParentId = input.newParentId ?? null;
			// 目标父节点必须**活着**:迁到已软删的维度下面,这条节点在树上就挂不出来了
			if (newParentId) await getAliveTagRow(newParentId);
			// 同级清单只看活着的节点:已软删的不占顺序位,也不该逼调用方把它列进来
			const siblings = await db
				.select({ id: sysTag.id, parentId: sysTag.parent_id })
				.from(sysTag)
				.where(
					and(
						newParentId === null ? sql`${sysTag.parent_id} is null` : eq(sysTag.parent_id, newParentId),
						alive(sysTag),
					),
				);
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
				await tx.update(sysTag).set({ parent_id: newParentId, update_time: new Date() }).where(eq(sysTag.id, input.id));
				for (const [index, sibId] of input.orderedSiblingIds.entries()) {
					await tx.update(sysTag).set({ sort: index, update_time: new Date() }).where(eq(sysTag.id, sibId));
				}
			});
			const rows = await db.select().from(sysTag).where(alive(sysTag)).orderBy(asc(sysTag.sort), asc(sysTag.label));
			return { updated: input.orderedSiblingIds.length, rows: rows.map(toTag) };
		}),

	// ── 标签 ↔ 业务对象(多态多对多,表 = `sys_tag_relation`)────────────────

	/**
	 * **打标签**:把某个标签贴到一个业务对象上。
	 *
	 * - `objType` 由调用方定(如 `archive` / `source`),服务端**不枚举**它 —— 加一种对象不用改这里;
	 * - 只允许贴**叶子标签**:给「维度」贴标签没有业务含义(维度是分类,不是取值),这里直接拦掉;
	 * - 重复贴同一个 (tag, obj) 是**幂等**的:返回 `created: false`,不报错 —— 调用方不必先查再插。
	 */
	link: protectedProcedure
		.input(
			z.object({
				tagId: z.string().min(1).max(32),
				objId: z.string().min(1, "对象 id 不能为空").max(32),
				/** 业务对象类型是 **tinyint 码**(表定义如此),各业务自己登记码值 */
				objType: z.number().int().min(0).max(255),
			}),
		)
		.mutation(async ({ input }) => {
			// 被贴的标签 / 维度必须**活着**:软删的标签不能再贴到任何对象上
			const tag = await getAliveTagRow(input.tagId);
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
	unlink: protectedProcedure
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
	objectIdsOfTag: protectedProcedure
		.input(z.object({ tagId: z.string().min(1).max(32), objType: z.number().int().min(0).max(255).optional() }))
		.query(async ({ input }) => {
			const rows = await db
				.select({ objId: sysTagRelation.obj_id })
				.from(sysTagRelation)
				// join 回 `sys_tag` 只为过 `alive()`:软删标签的关联行不再算数(顺手把脏关联挡掉)
				.innerJoin(sysTag, eq(sysTag.id, sysTagRelation.tag_id))
				.where(
					and(
						input.objType === undefined
							? eq(sysTagRelation.tag_id, input.tagId)
							: sql`${sysTagRelation.tag_id} = ${input.tagId} and ${sysTagRelation.obj_type} = ${input.objType}`,
						alive(sysTag),
					),
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
	tagIdsOfObject: protectedProcedure
		.input(z.object({ objId: z.string().min(1).max(32), objType: z.number().int().min(0).max(255) }))
		.query(async ({ input }) => {
			const rows = await db
				.select({ tagId: sysTagRelation.tag_id })
				.from(sysTagRelation)
				// 同 `objectIdsOfTag`:只回**活着**的标签 id,已软删的标签不该再被算成"这个对象的标签"
				.innerJoin(sysTag, eq(sysTag.id, sysTagRelation.tag_id))
				.where(
					and(
						sql`${sysTagRelation.obj_type} = ${input.objType} and ${sysTagRelation.obj_id} = ${input.objId}`,
						alive(sysTag),
					),
				);
			return [...new Set(rows.map((row) => row.tagId))].sort();
		}),

	/** **查这个标签打在哪些对象上**:`objType` 可选(不传 = 所有类型的对象);带总数与分页 */
	objectsOfTag: protectedProcedure
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
			// join 回 `sys_tag` 并过 `alive()`:标签被软删之后,它的关联行不再算这个标签的对象
			const rows = await db
				.select({
					id: sysTagRelation.id,
					tag_id: sysTagRelation.tag_id,
					obj_id: sysTagRelation.obj_id,
					obj_type: sysTagRelation.obj_type,
					create_time: sysTagRelation.create_time,
				})
				.from(sysTagRelation)
				.innerJoin(sysTag, eq(sysTag.id, sysTagRelation.tag_id))
				.where(and(where, alive(sysTag)))
				.orderBy(asc(sysTagRelation.create_time), asc(sysTagRelation.obj_id))
				.limit(input.limit)
				.offset(input.offset);
			// 总数必须与上面同一条件(同 join 同 `alive`),否则"共 N 条"和列表对不上
			const [counted] = await db.execute(
				sql`select count(*) as n from ${sysTagRelation} inner join ${sysTag} on ${sysTag.id} = ${sysTagRelation.tag_id} where ${where} and ${alive(sysTag)}`,
			);
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
	tagsOfObject: protectedProcedure
		.input(z.object({ objId: z.string().min(1).max(32), objType: z.number().int().min(0).max(255) }))
		.query(async ({ input }) => {
			const links = await db
				.select()
				.from(sysTagRelation)
				.where(sql`${sysTagRelation.obj_type} = ${input.objType} and ${sysTagRelation.obj_id} = ${input.objId}`);
			if (links.length === 0) return { items: [] };

			const tagIds = links.map((link) => link.tag_id);
			// 只读**活着**的标签:已软删的取不到名字,下面的兜底会显示 id(而不是把软删的标签名继续回给前端)
			const tags = await db
				.select()
				.from(sysTag)
				.where(and(inArray(sysTag.id, tagIds), alive(sysTag)));
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
