/**
 * 任务闭环(`taskClose`)的端到端回归 —— 走**真实的库**,直调 procedure。
 *
 * 一条主链跑通「建任务 → 执行者发起完成 → 锁住 → 答复 → 关单」,
 * 外加权限矩阵的几条反例(参与者不能改状态、非成员不能征询、非创建者不能管成员)。
 *
 * 身份的注入口径与其它测试一致(`callerAs`,HTTP 入口不可达);这几个测试用户**不带 `isSuper`**,
 * 所以走的是真判定路径 —— `who` 协议读的是 `tc_task.creator_id` 与 `tc_member`。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, inArray, like } from "drizzle-orm";

import {
	sysUser,
	taskCloseAction,
	taskCloseComment,
	taskCloseLog,
	taskCloseMember,
	taskCloseTask,
	taskCloseWorkflow,
} from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/task-close-spec.ts";
import {
	assertRejects,
	caller,
	callerAs,
	closeDb,
	purgeTestAuditRows,
	TEST_PREFIX,
	testId,
	uniqueSuffix,
} from "./helpers.ts";

const suffix = uniqueSuffix();
const A = { id: testId("u", "甲", suffix, 36), name: `${TEST_PREFIX}甲${suffix}` };
const B = { id: testId("u", "乙", suffix, 36), name: `${TEST_PREFIX}乙${suffix}` };
const C = { id: testId("u", "丙", suffix, 36), name: `${TEST_PREFIX}丙${suffix}` };

const asA = () => callerAs(A);
const asB = () => callerAs(B);
const asC = () => callerAs(C);

/** 任务名带前缀,兜底清扫与 `after()` 都靠它认领 */
const taskName = (label: string) => `${TEST_PREFIX}闭环-${label}-${suffix}`;

let workflowId = "";
/** 用例自建的流程模板 id —— `after` 里物理清(`tc_workflow` 没有 name 列,只能按 id 认领) */
const createdWorkflowIds: string[] = [];

before(async () => {
	await db.insert(sysUser).values([
		{ id: A.id, name: A.name, email: `${A.id}@test.local` },
		{ id: B.id, name: B.name, email: `${B.id}@test.local` },
		{ id: C.id, name: C.name, email: `${C.id}@test.local` },
	]);
	const workflows = await asA().taskClose.workflowList();
	assert.ok(workflows.length > 0, "要先跑 `pnpm db:seed:task-close` 才有模板");
	workflowId = workflows[0].id;
});

after(async () => {
	await purgeTestAuditRows([A.id, B.id, C.id]);
	const ids = (
		await db
			.select({ id: taskCloseTask.id })
			.from(taskCloseTask)
			.where(like(taskCloseTask.name, `${TEST_PREFIX}闭环-%`))
	).map((row) => row.id);
	if (ids.length > 0) {
		await db.delete(taskCloseAction).where(inArray(taskCloseAction.task_id, ids));
		await db.delete(taskCloseMember).where(inArray(taskCloseMember.task_id, ids));
		await db.delete(taskCloseComment).where(inArray(taskCloseComment.task_id, ids));
		// 活动日志也要清:它只增不改,留着就是一堆指向已删任务的孤儿行
		await db.delete(taskCloseLog).where(inArray(taskCloseLog.task_id, ids));
		await db.delete(taskCloseTask).where(inArray(taskCloseTask.id, ids));
	}
	if (createdWorkflowIds.length > 0) {
		await db.delete(taskCloseWorkflow).where(inArray(taskCloseWorkflow.id, createdWorkflowIds));
	}
	await db.delete(sysUser).where(inArray(sysUser.id, [A.id, B.id, C.id]));
	await closeDb();
});

/** 建一条「甲发起、乙执行」的任务 */
async function newTask(label: string) {
	const { id } = await asA().taskClose.taskCreate({
		name: taskName(label),
		workflowId,
		members: [{ userId: B.id, role: "executor", isPrimary: true }],
	});
	return id;
}

describe("任务闭环", () => {
	it("主链:建 → 执行者发起完成 → 锁住 → 答复 → 关单", async () => {
		const id = await newTask("主链");

		let detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "初始状态取模板的 initial");
		assert.equal(detail.members.length, 1);
		assert.equal(detail.members[0].name, B.name, "成员要回填姓名");

		// 乙(执行者)发起「改状态」action —— 默认模板里 open→done 的 who 是 ["creator","executor"]
		const { id: actionId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "pending", "有 is_locking 的 action 在跑 → pending");
		const action = detail.actions.find((row) => row.id === actionId);
		assert.ok(action, "动作要出现在详情里");
		assert.equal(action.isLocking, true);
		assert.equal(action.fromStatus, "open");
		assert.equal(action.status, "active");

		// 锁着的时候不能直改状态(哪怕创建者)
		await assertRejects(() => asA().taskClose.taskTransit({ id, to: "closed" }), "锁定");

		// 只有指派人能答复
		await assertRejects(() => asA().taskClose.actionRespond({ id: actionId, approved: true }), "指派人");

		await asB().taskClose.actionRespond({ id: actionId, approved: true });
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "done", "通过后落到 action 的 to_status");

		// 重复答复要挡住
		await assertRejects(() => asB().taskClose.actionRespond({ id: actionId, approved: false }), "已经答复过");

		await asA().taskClose.taskTransit({ id, to: "closed" });
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "closed");

		// 关掉之后执行者不能再来一次(done → closed 只能从 done 出发)
		await assertRejects(() => asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id }), "审批边");
	});

	it("驳回:任务退回 from_status,不是前进;驳回原因留成评论", async () => {
		const id = await newTask("驳回");
		const { id: actionId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		// 驳回必须写原因
		await assertRejects(() => asB().taskClose.actionRespond({ id: actionId, approved: false }), "驳回要填写原因");
		await asB().taskClose.actionRespond({ id: actionId, approved: false, reason: "证据不足" });
		const detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "驳回退回 from_status");
		assert.equal(detail.actions[0].status, "rejected");
		// 驳回原因作为一条评论留档(复用评论流)
		const comments = await asA().taskClose.commentList({ taskId: id });
		assert.ok(
			comments.some((comment) => comment.content.includes("证据不足")),
			"驳回原因要留成一条评论",
		);
	});

	it("活动日志:建 → 发起审批 → 答复 → 改状态 → 评论 → 成员,每一步都有行", async () => {
		const id = await newTask("日志");
		const log = async () => (await asA().taskClose.logList({ taskId: id, pageSize: 100 })).items;

		// ① 建任务:恰好一行,`to_status` = 模板的 initial;初始成员折进 detail(不另写 member.add)
		let items = await log();
		assert.equal(items.length, 1, "一次用户操作 = 一行:建任务只留一行");
		assert.equal(items[0].event, "task.create");
		assert.equal(items[0].fromStatus, null);
		assert.equal(items[0].toStatus, "open");
		assert.equal(items[0].actorName, A.name, "操作人姓名是快照");
		assert.equal((items[0].detail as { members: unknown[] }).members.length, 1, "初始执行者折进 detail");

		// ② 发起审批:任务被锁成 pending(真实的状态变化,如实记);「想去哪」在 detail.intendedTo
		const { id: actionId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		items = await log();
		const created = items.find((row) => row.event === "action.create");
		assert.ok(created);
		assert.equal(created.fromStatus, "open");
		assert.equal(created.toStatus, "pending");
		assert.equal(created.actorName, B.name);
		assert.equal((created.detail as { intendedTo: string }).intendedTo, "done");
		assert.equal(created.targetName, B.name, "动作事件的展示名是「指派人」");

		// ③ 答复通过:pending → done
		await asB().taskClose.actionRespond({ id: actionId, approved: true });
		items = await log();
		const responded = items.find((row) => row.event === "action.respond");
		assert.ok(responded);
		assert.equal(responded.fromStatus, "pending");
		assert.equal(responded.toStatus, "done");

		// ④ **直接改状态**(以前不留痕的那条路)现在有自己的行
		await asA().taskClose.taskTransit({ id, to: "closed" });
		items = await log();
		const transit = items.find((row) => row.event === "task.transit");
		assert.ok(transit, "直接改状态必须留痕");
		assert.equal(transit.fromStatus, "done");
		assert.equal(transit.toStatus, "closed");

		// ⑤ 评论 / 成员:各一行,带 target 与正文摘要
		const { id: commentId } = await asA().taskClose.commentCreate({ taskId: id, content: "查过了,没问题" });
		await asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "participant" });
		await asA().taskClose.memberRemove({ taskId: id, userId: C.id, role: "participant" });
		items = await log();
		const comment = items.find((row) => row.targetId === commentId);
		assert.ok(comment, "评论要留痕");
		assert.equal(comment.event, "comment.create");
		assert.match(comment.excerpt ?? "", /查过了/);
		const added = items.find((row) => row.event === "member.add");
		assert.ok(added);
		assert.equal(added.targetName, C.name, "成员事件的展示名是被加进来的人");
		assert.ok(
			items.some((row) => row.event === "member.remove"),
			"移出成员要留痕",
		);

		// ⑥ 编辑任务:记「改了哪些字段」;软删也留痕,且删完日志接口跟着 404(详情页据此回列表)
		await asA().taskClose.taskUpdate({ id, name: `${taskName("日志")}-改`, description: "补一条说明" });
		items = await log();
		const updated = items.find((row) => row.event === "task.update");
		assert.ok(updated, "编辑任务要留痕");
		const changed = (updated.detail as { fields: Array<{ key: string }> }).fields.map((field) => field.key);
		assert.deepEqual(changed, ["name", "description"]);

		await asA().taskClose.taskRemove({ id });
		// 软删之后 `logList` 跟着 404(任务不在了 ⇒ 详情页自动回列表),所以那行只能直接查库看
		await assertRejects(() => asA().taskClose.logList({ taskId: id }), "任务不存在");
		const rows = await db.select().from(taskCloseLog).where(eq(taskCloseLog.task_id, id));
		assert.ok(
			rows.some((row) => row.event === "task.remove"),
			"软删要留痕",
		);
	});

	it("活动日志与业务同事务:业务被拒就不留行", async () => {
		const id = await newTask("日志回滚");
		const before = (await asA().taskClose.logList({ taskId: id, pageSize: 100 })).total;
		// open → closed 没有直改边 ⇒ 抛错;按「同事务」口径,日志一行都不能多
		await assertRejects(() => asA().taskClose.taskTransit({ id, to: "closed" }), "直接转移");
		const after = (await asA().taskClose.logList({ taskId: id, pageSize: 100 })).total;
		assert.equal(after, before, "业务被拒就不该留下日志");
	});

	it("权限矩阵:参与者 / 非成员该被挡的都挡住", async () => {
		const id = await newTask("权限");

		// 丙还没进成员表 —— 跟任务没关系的人不能征询
		await assertRejects(() => asC().taskClose.actionCreate({ taskId: id, handleId: A.id }), "创建者 / 参与者 / 执行者");

		await asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "participant" });

		// 参与者:能征询,不能发起改状态(权限矩阵那一行)
		await assertRejects(
			() => asC().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: C.id }),
			"没有权限",
		);
		const { id: consultId } = await asC().taskClose.actionCreate({ taskId: id, handleId: A.id });
		const consult = (await asA().taskClose.actionList({ taskId: id })).find((row) => row.id === consultId);
		assert.equal(consult?.isLocking, false, "征询不锁任务");
		assert.equal(consult?.toStatus, null);

		// 创建者的能力
		const asCreator = await asA().taskClose.taskGet({ id });
		assert.equal(asCreator.permissions.canManageMembers, true);
		assert.equal(asCreator.permissions.transitions.includes("closed"), false, "open 状态没有到 closed 的直改边");

		// 执行者的能力 —— 能发起改状态、能加人,但移出成员 / 改任务不行
		const asExecutor = await asB().taskClose.taskGet({ id });
		assert.equal(asExecutor.permissions.canInitiateStatusAction, true);
		assert.equal(asExecutor.permissions.canAddMember, true, "所有角色都能加人");
		assert.equal(asExecutor.permissions.canManageMembers, false, "移出成员仍仅创建者");
		assert.equal(asExecutor.permissions.canUpdate, false);
		assert.deepEqual(asExecutor.permissions.myRoles, ["executor"]);

		// 非创建者**可以加**成员(需求:所有角色都能加),但**不能移出**、不能删任务
		await asB().taskClose.memberAdd({ taskId: id, userId: C.id, role: "executor" });
		const afterAdd = await asA().taskClose.taskGet({ id });
		assert.ok(
			afterAdd.members.some((m) => m.userId === C.id && m.role === "executor"),
			"非创建者(执行者 B)加的人要进成员表",
		);
		await assertRejects(() => asB().taskClose.memberRemove({ taskId: id, userId: C.id, role: "executor" }), "创建者");
		await assertRejects(() => asB().taskClose.taskRemove({ id }), "创建者");
	});

	it("删掉之后这条 id 就查不到了(详情页据此自动回「我的任务」)", async () => {
		const id = await newTask("删后查不到");
		await asA().taskClose.taskRemove({ id });
		await assertRejects(() => asA().taskClose.taskGet({ id }), "任务不存在");
	});

	it("评论:全员可发,附件回填,作者本人可删", async () => {
		const id = await newTask("评论");
		const { id: commentId } = await asC().taskClose.commentCreate({
			taskId: id,
			content: "  路过看一眼  ",
			attachments: ["no-such-file"],
		});
		const rows = await asA().taskClose.commentList({ taskId: id });
		const mine = rows.find((row) => row.id === commentId);
		assert.ok(mine);
		assert.equal(mine.content, "路过看一眼", "内容要去首尾空格");
		assert.equal(mine.authorName, C.name, "回填作者姓名");
		assert.deepEqual(mine.attachments, [], "不存在的附件 id 直接丢掉,不留空行");

		await assertRejects(() => asB().taskClose.commentRemove({ id: commentId }), "作者本人");
		await asC().taskClose.commentRemove({ id: commentId });
		assert.equal((await asA().taskClose.commentList({ taskId: id })).length, 0, "软删之后不再出现");
	});

	it("待我处理:只列自己的、还活着的动作", async () => {
		const id = await newTask("待办");
		const { id: actionId } = await asA().taskClose.actionCreate({ taskId: id, handleId: B.id });
		const mine = await asB().taskClose.actionMine({});
		const row = mine.items.find((item) => item.id === actionId);
		assert.ok(row, "指派人要能看到这条");
		assert.equal(row.taskName, taskName("待办"), "带上任务名,列表才不用二次查询");
		assert.ok((await asA().taskClose.actionMine({})).items.every((item) => item.handleId === A.id));
	});
});

/** `who` 取值(与 `doc/task-close.md` 的 who 协议一致)—— 帮调用点把字面量收敛成联合类型 */
type Who = "creator" | "participant" | "executor" | "any";
const edge = (from: string, to: string, who: Who[], via: "direct" | "action") => ({ from, to, who, via });

/** 状态字面量 → `{ value, label }`(默认 label = value;要断言"UI 显示 label"就显式给中文) */
const st = (value: string, label = value) => ({ value, label });

/**
 * 流程模板(`tc_workflow`)的管理接口。
 *
 * 这几个接口挂了**按钮权限点**(`sys:tcWorkflow:*`),而 `callerAs` 的测试用户没有授权 ⇒
 * 用 `caller`(`TEST_USER`,超管旁路)调 —— 权限点的硬拦由 `tests/auth.test.ts` 的分类守卫覆盖,
 * 这里测的是「模板定义能不能正确落库 / 校验 / 内置模板保护」。
 */
describe("流程模板", () => {
	it("建 → 查 → 改 → 删(自建模板可删)", async () => {
		const name = `${TEST_PREFIX}模板-${suffix}`;
		const { id } = await caller.taskClose.workflowCreate({
			name,
			statuses: [st("open", "进行中"), st("done", "待核验"), st("closed", "已关闭")],
			initial: "open",
			edges: [edge("open", "done", ["creator", "executor"], "action"), edge("done", "closed", ["creator"], "direct")],
		});
		createdWorkflowIds.push(id);

		const got = await caller.taskClose.workflowGet({ id });
		assert.equal(got.name, name);
		assert.deepEqual(got.statuses, [
			{ value: "open", label: "进行中" },
			{ value: "done", label: "待核验" },
			{ value: "closed", label: "已关闭" },
		]);
		assert.equal(got.initial, "open");
		assert.equal(got.edges.length, 2);
		assert.equal(got.builtin, false, "自建模板不是内置");

		// 列表里能看到,且内置模板被标了 builtin(前端靠它不出「删除」)
		const list = await caller.taskClose.workflowList();
		assert.ok(
			list.some((row) => row.id === id),
			"新建的模板要出现在列表里",
		);
		assert.equal(list.find((row) => row.id === DEFAULT_WORKFLOW_ID)?.builtin, true, "内置模板要标 builtin");

		// 改名 + 换状态 + 改边
		await caller.taskClose.workflowUpdate({
			id,
			name: `${name}-改`,
			statuses: [st("a"), st("b")],
			initial: "b",
			edges: [edge("a", "b", ["participant"], "direct")],
		});
		const updated = await caller.taskClose.workflowGet({ id });
		assert.equal(updated.name, `${name}-改`);
		assert.equal(updated.initial, "b");
		assert.deepEqual(updated.edges, [{ from: "a", to: "b", who: ["participant"], via: "direct" }]);

		// 软删之后读不到
		await caller.taskClose.workflowRemove({ id });
		await assertRejects(() => caller.taskClose.workflowGet({ id }), "不存在");
	});

	it("校验:初始态不在状态里 / 边引用未知状态都要拒", async () => {
		await assertRejects(
			() =>
				caller.taskClose.workflowCreate({
					name: `${TEST_PREFIX}坏初始-${suffix}`,
					statuses: [st("open"), st("done")],
					initial: "nope",
					edges: [],
				}),
			"初始态",
		);
		await assertRejects(
			() =>
				caller.taskClose.workflowCreate({
					name: `${TEST_PREFIX}坏边-${suffix}`,
					statuses: [st("open"), st("done")],
					initial: "open",
					edges: [edge("open", "ghost", ["creator"], "direct")],
				}),
			"未知状态",
		);
	});

	it("内置默认模板不可删除", async () => {
		await assertRejects(() => caller.taskClose.workflowRemove({ id: DEFAULT_WORKFLOW_ID }), "内置默认模板");
	});

	it("状态按 value 去重(同一 value 只留第一条)", async () => {
		const { id } = await caller.taskClose.workflowCreate({
			name: `${TEST_PREFIX}去重-${suffix}`,
			statuses: [st("open", "进行中"), st("done", "待核验"), st("open", "重复的进行中")],
			initial: "open",
			edges: [],
		});
		createdWorkflowIds.push(id);
		const got = await caller.taskClose.workflowGet({ id });
		assert.deepEqual(got.statuses, [
			{ value: "open", label: "进行中" },
			{ value: "done", label: "待核验" },
		]);
	});

	it("同一对状态不能同时有 direct 与 action 两条边", async () => {
		await assertRejects(
			() =>
				caller.taskClose.workflowCreate({
					name: `${TEST_PREFIX}重复边-${suffix}`,
					statuses: [st("open"), st("done")],
					initial: "open",
					edges: [edge("open", "done", ["creator"], "direct"), edge("open", "done", ["creator"], "action")],
				}),
			"只能有一条边",
		);
	});

	it("只声明 action 边时,直接改状态被拒(必须走审批)", async () => {
		const { id: wfId } = await caller.taskClose.workflowCreate({
			name: `${TEST_PREFIX}仅审批-${suffix}`,
			statuses: [st("open"), st("done")],
			initial: "open",
			edges: [edge("open", "done", ["creator"], "action")],
		});
		createdWorkflowIds.push(wfId);

		const { id: taskId } = await asA().taskClose.taskCreate({ name: taskName("仅审批"), workflowId: wfId });
		await assertRejects(() => asA().taskClose.taskTransit({ id: taskId, to: "done" }), "直接转移");
	});
});
