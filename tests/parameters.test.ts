/**
 * 参数管理(`sys_para`)—— 集成测试。
 *
 * 测的是 tRPC procedure + 真实 SQL(直调 caller,不起 HTTP 服务):
 * 新增 → 列表 → 单键读 → 改值 → 校验拦截 → 删除,外加"主键必须是 nanoid"。
 *
 * 表口径(最新 DDL):表名 `sys_para`,主键 `para_key`,列 `para_value` / `para_type`(tinyint 码)。
 *
 * ⚠️ 会读写 `.env.local` 指向的库。所有数据用 `__test__` 前缀,`after` 里清干净。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq } from "drizzle-orm";

import { sysPara } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { PARA_TYPE } from "../src/lib/para-spec.ts";
import { PARA_DEFAULTS } from "../src/lib/sys-para.ts";
import { assertNanoid, assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const KEY = `${TEST_PREFIX}parameters.${SUFFIX}`;
const INT_KEY = `${TEST_PREFIX}parameters.int.${SUFFIX}`;
const BOOL_KEY = `${TEST_PREFIX}parameters.bool.${SUFFIX}`;
const UPSERT_KEY = `${TEST_PREFIX}parameters.upsert.${SUFFIX}`;

after(async () => {
	for (const key of [KEY, INT_KEY, BOOL_KEY, UPSERT_KEY]) {
		await caller.para.delete({ key });
	}
});

test("新增 → 列表里能看到,并且回的都是表里真有的列", async () => {
	await caller.para.create({
		key: KEY,
		value: "hello",
		type: PARA_TYPE.STRING,
		group: `${TEST_PREFIX}分组`,
		remark: "测试用参数",
	});

	const rows = await caller.para.list();
	const row = rows.find((item) => item.key === KEY);
	assert.ok(row, "新增的参数应出现在清单里");
	assert.equal(row.value, "hello");
	assert.equal(row.type, PARA_TYPE.STRING, "para_type 是数字码,不是字符串");
	assert.equal(row.group, `${TEST_PREFIX}分组`);
	assert.equal(row.remark, "测试用参数");
	assert.equal(row.editable, true);
	// 出参不含「来源 / 默认值」这类表里没有的派生字段(踩过:界面上出现过库中不存在的列)
	assert.deepEqual(
		Object.keys(row).sort(),
		["editable", "group", "key", "remark", "status", "type", "updatedAt", "value"],
		"para.list 的出参字段应与 sys_para 的列一一对应",
	);
});

test("主键是 nanoid(不是语义串);para_key 才是主键", async () => {
	const [stored] = await db.select().from(sysPara).where(eq(sysPara.para_key, KEY)).limit(1);
	assert.ok(stored, "库里应有这一行");
	assertNanoid(stored.id, `${KEY}.id`);
	assert.equal(stored.para_type, PARA_TYPE.STRING);
});

test("byKey 单键读:库里的值优先,不存在的键回空串", async () => {
	assert.equal((await caller.para.byKey({ key: KEY })).value, "hello");
	const missing = await caller.para.byKey({ key: `${TEST_PREFIX}not-exists` });
	assert.equal(missing.value, "");
});

test("update 改值:已存在的行走 update,不新增行", async () => {
	await caller.para.update({ key: KEY, value: "world" });
	assert.equal((await caller.para.byKey({ key: KEY })).value, "world");

	const all = await db.select().from(sysPara).where(eq(sysPara.para_key, KEY));
	assert.equal(all.length, 1, "同一个 para_key 不应出现两行");
});

test("update 遇到不存在的键 = 插入(upsert 的另一半),类型回落到文本", async () => {
	await caller.para.update({ key: UPSERT_KEY, value: "42" });
	const stored = await db.select().from(sysPara).where(eq(sysPara.para_key, UPSERT_KEY));
	assert.equal(stored.length, 1);
	assertNanoid(stored[0]?.id, `${UPSERT_KEY}.id`);
	// 不在 PARA_DEFAULTS 里的新键没有类型可依,回落成文本(所以 "42" 也只是字符串)
	assert.equal(stored[0]?.para_type, PARA_TYPE.STRING);
});

test("按类型校验:整数参数填非数字会被拦下", async () => {
	await caller.para.create({ key: INT_KEY, value: "42", type: PARA_TYPE.INT });
	await assertRejects(() => caller.para.update({ key: INT_KEY, value: "abc" }), "整数");
	// 拦下之后原值不变
	assert.equal((await caller.para.byKey({ key: INT_KEY })).value, "42");
});

test("布尔参数只接受 true / false", async () => {
	await caller.para.create({ key: BOOL_KEY, value: "true", type: PARA_TYPE.BOOL });
	await assertRejects(() => caller.para.update({ key: BOOL_KEY, value: "yes" }), "true / false");
});

test("delete:删完 byKey 回落代码默认值(空串)", async () => {
	await caller.para.delete({ key: KEY });
	assert.equal((await caller.para.byKey({ key: KEY })).value, "");
	assert.equal((await db.select().from(sysPara).where(eq(sysPara.para_key, KEY))).length, 0);
});

test("代码内置的参数:即使库里没有行,清单也要列出它(否则人不知道能调什么)", async () => {
	// 注意:这里**不删任何真实数据** —— 只断言"内置参数的键一个都不少"。
	// (早先这条例用 delete 造空行,虽然会跑 seed 补回来,但那是在动用户的库;测试不该这么干。)
	const rows = await caller.para.list();
	const keys = new Set(rows.map((row) => row.key));
	for (const key of Object.keys(PARA_DEFAULTS)) {
		assert.ok(keys.has(key), `内置参数 ${key} 应出现在清单里`);
	}
});

after(async () => {
	await closeDb();
});
