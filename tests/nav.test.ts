/**
 * 菜单树纯函数回归 —— 盯住「前缀路径抢选中态」这个真实踩过的坑。
 *
 * 背景:`/task-close` 是 `/task-close/workflows` 的前缀,两条菜单会同时"命中"。
 * 若链末取先遇到的短路径,停在「流程模板」时侧边栏会同时点亮「我的任务」(面包屑也指错)。
 * 纯函数无副作用,不碰库、不用 helpers。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findNavTrailIn, type NavNode, navNodeContains } from "../src/components/layout/nav-config.ts";

const tree: NavNode[] = [
	{
		name: "任务闭环",
		icon: "list-checks",
		children: [
			{ name: "我的任务", path: "/task-close", icon: "clipboard-list" },
			{ name: "流程模板", path: "/task-close/workflows", icon: "workflow" },
		],
	},
	{
		name: "系统设置",
		path: "/settings",
		icon: "settings",
		children: [{ name: "用户管理", path: "/settings/users", icon: "users" }],
	},
];

/** 命中链末端的菜单名 —— 就是"哪一项该高亮" */
const leafName = (pathname: string) => findNavTrailIn(tree, pathname).at(-1)?.name ?? null;

describe("findNavTrailIn", () => {
	it("前缀路径并存时取最具体的一条(/task-close/workflows 不能命中「我的任务」)", () => {
		assert.equal(leafName("/task-close/workflows"), "流程模板");
		assert.deepEqual(
			findNavTrailIn(tree, "/task-close/workflows").map((n) => n.name),
			["任务闭环", "流程模板"],
		);
	});

	it("停在父级路径时命中父级那一条", () => {
		assert.equal(leafName("/task-close"), "我的任务");
	});

	it("不在菜单里的子路径(任务详情)命中最近的祖先菜单", () => {
		assert.equal(leafName("/task-close/abc123"), "我的任务");
	});

	it("模块首页 vs 子页面:子页面优先", () => {
		assert.equal(leafName("/settings/users"), "用户管理");
		assert.equal(leafName("/settings"), "系统设置");
	});

	it("完全不在菜单里时返回空数组", () => {
		assert.deepEqual(findNavTrailIn(tree, "/nowhere"), []);
	});
});

describe("navNodeContains", () => {
	it("分组含子页时为真(父级分组高亮靠它)", () => {
		const group = tree[0] as NavNode;
		assert.equal(navNodeContains(group, "/task-close/workflows"), true);
		assert.equal(navNodeContains(group, "/nowhere"), false);
	});
});
