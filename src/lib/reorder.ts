/**
 * 同级拖拽排序的**唯一一份**服务端口径(菜单树 / 部门树共用)。
 *
 * 为什么把"同一批"整体传上来校验:拖拽最容易出的错就是"跨级拖",与其在服务端猜,
 * 不如让调用方把"这一层的完整名单"给出来 —— 只要名单里出现了兄弟之外的行,直接拒绝。
 * (前端 UI 同样只允许落在同级之间,两层防线。)
 *
 * 两个调用方只有"文案里的名词"不同(`菜单` / `父节点` vs `部门` / `上级`),
 * 校验与写入语义完全一致 —— 这类"少个守卫就悄悄放行脏数据"的逻辑不该有两份。
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "#/db";
import type { sysDept, sysMenu } from "#/db/data-base-schema";
import { alive } from "#/lib/soft-delete";

export async function reorderSiblings(args: {
	table: typeof sysMenu | typeof sysDept;
	parentId: string | null;
	orderedIds: string[];
	/** 文案里的名词,如「菜单」/「部门」 */
	noun: string;
	/** 「不属于同一…」的后半句,如「父节点」/「上级」 */
	parentNoun: string;
}): Promise<number> {
	const { table, parentId, orderedIds, noun, parentNoun } = args;
	// 同级集合只看活着的:已软删的兄弟不该出现在"必须包含全部同级"的清单里
	const siblings = await db
		.select({ id: table.id })
		.from(table)
		.where(and(parentId === null ? sql`${table.parent_id} is null` : eq(table.parent_id, parentId), alive(table)));
	const siblingIds = new Set(siblings.map((row) => row.id));
	const unknown = orderedIds.filter((id) => !siblingIds.has(id));
	if (unknown.length > 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `只能在同一级内排序,以下${noun}不属于同一${parentNoun}:${unknown.join("、")}`,
		});
	}
	if (orderedIds.length !== siblingIds.size) {
		throw new TRPCError({ code: "BAD_REQUEST", message: `排序清单必须包含该级下全部${noun}` });
	}
	// 事务里逐行写 sort:要么全改、要么不改
	await db.transaction(async (tx) => {
		for (const [index, id] of orderedIds.entries()) {
			await tx.update(table).set({ sort: index, update_time: new Date() }).where(eq(table.id, id));
		}
	});
	return orderedIds.length;
}
