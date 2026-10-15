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

import { and, eq, inArray, isNull, like } from "drizzle-orm";

import {
	sysNotice,
	sysUser,
	taskCloseAction,
	taskCloseComment,
	taskCloseLog,
	taskCloseMember,
	taskCloseTask,
	taskCloseWorkflow,
} from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { addUserRole, removeAllRolesOfUser } from "../src/lib/casbin.ts";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/task-close-spec.ts";
import {
	assertRejects,
	caller,
	callerAs,
	closeDb,
	getSystemAdminRoleRow,
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
		// 创建者改 open → closed:模板里没这条直改边 ⇒ 抛错(创建者也必须按事项流程走);
		// 按「同事务」口径,日志一行都不能多
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

		await assertRejects(() => asB().taskClose.commentRemove({ id: commentId }), "只能删除自己的评论");
		await asC().taskClose.commentRemove({ id: commentId });
		assert.equal((await asA().taskClose.commentList({ taskId: id })).length, 0, "软删之后不再出现");
	});

	it("转交执行人:新人当执行者,原执行人降为参与者,且留痕", async () => {
		const id = await newTask("转交");
		await asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "participant" });

		// 参与者不能转交;目标只能是本任务成员(不能给创建者)
		await assertRejects(() => asC().taskClose.taskTransfer({ taskId: id, userId: B.id }), "执行者或管理员");
		await assertRejects(() => asB().taskClose.taskTransfer({ taskId: id, userId: A.id }), "创建者");

		// 乙(主执行人)转交给丙
		await asB().taskClose.taskTransfer({ taskId: id, userId: C.id });
		const after = await asA().taskClose.taskGet({ id });
		const next = after.members.find((m) => m.userId === C.id);
		const prev = after.members.find((m) => m.userId === B.id);
		assert.equal(next?.role, "executor");
		assert.equal(next?.isPrimary, true, "新执行人是主执行");
		assert.equal(prev?.role, "participant", "原执行人降为参与者");

		const transfer = (await asA().taskClose.logList({ taskId: id })).items.find(
			(row) => row.event === "member.transfer",
		);
		assert.ok(transfer, "转交要留痕");
		assert.equal(transfer.targetName, C.name, "留痕的 target 是转交后的执行人");
	});

	it("回复征询:意见落成评论、动作即结、任务不动;只有被征询的人能回、不能回两次", async () => {
		const id = await newTask("回复征询");
		const { id: consultId } = await asA().taskClose.actionCreate({ taskId: id, handleId: B.id });

		// 非被征询人(甲是发起者、丙是无关人)都不能替乙回
		await assertRejects(() => asA().taskClose.actionReply({ id: consultId, content: "替问" }), "被征询的人");
		await assertRejects(() => asC().taskClose.actionReply({ id: consultId, content: "围观" }), "被征询的人");
		// 纯空白不当有效回复落库
		await assertRejects(() => asB().taskClose.actionReply({ id: consultId, content: "   " }), "回复内容不能为空");

		// 乙回复(带附件 id)—— 意见进评论流,动作亮灯,任务保持 open
		await asB().taskClose.actionReply({ id: consultId, content: "意见:先补台账", attachments: ["fake-id"] });
		const detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "回复征询不推任务状态");
		assert.equal(detail.actions.find((row) => row.id === consultId)?.status, "done", "回复即算处理完");

		const comments = await asA().taskClose.commentList({ taskId: id });
		assert.ok(
			comments.some((comment) => comment.content === "意见:先补台账"),
			"意见要在评论区可见",
		);
		// 不存在的附件 id 同样直接丢掉(与 commentCreate 同口径)
		assert.deepEqual(comments.find((comment) => comment.content === "意见:先补台账")?.attachments, []);

		// 动态:action.reply 一行,摘要取意见正文,展示名是征询发起人
		const replyLog = (await asA().taskClose.logList({ taskId: id })).items.find((row) => row.event === "action.reply");
		assert.ok(replyLog, "回复征询要留痕");
		assert.match(replyLog.excerpt ?? "", /先补台账/);
		assert.equal(replyLog.targetName, A.name, "展示名是被回复的征询发起人");

		// 同一条征询不能回复两次
		await assertRejects(() => asB().taskClose.actionReply({ id: consultId, content: "再补一句" }), "已经回复过了");
	});

	it("管理员:可以直接把任务改到模板里的任意状态(不必存在对应的边)", async () => {
		const id = await newTask("管理员改状态");
		// 丙临时持「系统管理员」角色 —— `isAdminUser` 查的就是 casbin 这张图。
		// 用丙(既不是创建者、也不是这条任务的成员),才验得到「管理员」这条路本身。
		await addUserRole(C.id, (await getSystemAdminRoleRow()).id);
		try {
			// 乙(执行者):open 没有到 archived 的 direct 边、也不是创建者 → 拒
			await assertRejects(() => asB().taskClose.taskTransit({ id, to: "archived" }), "直接转移");
			// 管理员:模板里声明的任意状态都能直接改
			await asC().taskClose.taskTransit({ id, to: "archived" });
			assert.equal((await asC().taskClose.taskGet({ id })).task.status, "archived");
		} finally {
			// 摘掉角色,别污染这个文件共用的甲 / 乙 / 丙
			await removeAllRolesOfUser(C.id);
		}
	});

	it("创建者:沿模板的 direct 边能改状态(默认流程 done → closed)", async () => {
		const id = await newTask("创建者直改");
		// 先走到「待核验」:执行者发起 open→done 的审批,指派人答复通过
		const { id: actionId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		await asB().taskClose.actionRespond({ id: actionId, approved: true });
		assert.equal((await asA().taskClose.taskGet({ id })).task.status, "done");

		// 创建者按模板里 done→closed 这条 direct 边直改
		await asA().taskClose.taskTransit({ id, to: "closed" });
		assert.equal((await asA().taskClose.taskGet({ id })).task.status, "closed");
	});

	it("锁定期:连管理员也不能直接改状态", async () => {
		const id = await newTask("锁定改状态");
		// 乙发起审批 → 任务锁成 pending
		await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		await addUserRole(C.id, (await getSystemAdminRoleRow()).id);
		try {
			await assertRejects(() => asC().taskClose.taskTransit({ id, to: "closed" }), "锁定");
		} finally {
			await removeAllRolesOfUser(C.id);
		}
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

	it("征询:不锁任务、答复后状态不动;驳回同样要填原因;重复答复要挡", async () => {
		const id = await newTask("征询结算");
		await asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "participant" });

		// 乙(执行者)征询甲 —— 不锁、任务保持 open;法人由创建者直接答也可以被乙追(先测 B 征询 A)
		const { id: consultId } = await asB().taskClose.actionCreate({ taskId: id, handleId: A.id });
		let detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "征询不推状态、不锁定");
		assert.equal(detail.actions.find((row) => row.id === consultId)?.isLocking, false);

		// 征询的驳回也要写原因(同一口径);写完之后任务仍旧 open、动作变 rejected
		await assertRejects(() => asA().taskClose.actionRespond({ id: consultId, approved: false }), "驳回要填写原因");
		await asA().taskClose.actionRespond({ id: consultId, approved: false, reason: "口径没对齐" });
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "征询答复不推进任务");
		assert.equal(detail.actions.find((row) => row.id === consultId)?.status, "rejected");

		// 同一条动作不能答第二次
		await assertRejects(() => asA().taskClose.actionRespond({ id: consultId, approved: true }), "已经答复过");
	});

	it("追问(子动作):答复只落在动作本身,任务状态 / 锁定都不动", async () => {
		const id = await newTask("追问");
		const { id: rootId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		assert.equal((await asA().taskClose.taskGet({ id })).task.status, "pending", "根级审批先锁上");

		// 在锁定期间,成员可以对这条审批发起追问(子级征询)—— 锁守卫不拦子动作
		const { id: childId } = await asB().taskClose.actionCreate({
			taskId: id,
			handleId: A.id,
			parentActionId: rootId,
		});
		const detail = await asA().taskClose.taskGet({ id });
		const child = detail.actions.find((row) => row.id === childId);
		const root = detail.actions.find((row) => row.id === rootId);
		assert.equal(child?.parentActionId, rootId);
		assert.equal(child?.isLocking, false);
		assert.equal(child?.fromStatus, null, "子动作 from/to 都是空(不推任务状态)");
		assert.equal(child?.sequence, (root?.sequence ?? 0) + 1, "子动作 sequence = 父 + 1");
		assert.equal(root?.status, "active", "追问不影响父动作的进行中");

		// 甲答复追问:只把子动作点亮,任务的锁还在 —— 父审批没答,状态仍然 pending
		await asA().taskClose.actionRespond({ id: childId, approved: true });
		const after = await asA().taskClose.taskGet({ id });
		assert.equal(after.task.status, "pending", "子动作答复不解锁");
		assert.equal(after.actions.find((row) => row.id === childId)?.status, "done");
	});

	it("通知与红点:被审批 / 被征询 / 被 @ 都发铃铛,menuBadge 计数随之走,已读即消", async () => {
		const id = await newTask("通知与红点");
		await asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "participant" });

		const badgeOf = async () => (await asA().taskClose.menuBadge()).count;
		const before = await badgeOf();

		// ② 征询也一样:甲征询丙 → 丙收到「轮到你了」(body 里写明是征询)。
		// (先建再建审批:审批一上任务就锁,征询类**不占锁**,所以这条要排在锁之前)
		await asA().taskClose.actionCreate({ taskId: id, handleId: C.id });
		const consultNotice = await db
			.select()
			.from(sysNotice)
			.where(and(eq(sysNotice.user_id, C.id), like(sysNotice.body, "%征询%")));
		assert.ok(consultNotice.length > 0, "被征询的人也要收到通知(body 写明「征询了你」)");

		// ① 乙发起审批,指给**创建者**甲 —— 甲有一条未读的「轮到你了」通知,红点 +1;
		// **读掉它红点就消**(动作本身的待办不进徽标,「我的任务」页自己看得见)
		await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: A.id });
		const assignRows = await db
			.select()
			.from(sysNotice)
			.where(and(eq(sysNotice.user_id, A.id), like(sysNotice.path, `/task-close/${id}%`)));
		assert.ok(
			assignRows.some((row) => row.title.includes("轮到你") && row.read_at === null),
			"被审批的人要有未读的「轮到你了」通知",
		);
		assert.equal(await badgeOf(), before + 1, "新任务通知未读时点亮红点");

		// ② @提及:丙(参与者)评论里 @ 甲 → 甲再 +1;@陪路人 → 没有
		const beforeComment = await badgeOf();
		await asC().taskClose.commentCreate({ taskId: id, content: `@${A.name} 请看附件` });
		assert.equal(await badgeOf(), beforeComment + 1, "被 @ 的参与人要有通知");
		const mentionRows = await db
			.select()
			.from(sysNotice)
			.where(and(eq(sysNotice.user_id, A.id), like(sysNotice.title, "%@ 你%")));
		assert.ok(
			mentionRows.some((row) => row.title.includes(C.name)),
			"提及通知的标题里带**作者**(丙)",
		);
		await asB().taskClose.commentCreate({ taskId: id, content: "@某人不存在 看看" });
		assert.equal(await badgeOf(), beforeComment + 1, "提到不在参与名单里的名字不会产生任何通知");

		// ③ **把这一趟的两条读完 → 红点归零**(读了通知就消)
		const unreadTasks = await db
			.select()
			.from(sysNotice)
			.where(and(eq(sysNotice.user_id, A.id), like(sysNotice.path, `/task-close/${id}%`), isNull(sysNotice.read_at)));
		for (const row of unreadTasks) await asA().notice.read({ id: row.id });
		assert.equal(await badgeOf(), before, "读了通知,红点取消");
	});

	it("管理员:能删别人的评论(任务创建者不行 —— 口径是「作者本人或管理员」)", async () => {
		const id = await newTask("管理员删评论");
		const { id: commentId } = await asB().taskClose.commentCreate({ taskId: id, content: "乙的评论" });

		// 甲是**创建者**但不能删乙的评论(创建者没有这个豁免)
		await assertRejects(() => asA().taskClose.commentRemove({ id: commentId }), "管理员除外");

		// 丙持「系统管理员」→ 可以删任意评论
		await addUserRole(C.id, (await getSystemAdminRoleRow()).id);
		try {
			await asC().taskClose.commentRemove({ id: commentId });
			assert.equal((await asA().taskClose.commentList({ taskId: id })).length, 0, "管理员删完同样软删不出");
		} finally {
			await removeAllRolesOfUser(C.id);
		}
	});

	it("输入校验:纯空白的名称 / 评论不当有效值落库", async () => {
		const id = await newTask("输入校验");
		// zod 的 min(1) 拦得住 undefined / "",拦不住 "   " —— trim 后为空必须拒
		await assertRejects(() => asA().taskClose.commentCreate({ taskId: id, content: "   " }), "评论内容不能为空");
		await assertRejects(() => asA().taskClose.taskCreate({ name: "   ", workflowId }), "任务名称不能为空");

		const { id: createdId } = await asA().taskClose.taskCreate({ name: taskName("输入校验"), workflowId });
		await assertRejects(() => asA().taskClose.taskUpdate({ id: createdId, name: "   " }), "任务名称不能为空");
		// 编辑成功路径不受影响(名称没有任何多余空格)
		await asA().taskClose.taskUpdate({ id: createdId, name: `  ${taskName("输入校验")}-改  ` });
		assert.equal(
			(await asA().taskClose.taskGet({ id: createdId })).task.name,
			`${taskName("输入校验")}-改`,
			"名称去首尾空格",
		);
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
		// 创建者也不行:这条 (open,done) 只有 action 边,没有 direct 边 —— 必须走审批
		await assertRejects(() => asA().taskClose.taskTransit({ id: taskId, to: "done" }), "直接转移");
	});
});
