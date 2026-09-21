/**
 * 标签种子脚本 —— 把 `mocks/tags.ts` 的维度 + 标签写成 `sys_tag` 表的行(幂等,只补不覆盖)。
 *
 * 标签体系是两级树:**维度**(一级,`parent_id` 为 null)→ **标签**(叶子)。这里把
 * `TAG_DIMENSION_SEED` 写成维度行、把 `TAG_SEED` 写成对应维度下的标签行,id 用种子里的稳定编码
 * (`DIM-xx` / `TAG-xxxx`),重跑不会重复插入已存在的行。
 *
 * 用法:
 *   pnpm db:seed:tags
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { sysTag } from "../src/db/data-base-schema.ts";
import { TAG_DIMENSION_SEED, TAG_SEED } from "../src/mocks/tags.ts";
import { db } from "../src/db/index.ts";

type TagSeedRow = {
	id: string;
	parentId: string | null;
	label: string;
	value: string | null;
	desc: string | null;
	sort: number;
};

const rows: TagSeedRow[] = [];
const dimIdByDimension = new Map<string, string>();

TAG_DIMENSION_SEED.forEach((dimension, index) => {
	const id = `tag-${dimension.id}`;
	dimIdByDimension.set(dimension.维度, id);
	rows.push({
		id,
		parentId: null,
		label: dimension.维度,
		value: dimension.维度,
		desc: dimension.备注 || null,
		sort: index,
	});
});

TAG_SEED.forEach((tag, index) => {
	const parentId = dimIdByDimension.get(tag.维度) ?? null;
	rows.push({
		id: `tag-${tag.id}`,
		parentId,
		label: tag.标签,
		value: tag.标签,
		desc: tag.含义 || null,
		sort: index,
	});
});

const inserted = await db
	.insert(sysTag)
	.values(rows)
	.onDuplicateKeyUpdate({ set: { id: sql`${sysTag.id}` } });

const all = await db.select({ id: sysTag.id }).from(sysTag);
console.log(`✓ 标签种子完成:维度 ${TAG_DIMENSION_SEED.length} 个 + 标签 ${TAG_SEED.length} 条,表内共 ${all.length} 行(已存在的未覆盖)`);
void inserted;
process.exit(0);
