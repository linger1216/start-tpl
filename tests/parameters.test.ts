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

import { eq, inArray } from "drizzle-orm";

import { sysPara } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { PAGE_SIZE_KEY, parsePageSize } from "../src/hooks/use-para-prefs.ts";
import { PAGE_SIZES } from "../src/lib/constants.ts";
import { PARA_TYPE } from "../src/lib/para-spec.ts";
import { PARA_DEFAULTS } from "../src/lib/sys-para.ts";
import { assertNanoid, assertRejects, caller, closeDb, TEST_PREFIX, uniqueSuffix } from "./helpers.ts";

const SUFFIX = uniqueSuffix();
const KEY = `${TEST_PREFIX}parameters.${SUFFIX}`;
const INT_KEY = `${TEST_PREFIX}parameters.int.${SUFFIX}`;
const BOOL_KEY = `${TEST_PREFIX}parameters.bool.${SUFFIX}`;
const UPSERT_KEY = `${TEST_PREFIX}parameters.upsert.${SUFFIX}`;
/** 导入用例自己的键(用例里自己建,不依赖别的用例的执行顺序) */
const IMPORT_KEY = `${TEST_PREFIX}parameters.import.${SUFFIX}`;
const IMPORT_INT_KEY = `${TEST_PREFIX}parameters.importInt.${SUFFIX}`;
const LOCKED_KEY = `${TEST_PREFIX}parameters.locked.${SUFFIX}`;

after(async () => {
	for (const key of [KEY, INT_KEY, BOOL_KEY, UPSERT_KEY, IMPORT_KEY, IMPORT_INT_KEY, LOCKED_KEY]) {
		await caller.para.remove({ keys: [key] }).catch(() => undefined); // 有的用例没建过它,现在 delete 会 NOT_FOUND
	}
	// 软删只写 deleted_at、行还在,而且主键 para_key 已被墓碑改掉 —— 按 key 查不到,只能扫全表认 `__test__` 前缀
	const rows = await db.select({ id: sysPara.id, key: sysPara.para_key }).from(sysPara);
	const ids = rows.filter((row) => row.key.includes(TEST_PREFIX)).map((row) => row.id);
	if (ids.length > 0) {
		await db.delete(sysPara).where(inArray(sysPara.id, ids));
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
		["createdAt", "editable", "group", "id", "key", "remark", "status", "type", "updatedAt", "value"],
		"para.list 的出参字段应与 sys_para 的十列一一对应",
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

test("delete:软删(行保留、deleted_at 非空),byKey 回落代码默认值(空串)", async () => {
	const [before] = await db.select().from(sysPara).where(eq(sysPara.para_key, KEY)).limit(1);
	assert.ok(before, "删除前库里应有这一行");
	await caller.para.remove({ keys: [KEY] });
	assert.equal((await caller.para.byKey({ key: KEY })).value, "");
	// 软删:按 para_key 查不到了(主键已让位),但行还在 —— 只能按 id 找
	const [kept] = await db.select().from(sysPara).where(eq(sysPara.id, before.id));
	assert.ok(kept, "软删要留行(审计留痕),不是物理删除");
	assert.ok(kept.deleted_at, "deleted_at 应被写上");
	assert.notEqual(kept.para_key, KEY, "主键让位,同一个 key 才能再建");
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

test("界面偏好 `page.size`:代码内置默认 20,解析只认分页器那几档", async () => {
	const spec = PARA_DEFAULTS[PAGE_SIZE_KEY];
	assert.ok(spec, `PARA_DEFAULTS 里必须有 ${PAGE_SIZE_KEY}`);
	assert.equal(spec.value, "20", "默认每每页条数就是 20");
	assert.equal(spec.type, PARA_TYPE.INT);
	assert.equal(spec.group, "界面偏好");

	// 解析规则:分页器只给 4 档按钮,PAGE_SIZES 之外的値按 20 处理(不猜"最接近的那档")
	assert.equal(parsePageSize("50"), 50);
	assert.equal(parsePageSize("30"), 20);
	assert.equal(parsePageSize("abc"), 20);
	assert.equal(parsePageSize(""), 20);
	assert.equal(parsePageSize(undefined), 20);

	// 读得出来:库里没有这行时也回代码默认值(否则列表页会拿不到页尺寸)
	const { value } = await caller.para.byKey({ key: PAGE_SIZE_KEY });
	// 断言"解析出来的一定是分页器上的某一档",而不是"必须等于 20" —— 那是代码默认值,人是可以改参数的
	const parsed = parsePageSize(value);
	assert.ok((PAGE_SIZES as readonly number[]).includes(parsed), `${PAGE_SIZE_KEY} = ${value} 必须落在 PAGE_SIZES 里`);
	assert.deepEqual(PAGE_SIZES, [10, 20, 50, 100]);
});

/**
 * 导入 —— 一行 = 一条参数(列契约 `PARA_EXCEL_COLUMNS`,表头与导出同一组)。
 * 只测接口语义:upsert / duplicates / 逐行校验 + 内置参数跳过;列头与摊平在
 * `settings-parameters-excel.ts`(纯前端件,不为十几行映射把 React 链拖进 tests)。
 */
test("导入:新键按「类型」列建,已有键改值(空单元格不动库里的分组 / 说明)", async () => {
	await caller.para.create({
		key: IMPORT_KEY,
		value: "old",
		type: PARA_TYPE.STRING,
		group: "旧分组",
		remark: "旧说明",
	});
	const result = await caller.para.import({
		rows: [
			{ key: IMPORT_INT_KEY, value: "7", type: "整数", group: `${TEST_PREFIX}分组`, remark: "导入进来的" },
			{ key: IMPORT_KEY, value: "new", type: "", group: "", remark: "" },
		],
	});
	assert.equal(result.created, 2);
	assert.equal(result.errors.length, 0);

	const rows = await caller.para.list();
	const created = rows.find((row) => row.key === IMPORT_INT_KEY);
	assert.ok(created, "新键应被建出来");
	assert.equal(created.value, "7");
	assert.equal(created.type, PARA_TYPE.INT, "「整数」这个中文名要认");
	assert.equal(created.group, `${TEST_PREFIX}分组`);
	assert.equal(created.remark, "导入进来的");
	assert.equal(created.editable, true);

	const updated = rows.find((row) => row.key === IMPORT_KEY);
	assert.equal(updated?.value, "new", "已有键改值");
	assert.equal(updated?.group, "旧分组", "空单元格不清库里的分组");
	assert.equal(updated?.remark, "旧说明", "空单元格不清库里的说明");
});

test("导入:和库里一样算 duplicates —— 重复导入不假装改了一堆", async () => {
	const rows = [
		{ key: IMPORT_INT_KEY, value: "7", type: "整数", group: `${TEST_PREFIX}分组`, remark: "导入进来的" },
		{ key: IMPORT_KEY, value: "new", type: "文本", group: "旧分组", remark: "旧说明" },
	];
	const again = await caller.para.import({ rows });
	assert.equal(again.created, 0);
	assert.equal(again.errors.length, 0);
	assert.equal(again.duplicates.length, 2);
});

test("导入:逐行校验 —— 缺参数名 / 类型非法 / 值类型不符 / 内置参数跳过", async () => {
	// 造一条 editable=0 的行(界面上不允许改:与 para.update 的口径一致)
	await db.insert(sysPara).values({
		id: `locked-${SUFFIX}`,
		para_key: LOCKED_KEY,
		para_value: "locked",
		para_type: PARA_TYPE.STRING,
		para_group: "测试",
		remark: "",
		editable: 0,
	});

	const result = await caller.para.import({
		rows: [
			{ key: "", value: "x" },
			{ key: IMPORT_INT_KEY, value: "abc" },
			{ key: LOCKED_KEY, value: "想改" },
			{ key: IMPORT_KEY, value: "x", type: "奇怪的类型" },
		],
	});
	assert.equal(result.created, 0);
	assert.equal(result.errors.length, 4);
	assert.match(result.errors[0]?.message ?? "", /缺少/);
	assert.match(result.errors[1]?.message ?? "", /整数/);
	assert.match(result.errors[2]?.message ?? "", /代码内置/);
	assert.match(result.errors[3]?.message ?? "", /类型/);
	// 被拦下的行一个字都没落库
	const stored = await db.select().from(sysPara).where(eq(sysPara.para_key, LOCKED_KEY));
	assert.equal(stored[0]?.para_value, "locked");
});

after(async () => {
	await closeDb();
});
