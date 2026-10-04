import assert from "node:assert/strict";
import { test } from "node:test";

import { DELETED_SUFFIX, fromTombstone, softDeleted, tombstone } from "../src/lib/soft-delete.ts";

/**
 * 统一软删里**纯函数**那一半(墓碑让位)。
 *
 * 为什么单独测:`tombstone()` 的截断规则是「`sys_role.name` 只有 32 字符」逼出来的 —— 算错就是
 * `Data too long for column`(MySQL 严格模式)或者原值原样留着(键再也让不出来,删完就再也建不出同名),
 * 这两种错 `typecheck` 都看不见。
 *
 * `alive()` 那一半(读路径必须过滤)没法在这里测 —— 它是 SQL 条件,由各域的接口测试覆盖。
 */
/** 21 位 nanoid,与库里主键同形(后缀长度 = 3 + min(24, id 长度) = 24) */
const ID = "FFGCcG9UmAYu1QYZFQsCo";

test("墓碑:后缀 = `#d#` + id 尾段,列够宽时原值完整保留", () => {
	const key = "__test__dict_abc";
	const out = tombstone(key, ID, 64);
	assert.equal(out, `${key}${DELETED_SUFFIX}${ID}`);
	assert.ok(out.length <= 64);
});

test("墓碑:列窄时截原值,结果绝不超列宽(角色名只有 32 字符)", () => {
	const out = tombstone("__test__角色名字很长很长很长", ID, 32);
	assert.equal(out.length, 32, "刚好占满 32 字符,多一个就会被 MySQL 拒");
	assert.ok(out.endsWith(`${DELETED_SUFFIX}${ID}`), "后缀必须完整 —— id 尾段才是唯一性的来源");
	assert.ok(out.startsWith("__test__"), "前缀还看得出原值(删的是什么,审计上认得出)");
});

test("墓碑:列比后缀还窄时只留后缀并截到列宽", () => {
	const out = tombstone("whatever", ID, 20);
	assert.equal(out.length, 20);
	assert.equal(out, `${DELETED_SUFFIX}${ID}`.slice(0, 20));
});

test("fromTombstone:能还原前缀(有损,够手写 SQL 救数据就行)", () => {
	assert.equal(fromTombstone(tombstone("__test__role_1", ID, 64)), "__test__role_1");
	assert.equal(fromTombstone("没有被删的键"), "没有被删的键", "不是墓碑就原样返回");
});

test("softDeleted:写进去的是一个 Date(与全项目 UTC 存时间的口径一致)", () => {
	const patch = softDeleted();
	assert.ok(patch.deleted_at instanceof Date);
	assert.equal(Object.keys(patch).length, 1, "只写 deleted_at 一列,别顺手带上别的");
});
