/**
 * 活动日志的**纯文本**用例 —— 不碰库、不起 tRPC。
 *
 * `describeLog()` 是「事件码 → 人话」的唯一出口,所以两件事必须钉住:
 * 认不出的 `event` 要降级(界面可能比后端旧)、状态 value 要能翻成展示名(含框架锁定态 `pending`)。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	describeLog,
	logCategoryOf,
	logMovedStatus,
	logStatusLabel,
	type TaskLogItem,
} from "../src/lib/task-close-log.ts";

const statuses = [
	{ value: "open", label: "进行中" },
	{ value: "done", label: "待核验" },
];

const ROLE_TEXT = { creator: "创建者", participant: "参与者", executor: "执行者" } as Record<string, string>;
const ctx = {
	statusLabel: (value: string) => logStatusLabel(statuses, value),
	roleLabel: (role: string) => ROLE_TEXT[role] ?? role,
};

function item(part: Partial<TaskLogItem>): TaskLogItem {
	return {
		id: "log-1",
		event: "task.create",
		fromStatus: null,
		toStatus: null,
		targetId: null,
		targetName: null,
		actorId: "u1",
		actorName: "张三",
		detail: null,
		excerpt: null,
		createdAt: null,
		...part,
	};
}

describe("活动日志文本", () => {
	it("状态 value → 展示名;框架锁定态 pending 有兜底名", () => {
		assert.equal(logStatusLabel(statuses, "open"), "进行中");
		assert.equal(logStatusLabel(statuses, "pending"), "待审批", "模板没声明 pending 也不能显示英文");
		assert.equal(logStatusLabel(statuses, "weird"), "weird", "都查不到就回退 value");
	});

	it("改状态 / 发起审批 / 发起征询 / 答复:标题与附注", () => {
		const transit = describeLog(item({ event: "task.transit", fromStatus: "open", toStatus: "done" }), ctx);
		assert.equal(transit.title, "改状态:进行中 → 待核验");

		const approved = describeLog(
			item({
				event: "action.create",
				fromStatus: "open",
				toStatus: "pending",
				targetName: "李四",
				detail: { intendedTo: "done", handleId: "u2", isLocking: true },
			}),
			ctx,
		);
		assert.equal(approved.title, "发起审批:进行中 → 待核验", "想去哪读 detail.intendedTo");
		assert.equal(approved.note, "指派给 李四 · 任务已锁定");

		const consult = describeLog(
			item({
				event: "action.create",
				targetName: "李四",
				detail: { intendedTo: null, handleId: "u2", isLocking: false },
			}),
			ctx,
		);
		assert.equal(consult.title, "发起征询");
		assert.equal(consult.note, "征询 李四");

		const rejected = describeLog(
			item({
				event: "action.respond",
				fromStatus: "pending",
				toStatus: "open",
				detail: { approved: false, reason: "证据不足", actionStatus: "rejected" },
			}),
			ctx,
		);
		assert.equal(rejected.title, "答复审批:驳回(待审批 → 进行中)");
		assert.equal(rejected.note, "驳回原因:证据不足");
	});

	it("回复征询:意见进附注,展示名是被回复的征询发起人", () => {
		const reply = describeLog(
			item({
				event: "action.reply",
				targetName: "甲",
				excerpt: "东西我看过了,流程没问题",
				detail: { consultOf: "u1", commentId: "c1", attachments: 2 },
			}),
			ctx,
		);
		assert.equal(reply.title, "回复征询(对 甲)");
		assert.equal(reply.note, "意见:东西我看过了,流程没问题 · 附 2 个附件");

		const plain = describeLog(item({ event: "action.reply", detail: { consultOf: "u1", commentId: "c1" } }), ctx);
		assert.equal(plain.title, "回复征询(对 u1)", "名字查不到回退 id");
		assert.equal(plain.note, null);
	});

	it("成员 / 评论:对象与摘要要落到文字上", () => {
		const added = describeLog(
			item({ event: "member.add", targetName: "王五", detail: { role: "executor", isPrimary: true } }),
			ctx,
		);
		assert.equal(added.title, "加入成员:王五");
		assert.equal(added.note, "角色:执行者(主)");

		const removed = describeLog(
			item({ event: "member.remove", targetName: "王五", detail: { role: "participant" } }),
			ctx,
		);
		assert.equal(removed.title, "移出成员:王五");

		const comment = describeLog(item({ event: "comment.create", excerpt: "看过了", detail: { attachments: 2 } }), ctx);
		assert.equal(comment.title, "发表评论");
		assert.equal(comment.note, "看过了 · 附 2 个附件");
	});

	it("task.update 把字段摊成中文;认不出的 event 降级不崩", () => {
		const updated = describeLog(
			item({
				event: "task.update",
				detail: {
					fields: [
						{ key: "name", from: "a", to: "b" },
						{ key: "dueAt", from: null, to: "2026-01-01" },
					],
					payloadChanged: true,
				},
			}),
			ctx,
		);
		assert.equal(updated.note, "改了 标题、截止时间 · 内容 / 附件有改动");

		const unknown = describeLog(item({ event: "brand.new.event" }), ctx);
		assert.equal(unknown.title, "brand.new.event", "认不出就显示码本身");
		assert.equal(unknown.note, "未知事件类型");
	});

	it("类别取事件码前缀;流程条只认动过状态的行", () => {
		assert.equal(logCategoryOf("member.add"), "member");
		assert.equal(logCategoryOf("task.transit"), "task");
		assert.equal(logCategoryOf("brand.new"), null);
		assert.equal(logMovedStatus({ toStatus: null }), false);
		assert.equal(logMovedStatus({ toStatus: "done" }), true);
	});
});
