/**
 * 字典管理(`sys_dict`)—— 集成测试。
 *
 * 重点验证「业务键 `code` 与主键 `id` 分工」这一口径:
 *  - 读写一律按 `code`;
 *  - `id` 是服务端生成的 nanoid;
 *  - `code` 唯一(重复新建要报 CONFLICT),且格式受约束。
 *
 * ⚠️ 会读写真实库;数据用 `__test__` 前缀,`after` 里清干净。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq, inArray } from "drizzle-orm";
import { sysDict } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { assertNanoid, assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

/**
 * 字典编码规则是 `^[a-z][a-z0-9_]*$`(**必须字母开头**)—— 所以测试编码不能直接用 `__test__` 前缀,
 * 用 `t` 开头再拼上标记,既能被规则接受、也一眼看得出是测试数据。
 */
const CODE = `t${TEST_PREFIX}dict_${uniqueSuffix()}`.toLowerCase();

/** 导入用例另起一个编码(前面的用例会把 CODE 删掉);名称带 `__test__` 前缀,好被兜底清扫认出 */
const IMPORT_CODE = `t${TEST_PREFIX}imp_${uniqueSuffix()}`.toLowerCase();
const IMPORT_NAME = `${TEST_PREFIX}导入字典`;

/** 统一软删只写 `deleted_at`、**行还在** —— 测试必须自己把造出来的行物理删掉(按 id 收口,别用 LIKE) */
const createdIds: string[] = [];

after(async () => {
	// 先按 `__test__` 前缀扫全表把本文件造的行收成 id(**必须在 router 软删之前**):
	// 软删会把 code 换成墓碑(`...#d#<id 尾段>`),之后再按 code 就查不到了。
	const leftovers = await db.select({ id: sysDict.id, code: sysDict.code, name: sysDict.name }).from(sysDict);
	for (const row of leftovers) {
		if (row.code.includes(TEST_PREFIX) || row.name.includes(TEST_PREFIX)) createdIds.push(row.id);
	}
	await caller.dict.remove({ codes: [CODE] }).catch(() => undefined);
	await caller.dict.remove({ codes: [IMPORT_CODE] }).catch(() => undefined);
	const ids = [...new Set(createdIds)];
	if (ids.length > 0) {
		await db.delete(sysDict).where(inArray(sysDict.id, ids));
	}
});

test("新建字典:服务端生成 nanoid 主键,业务键是 code", async () => {
	const created = await caller.dict.create({
		code: CODE,
		name: "测试字典",
		remark: "集成测试",
		items: [
			{ label: "甲", value: "a" },
			{ label: "乙", value: "b" },
		],
	});
	assert.equal(created.code, CODE);
	assertNanoid(created.id, "dict.create 返回的 id");
	createdIds.push(created.id);

	const [stored] = await db.select().from(sysDict).where(eq(sysDict.code, CODE)).limit(1);
	assert.ok(stored);
	assertNanoid(stored.id, "库里存的 id");
	assert.equal(stored.code, CODE);
});

test("按 code 读:byCode 拿得到,list 里也在", async () => {
	const row = await caller.dict.byCode({ code: CODE });
	assert.ok(row, "byCode 应返回这一行");
	assert.equal(row.name, "测试字典");
	assert.equal(row.items.length, 2);
	assert.equal(row.status, 1);

	const list = await caller.dict.list();
	assert.ok(
		list.some((item) => item.code === CODE),
		"list 里应包含它",
	);
});

test("编码必须唯一:重复新建报 CONFLICT", async () => {
	await assertRejects(
		() => caller.dict.create({ code: CODE, name: "重名", remark: "", items: [{ label: "甲", value: "a" }] }),
		"已存在",
	);
});

test("编码格式受约束:大写 / 数字开头都不行", async () => {
	await assertRejects(() => caller.dict.create({ code: "BadCode", name: "大写", remark: "", items: [] }), "小写字母");
	await assertRejects(() => caller.dict.create({ code: "1st", name: "数字开头", remark: "", items: [] }), "小写字母");
});

test("字典项取值不能重复", async () => {
	await assertRejects(
		() =>
			caller.dict.update({
				code: CODE,
				name: "测试字典",
				remark: "",
				status: true,
				items: [
					{ label: "甲", value: "same" },
					{ label: "乙", value: "same" },
				],
			}),
		"有重复",
	);
});

test("更新:改名 / 换字典项 / 停用 —— code 不变,主键不变", async () => {
	const before = await caller.dict.byCode({ code: CODE });
	await caller.dict.update({
		code: CODE,
		name: "测试字典(改)",
		remark: "改过",
		status: false,
		items: [{ label: "丙", value: "c" }],
	});

	const after = await caller.dict.byCode({ code: CODE });
	assert.ok(before && after);
	assert.equal(after.id, before.id, "主键不应变化");
	assert.equal(after.code, CODE, "业务键不应变化");
	assert.equal(after.name, "测试字典(改)");
	assert.equal(after.status, 0, "停用后 status = 0");
	assert.deepEqual(after.items, [{ label: "丙", value: "c" }]);
});

test("更新不存在的编码 → NOT_FOUND", async () => {
	await assertRejects(
		() =>
			caller.dict.update({ code: `t_missing_x_${uniqueSuffix()}`, name: "无", remark: "", status: true, items: [] }),
		"不存在",
	);
});

test("删除:按 code 软删,行保留(deleted_at 非空),byCode 就当它不存在", async () => {
	const before = await caller.dict.byCode({ code: CODE });
	assert.ok(before, "删除前应读得到");
	await caller.dict.remove({ codes: [CODE] });
	assert.equal(await caller.dict.byCode({ code: CODE }), null);
	const [kept] = await db.select().from(sysDict).where(eq(sysDict.id, before.id));
	assert.ok(kept, "软删要留行(审计留痕),不是物理删除");
	assert.ok(kept.deleted_at, "deleted_at 应被写上");
	assert.notEqual(kept.code, CODE, "业务键让位(加墓碑后缀),同一个 code 才能再建");
	createdIds.push(before.id);
});

test("删除不存在的编码 → NOT_FOUND", async () => {
	await assertRejects(() => caller.dict.remove({ codes: [`t_missing_y_${uniqueSuffix()}`] }), "不存在");
});

/**
 * 软删最容易踩的坑:唯一的 `code` 被已删的行占着 ⇒ 想用同一个编码重建会撞唯一键。
 * 所以删除时把 code 写成墓碑(见 `lib/soft-delete.ts` 的 `tombstone()`),这条用例守住这个行为。
 */
test("软删后能用同一个 code 再建(墓碑让位,不撞唯一键)", async () => {
	const again = await caller.dict.create({
		code: CODE,
		name: "测试字典(重建)",
		remark: "",
		items: [{ label: "甲", value: "a" }],
	});
	createdIds.push(again.id);
	assert.equal(again.code, CODE);
	assert.equal((await caller.dict.byCode({ code: CODE }))?.name, "测试字典(重建)");
});

/**
 * 导入 —— 字段契约是「一行 = 一个字典项」(`code / name / label / value / remark`),
 * 这里只测接口语义:按编码聚合、并入(幂等)、逐行报错。列头与摊平在
 * `src/components/modules/settings/settings-dictionary-excel.ts`(纯前端件,不为十几行映射把 React 链拖进 tests)。
 */
test("导入:新编码 —— 多行归成一个字典,名称取第一行有值的那个", async () => {
	const result = await caller.dict.import({
		rows: [
			{ code: IMPORT_CODE, name: IMPORT_NAME, label: "甲", value: "a", remark: "导入" },
			{ code: IMPORT_CODE, name: "", label: "乙", value: "b", remark: "" },
		],
	});
	assert.equal(result.created, 2);
	assert.equal(result.errors.length, 0);

	const row = await caller.dict.byCode({ code: IMPORT_CODE });
	assert.ok(row, "导入后应能按 code 读到");
	assert.equal(row.name, IMPORT_NAME);
	assert.equal(row.remark, "导入");
	assert.equal(row.status, 1, "新建的字典是启用的");
	assert.deepEqual(row.items, [
		{ label: "甲", value: "a" },
		{ label: "乙", value: "b" },
	]);
});

test("导入:再导一次是幂等的 —— 已有的取值进 duplicates,不覆盖、不改小", async () => {
	const result = await caller.dict.import({
		rows: [
			{ code: IMPORT_CODE, name: "", label: "甲", value: "a" },
			{ code: IMPORT_CODE, name: "", label: "丙", value: "c" },
		],
	});
	assert.equal(result.created, 1, "只有 c 是新增的");
	assert.equal(result.duplicates.length, 1, "a 已存在");
	assert.equal(result.errors.length, 0);

	const row = await caller.dict.byCode({ code: IMPORT_CODE });
	assert.equal(row?.items.length, 3, "a 还在,没被覆盖掉");
	assert.equal(row?.name, IMPORT_NAME, "名称为空的行不改名");
});

test("导入:逐行校验 —— 编码格式 / label-value 配对 / 新建缺名称", async () => {
	const result = await caller.dict.import({
		rows: [
			{ code: "BadCode", name: "大写", label: "甲", value: "a" },
			{ code: IMPORT_CODE, name: "", label: "只有名称", value: "" },
			{ code: `t${TEST_PREFIX}noname_${uniqueSuffix()}`.toLowerCase(), name: "", label: "", value: "" },
		],
	});
	assert.equal(result.created, 0);
	assert.equal(result.errors.length, 3);
	assert.match(result.errors[0]?.message ?? "", /小写字母/);
	assert.match(result.errors[1]?.message ?? "", /要么都填/);
	assert.match(result.errors[2]?.message ?? "", /字典名称/);
});

after(async () => {
	await closeDb();
});
