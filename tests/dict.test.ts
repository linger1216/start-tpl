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

import { eq } from "drizzle-orm";
import { sysDict } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { assertNanoid, assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

/**
 * 字典编码规则是 `^[a-z][a-z0-9_]*$`(**必须字母开头**)—— 所以测试编码不能直接用 `__test__` 前缀,
 * 用 `t` 开头再拼上标记,既能被规则接受、也一眼看得出是测试数据。
 */
const CODE = `t${TEST_PREFIX}dict_${uniqueSuffix()}`.toLowerCase();

after(async () => {
	await caller.dict.delete({ code: CODE }).catch(() => undefined);
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

test("删除:按 code 删,删完 byCode 返回 null", async () => {
	await caller.dict.delete({ code: CODE });
	assert.equal(await caller.dict.byCode({ code: CODE }), null);
	assert.equal((await db.select().from(sysDict).where(eq(sysDict.code, CODE))).length, 0);
});

test("删除不存在的编码 → NOT_FOUND", async () => {
	await assertRejects(() => caller.dict.delete({ code: `t_missing_y_${uniqueSuffix()}` }), "不存在");
});

after(async () => {
	await closeDb();
});
