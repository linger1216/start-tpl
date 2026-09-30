/**
 * 标签 API(`sys_tag` + `sys_tag_relation`)—— 集成测试。
 *
 * 覆盖两半:
 *  1. **标签树**:建维度 / 建标签 / 同级重名拦截 / 级联删除;
 *  2. **打标签**:link(幂等)/ unlink(幂等)/ objectsOfTag / tagsOfObject,
 *     以及两条业务规则 —— 维度不能贴到对象上、删标签要连带清掉它的关联。
 *
 * ⚠️ 会读写真实库;数据用 `__test__` 前缀,`after` 里整枝删掉。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import { sysTag } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { assertNanoid, assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const DIM_LABEL = `${TEST_PREFIX}维度_${SUFFIX}`;
const TAG_LABEL = `${TEST_PREFIX}标签_${SUFFIX}`;
const OBJ_ID = `${TEST_PREFIX}obj_${SUFFIX}`;
const OBJ_TYPE = 90; // 业务对象类型是 tinyint 码(测试占一个没人用的)
const OBJ_TYPE_OTHER = 91;

/** 运行时记录 id,便于清理 */
const created: { dimId?: string; tagId?: string } = {};

after(async () => {
	// 整枝删除(会被删两次也没关系:delete 对不存在的行会抛 NOT_FOUND,所以包一层)
	if (created.dimId) await caller.tag.delete({ id: created.dimId }).catch(() => undefined);
	const leftovers = await db
		.select({ id: sysTag.id })
		.from(sysTag)
		.where(inArray(sysTag.label, [DIM_LABEL, TAG_LABEL]));
	if (leftovers.length > 0) {
		await db.delete(sysTag).where(
			inArray(
				sysTag.id,
				leftovers.map((row) => row.id),
			),
		);
	}
});

test("建维度:主键是 nanoid", async () => {
	const dim = await caller.tag.create({ parentId: null, label: DIM_LABEL, value: DIM_LABEL, desc: "集成测试维度" });
	created.dimId = dim.id;
	assertNanoid(dim.id, "维度 id");
	assert.equal(dim.parentId, null);
	assert.equal(dim.label, DIM_LABEL);

	const [stored] = await db.select().from(sysTag).where(eq(sysTag.id, dim.id)).limit(1);
	assertNanoid(stored?.id, "库里存的维度 id");
});

test("建标签:挂在维度下,parent_id 是维度的 nanoid", async () => {
	assert.ok(created.dimId, "上一条用例应先建好维度");
	const tag = await caller.tag.create({
		parentId: created.dimId,
		label: TAG_LABEL,
		value: TAG_LABEL,
		desc: "集成测试标签",
	});
	created.tagId = tag.id;
	assertNanoid(tag.id, "标签 id");
	assert.equal(tag.parentId, created.dimId);
});

test("同一父下不允许重名", async () => {
	await assertRejects(() => caller.tag.create({ parentId: created.dimId ?? null, label: TAG_LABEL }), "已经有");
});

test("list 拿得到两级节点", async () => {
	const rows = await caller.tag.list();
	assert.ok(rows.some((row) => row.id === created.dimId));
	assert.ok(rows.some((row) => row.id === created.tagId));
});

test("打标签:link 成功,重复贴幂等(不报错、不多出行)", async () => {
	assert.ok(created.tagId, "上一条用例应先建好标签");
	const first = await caller.tag.link({ tagId: created.tagId, objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(first.created, true);
	assertNanoid(first.id, "关联行 id");

	const second = await caller.tag.link({ tagId: created.tagId, objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(second.created, false, "重复贴应返回 created: false");
	assert.equal(second.id, first.id, "重复贴应指向同一条关联");

	const { total } = await caller.tag.objectsOfTag({ tagId: created.tagId });
	assert.equal(total, 1, "同一个 (tag, obj) 只应有一条关联");
});

test("维度不能贴到对象上(维度是分类,不是取值)", async () => {
	await assertRejects(
		() => caller.tag.link({ tagId: created.dimId as string, objId: OBJ_ID, objType: OBJ_TYPE }),
		"维度",
	);
});

test("查对象身上有哪些标签:带标签名,前端可直接渲染", async () => {
	const { items } = await caller.tag.tagsOfObject({ objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(items.length, 1);
	assert.equal(items[0]?.label, TAG_LABEL);
	assert.equal(items[0]?.tagId, created.tagId);
	assert.equal(items[0]?.parentId, created.dimId);
});

test("查标签打在哪些对象上:可按 objType 过滤,带总数", async () => {
	const all = await caller.tag.objectsOfTag({ tagId: created.tagId as string });
	assert.equal(all.total, 1);
	assert.equal(all.items[0]?.objId, OBJ_ID);
	assert.equal(all.items[0]?.objType, OBJ_TYPE);

	const same = await caller.tag.objectsOfTag({ tagId: created.tagId as string, objType: OBJ_TYPE });
	assert.equal(same.total, 1);

	const other = await caller.tag.objectsOfTag({ tagId: created.tagId as string, objType: OBJ_TYPE_OTHER });
	assert.equal(other.total, 0, "换个 objType 应查不到");
});

test("只要 id 的两个接口:objectIdsOfTag / tagIdsOfObject", async () => {
	assert.ok(created.tagId);
	// 贴两个对象,验证"按标签查对象 id"能一次拿到多个、且去重排序
	const second = await caller.tag.link({ tagId: created.tagId, objId: `${OBJ_ID}_2`, objType: OBJ_TYPE });
	assert.equal(second.created, true);
	// 重复贴同一个 (tag, obj) 不应产生第二条
	await caller.tag.link({ tagId: created.tagId, objId: `${OBJ_ID}_2`, objType: OBJ_TYPE });

	const objIds = await caller.tag.objectIdsOfTag({ tagId: created.tagId });
	assert.deepEqual(objIds, [OBJ_ID, `${OBJ_ID}_2`].sort(), "回的是去重排序后的对象 id 数组");

	const filtered = await caller.tag.objectIdsOfTag({ tagId: created.tagId, objType: OBJ_TYPE_OTHER });
	assert.deepEqual(filtered, [], "换个 objType 应为空");

	const tagIds = await caller.tag.tagIdsOfObject({ objId: OBJ_ID, objType: OBJ_TYPE });
	assert.deepEqual(tagIds, [created.tagId]);
	assert.deepEqual(await caller.tag.tagIdsOfObject({ objId: "not-linked", objType: OBJ_TYPE }), []);

	// 收尾:把第二个对象也解绑,后面的用例才好断言
	await caller.tag.unlink({ tagId: created.tagId, objId: `${OBJ_ID}_2`, objType: OBJ_TYPE });
});

test("解绑:第一次删掉一条,第二次幂等返回 0", async () => {
	assert.ok(created.tagId);
	const first = await caller.tag.unlink({ tagId: created.tagId, objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(first.removed, 1);

	const second = await caller.tag.unlink({ tagId: created.tagId, objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(second.removed, 0, "重复解绑不应报错");

	const { items } = await caller.tag.tagsOfObject({ objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(items.length, 0);
});

test("删维度:连子标签和它们身上的关联一起清掉", async () => {
	assert.ok(created.dimId && created.tagId);
	// 先重新贴一条,验证级联清理
	await caller.tag.link({ tagId: created.tagId, objId: OBJ_ID, objType: OBJ_TYPE });

	const result = await caller.tag.delete({ id: created.dimId });
	assert.equal(result.deleted, 2, "维度 + 它下面的 1 个标签");
	assert.equal(result.removedLinks, 1, "标签身上的关联也要清");

	// 标签节点没了
	assert.equal((await db.select().from(sysTag).where(eq(sysTag.id, created.tagId))).length, 0);
	// 关联也没了(再查对象应是空)
	const { items } = await caller.tag.tagsOfObject({ objId: OBJ_ID, objType: OBJ_TYPE });
	assert.equal(items.length, 0);
	created.dimId = undefined;
	created.tagId = undefined;
});

after(async () => {
	await closeDb();
});
