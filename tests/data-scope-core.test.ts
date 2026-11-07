import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";

import { sysDataPlugin, sysDataPolicy, sysDept } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { clearDataScopeCache, scopeWhere } from "../src/lib/data-scope.ts";
import { clearPluginCache } from "../src/lib/data-scope-plugins.ts";
import type { PolicyCtx } from "../src/lib/data-scope-spec.ts";
import { newId } from "../src/lib/ids.ts";
import { closeDb } from "./helpers.ts";

test("数据权限核心:无规则、主体匹配、并集和失效插件", async () => {
	const suffix = randomBytes(8).toString("hex");
	const resource = `test_scope_${suffix}`;
	const pluginKey = `test_scope_${suffix}`;
	const [first, second, firstRule, secondRule, missingRule, pluginId] = Array.from({ length: 6 }, () => newId());
	const ctx = (userId: string): PolicyCtx => ({
		user: { id: userId, name: "测试" },
		roles: [],
		depts: [],
		descendants: [],
	});
	const visibleIds = async (userId: string) => {
		const scope = await scopeWhere(resource, ctx(userId));
		const rows = await db
			.select({ id: sysDept.id })
			.from(sysDept)
			.where(and(inArray(sysDept.id, [first, second]), scope));
		return new Set(rows.map((row) => row.id));
	};

	try {
		await db.insert(sysDept).values([
			{ id: first, name: `__test__scope_a_${suffix}` },
			{ id: second, name: `__test__scope_b_${suffix}` },
		]);
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set([first, second]), "无上线规则时不额外过滤");

		await db.insert(sysDataPolicy).values({
			id: firstRule,
			status: 1,
			subject: `user:${first}`,
			resource,
			column: "id",
			plugin_key: "self",
		});
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set([first]), "self 只匹配当前用户 id");
		assert.deepEqual(await visibleIds(second), new Set(), "有规则但主体不匹配时失败关闭");

		await db.insert(sysDataPlugin).values({
			id: pluginId,
			plugin_key: pluginKey,
			label: "测试清单",
			output_values: [{ key: "value", value: second }],
		});
		await db.insert(sysDataPolicy).values({
			id: secondRule,
			status: 1,
			subject: `user:${first}`,
			resource,
			column: "id",
			value_key: "value",
			plugin_key: pluginKey,
		});
		clearPluginCache();
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set([first, second]), "多条规则按并集计算");

		await db.update(sysDataPolicy).set({ status: 0 }).where(eq(sysDataPolicy.id, secondRule));
		await db.insert(sysDataPolicy).values({
			id: missingRule,
			status: 1,
			subject: `user:${first}`,
			resource,
			column: "id",
			plugin_key: `${pluginKey}_missing`,
		});
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set([first]), "失效插件不能把范围扩大为全部");
		await db.update(sysDataPolicy).set({ status: 0 }).where(eq(sysDataPolicy.id, firstRule));
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set(), "只有失效规则时不返回任何行");

		await db
			.update(sysDataPolicy)
			.set({ subject: "invalid", plugin_key: "self" })
			.where(eq(sysDataPolicy.id, missingRule));
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set(), "唯一上线规则的主体损坏时不能退化成无规则放行");

		await db
			.update(sysDataPolicy)
			.set({ subject: `user:${first}`, plugin_key: null, column: "id" })
			.where(eq(sysDataPolicy.id, missingRule));
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set(), "唯一上线规则缺少插件时不能退化成无规则放行");

		await db.update(sysDataPolicy).set({ status: 1 }).where(eq(sysDataPolicy.id, firstRule));
		clearDataScopeCache();
		assert.deepEqual(await visibleIds(first), new Set([first]), "损坏规则不影响其他有效规则的并集");
	} finally {
		await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.id, [firstRule, secondRule, missingRule]));
		await db.delete(sysDataPlugin).where(eq(sysDataPlugin.id, pluginId));
		await db.delete(sysDept).where(inArray(sysDept.id, [first, second]));
		clearDataScopeCache();
		clearPluginCache();
		await closeDb();
	}
});
