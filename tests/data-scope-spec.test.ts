import assert from "node:assert/strict";
import { test } from "node:test";

import { isIdent, parseSubject, validatePolicyCombo } from "../src/lib/data-scope-spec.ts";

// ───────────────────────────── 纯规格层(不碰库) ─────────────────────────────

test("规格:规则组合校验(m18228 后只剩两种合法形态)", () => {
	// ① 什么也不填 = 整类可见
	assert.equal(validatePolicyCombo({ column: null, pluginKey: null }), null);
	// 不填插件却填了列 ⇒ 拒(否则人会以为"列 + 空插件"能筛出什么来)
	assert.match(validatePolicyCombo({ column: "town_id", pluginKey: null }) ?? "", /没选插件/);
	// ② 填了插件 ⇒ 必须选列
	assert.match(validatePolicyCombo({ column: null, pluginKey: "self" }) ?? "", /必须选一个列/);
	assert.equal(validatePolicyCombo({ column: "town_id", pluginKey: "self" }), null);
});

test("规格:主体写法解析,`up:` 这类 v0 写法必须不再被识别", () => {
	assert.deepEqual(parseSubject("*"), { kind: "all" });
	assert.deepEqual(parseSubject("role:r1"), { kind: "role", id: "r1" });
	assert.deepEqual(parseSubject("dept:d1"), { kind: "dept", id: "d1" });
	assert.deepEqual(parseSubject("user:u1"), { kind: "user", id: "u1" });
	assert.equal(parseSubject("up:1"), null, "v0 的 up: 语法已整体删除,不能再解析出来");
	assert.equal(parseSubject("role:"), null, "空的 id 不算主体");
	assert.equal(parseSubject("role"), null, "没有冒号就不是主体");
});

test("规格:表名 / 列名要拼进 SQL,所以只认标识符形状", () => {
	assert.equal(isIdent("resource_table"), true);
	assert.equal(isIdent("_x1"), true);
	assert.equal(isIdent("1abc"), false, "不能以数字开头");
	assert.equal(isIdent("a.b"), false, "带点的限定名不放行");
	assert.equal(isIdent("a`b"), false);
	assert.equal(isIdent("数据表"), false, "中文表名不放行(要拼 SQL)");
});
