/**
 * 标签种子脚本 —— 把 `mocks/tags.ts` 的维度 + 标签写成 `sys_tag` 表的行(幂等,只补不覆盖)。
 *
 * 标签体系是两级树:**维度**(一级,`parent_id` 为 null)→ **标签**(叶子)。
 * 这里把 `TAG_DIMENSION_SEED` 写成维度行、`TAG_SEED` 写成对应维度下的标签行。
 *
 * 判重口径(**业务键,不是主键**):`(parent_id, label)` —— 同一维度下同名标签视为同一行。
 * 主键是 nanoid,每次生成都不同,拿它判重会导致每次重跑都多一份标签体系。
 *
 * 用法:
 *   pnpm db:seed:tags
 */
import "dotenv/config";

import { sysTag } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { newId } from "../src/lib/ids.ts";
import { TAG_DIMENSION_SEED, TAG_SEED } from "../src/mocks/tags.ts";

type ExistingRow = { id: string; parent_id: string | null; label: string };

const existing: ExistingRow[] = await db
	.select({ id: sysTag.id, parent_id: sysTag.parent_id, label: sysTag.label })
	.from(sysTag);
/** `${parentId ?? ""}::${label}` → 已存在的行 */
const byKey = new Map(existing.map((row) => [`${row.parent_id ?? ""}::${row.label}`, row]));

const toInsert: Array<typeof sysTag.$inferInsert> = [];
const dimIdByName = new Map<string, string>();
let addedDims = 0;
let addedTags = 0;

// ── 1) 维度(一级节点)──
for (const [index, dimension] of TAG_DIMENSION_SEED.entries()) {
	const key = `::${dimension.维度}`;
	const found = byKey.get(key);
	if (found) {
		dimIdByName.set(dimension.维度, found.id);
		continue;
	}
	const id = newId();
	dimIdByName.set(dimension.维度, id);
	toInsert.push({
		id,
		parent_id: null,
		label: dimension.维度,
		value: dimension.维度,
		desc: dimension.备注 || null,
		sort: index,
	});
	addedDims += 1;
}

// ── 2) 标签(挂在维度下)──
for (const [index, tag] of TAG_SEED.entries()) {
	const parentId = dimIdByName.get(tag.维度) ?? null;
	const key = `${parentId ?? ""}::${tag.标签}`;
	if (byKey.has(key)) continue;
	toInsert.push({
		id: newId(),
		parent_id: parentId,
		label: tag.标签,
		value: tag.标签,
		desc: tag.含义 || null,
		sort: index,
	});
	addedTags += 1;
}

if (toInsert.length > 0) await db.insert(sysTag).values(toInsert);

const all = await db.select({ id: sysTag.id }).from(sysTag);
console.log(
	`✓ 标签种子完成:维度 ${TAG_DIMENSION_SEED.length} 个(新增 ${addedDims})+ 标签 ${TAG_SEED.length} 条(新增 ${addedTags}),表内共 ${all.length} 行(已存在的未覆盖)`,
);
process.exit(0);
