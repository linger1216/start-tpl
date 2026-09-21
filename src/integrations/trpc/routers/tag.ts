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
 * | `delete` | mutation | **级联删除**:连子节点一起删(维度下挂一堆标签,逐个删太累) |
 * | `move` | mutation | **同级重排 / 跨父迁移**:把节点挂到新父下,并按给定顺序重写同级 `sort` |
 *
 * 树不在这里拼:服务端只回平铺行,拼树 + 过滤是纯函数,放前端更好测(见 `settings-tags-page.tsx` 的 `buildTagTree`)。
 */
import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysTag } from "#/db/data-base-schema";
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
				label: z.string().min(1, "名称不能为空").max(191),
				value: z.string().max(512).nullable().optional(),
				desc: z.string().max(512).nullable().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const parentId = input.parentId ?? null;
			if (parentId) await getTagRow(parentId);
			const label = input.label.trim();

			const taken = new Set((await db.select({ id: sysTag.id }).from(sysTag)).map((row) => row.id));
			let id = parentId ? `${parentId}::${label}` : `dim::${label}`;
			let suffix = 2;
			while (taken.has(id)) {
				id = `${parentId ? `${parentId}::` : "dim::"}${label}#${suffix}`;
				suffix += 1;
			}
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
				label: z.string().min(1, "名称不能为空").max(191),
				value: z.string().max(512).nullable().optional(),
				desc: z.string().max(512).nullable().optional(),
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
		await db.delete(sysTag).where(eq(sysTag.id, input.id));
		// 级联:父被删,子节点也跟着删(子节点的 parent_id 现在指向已不存在的父,留着会变成孤儿)
		if (ids.length > 1) {
			await db.delete(sysTag).where(sql`${sysTag.id} in (${ids.slice(1)})`);
		}
		return { deleted: ids.length };
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
});
