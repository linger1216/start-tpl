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

import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";

import {
	sysCasbinRule,
	sysFile,
	sysMenu,
	sysNotification,
	sysNotificationAttempt,
	sysNotificationDelivery,
	sysUser,
	taskCloseAction,
	taskCloseComment,
	taskCloseContentRevision,
	taskCloseLog,
	taskCloseMember,
	taskCloseTask,
	taskCloseWorkflow,
	taskReport,
	taskReportTemplate,
} from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { addUserRole, clearCasbinCache, removeAllRolesOfUser } from "../src/lib/casbin.ts";
import { bucketFor } from "../src/lib/storage.ts";
import { checkActionReminder } from "../src/lib/task-close-reminders.ts";
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
const createdReportTemplateIds: string[] = [];
/** 给测试用户临时授「填报模板」页面的 casbin p 行 —— after 里清 */
const createdCasbinRowIds: string[] = [];
const extraTestUserIds: string[] = [];
/** 评论 / 征询用的**真实**附件夹具(status=1 的 sys_file 行;2026-10 起附件 id 要真实存在) */
const ATTACH_FILE_ID = `file-cmnt-${suffix}`;
/** 故意不存在的附件 id —— 锁「未知 id 必须被拒」这条新守卫 */
const FAKE_ATTACH_ID = `file-nope-${suffix}`;
/** 真实存在、但**没挂在任何任务上**的文件 —— `attachmentUrl` 的归属守卫要拦它 */
const FOREIGN_FILE_ID = `file-foreign-${suffix}`;
/** 只挂在评论上的文件(正文附件区没有它)—— 走第二条归属链路 */
const COMMENT_FILE_ID = `file-comment-${suffix}`;
/** 用来验「已删除的文件签不出地址」;用例里临时改成 `status = 2`(已删除) */
const DELETED_FILE_ID = `file-deleted-${suffix}`;

before(async () => {
	await db.insert(sysUser).values([
		{ id: A.id, name: A.name, email: `${A.id}@test.local` },
		{ id: B.id, name: B.name, email: `${B.id}@test.local` },
		{ id: C.id, name: C.name, email: `${C.id}@test.local` },
	]);
	const workflows = await asA().taskClose.workflowList();
	assert.ok(workflows.length > 0, "要先跑 `pnpm db:seed:task-close` 才有模板");
	workflowId = workflows[0].id;
	// 附件夹具:status=1(已上传完成)的一行 sys_file
	const fileRows = [ATTACH_FILE_ID, FOREIGN_FILE_ID, COMMENT_FILE_ID, DELETED_FILE_ID].map((id) => ({
		id,
		// 用真实配置的桶名:`attachmentUrl` 会对桶取 region(真发一次请求),桶名写错会抛
		bucket: bucketFor("private"),
		object_key: `${TEST_PREFIX}attach-${id}-${suffix}.txt`,
		origin_name: "attachment.txt",
		size: 8,
		status: 1,
	}));
	await db.insert(sysFile).values(fileRows);
});

after(async () => {
	await purgeTestAuditRows([A.id, B.id, C.id]);
	if (createdCasbinRowIds.length > 0) {
		await db.delete(sysCasbinRule).where(inArray(sysCasbinRule.id, createdCasbinRowIds));
		clearCasbinCache();
	}
	const ids = (
		await db
			.select({ id: taskCloseTask.id })
			.from(taskCloseTask)
			.where(inArray(taskCloseTask.creator_id, [A.id, B.id, C.id]))
	).map((row) => row.id);
	if (ids.length > 0) {
		const actions = await db
			.select({ id: taskCloseAction.id })
			.from(taskCloseAction)
			.where(inArray(taskCloseAction.task_id, ids));
		const notifications = await db
			.select({ id: sysNotification.id })
			.from(sysNotification)
			.where(
				or(
					and(eq(sysNotification.source_type, "task"), inArray(sysNotification.source_id, ids)),
					and(
						eq(sysNotification.source_type, "task_action"),
						inArray(
							sysNotification.source_id,
							actions.map((row) => row.id),
						),
					),
				),
			);
		const notificationIds = notifications.map((row) => row.id);
		if (notificationIds.length) {
			const deliveries = await db
				.select({ id: sysNotificationDelivery.id })
				.from(sysNotificationDelivery)
				.where(inArray(sysNotificationDelivery.notification_id, notificationIds));
			if (deliveries.length)
				await db.delete(sysNotificationAttempt).where(
					inArray(
						sysNotificationAttempt.delivery_id,
						deliveries.map((row) => row.id),
					),
				);
			await db.delete(sysNotificationDelivery).where(inArray(sysNotificationDelivery.notification_id, notificationIds));
			await db.delete(sysNotification).where(inArray(sysNotification.id, notificationIds));
		}
		await db.delete(taskCloseAction).where(inArray(taskCloseAction.task_id, ids));
		await db.delete(taskCloseMember).where(inArray(taskCloseMember.task_id, ids));
		await db.delete(taskCloseComment).where(inArray(taskCloseComment.task_id, ids));
		// 活动日志也要清:它只增不改,留着就是一堆指向已删任务的孤儿行
		await db.delete(taskCloseLog).where(inArray(taskCloseLog.task_id, ids));
		await db.delete(taskCloseContentRevision).where(inArray(taskCloseContentRevision.task_id, ids));
		await db.delete(taskReport).where(inArray(taskReport.task_id, ids));
		await db.delete(taskCloseTask).where(inArray(taskCloseTask.id, ids));
	}
	if (createdReportTemplateIds.length) {
		await db.delete(taskReportTemplate).where(inArray(taskReportTemplate.id, createdReportTemplateIds));
	}
	if (createdWorkflowIds.length > 0) {
		await db.delete(taskCloseWorkflow).where(inArray(taskCloseWorkflow.id, createdWorkflowIds));
	}
	await db
		.delete(sysFile)
		.where(inArray(sysFile.id, [ATTACH_FILE_ID, FAKE_ATTACH_ID, FOREIGN_FILE_ID, COMMENT_FILE_ID, DELETED_FILE_ID]));
	await db.delete(sysUser).where(inArray(sysUser.id, [A.id, B.id, C.id, ...extraTestUserIds]));
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
	it("进入模板结束状态会终止未完成征询", async () => {
		const workflow = await caller.taskClose.workflowCreate({
			name: `${TEST_PREFIX}结束-${suffix}`,
			statuses: [
				{ value: "open", label: "进行中" },
				{ value: "closed", label: "已结束", terminal: true },
			],
			initial: "open",
			edges: [{ from: "open", to: "closed", who: ["creator"], via: "direct" }],
		});
		createdWorkflowIds.push(workflow.id);
		const task = await asA().taskClose.taskCreate({
			name: taskName("结束终止"),
			workflowId: workflow.id,
			members: [{ userId: B.id, role: "executor" }],
		});
		const action = await asA().taskClose.actionCreate({ taskId: task.id, handleId: B.id, nextHandleIds: [C.id] });
		await asA().taskClose.taskTransit({ id: task.id, to: "closed" });
		assert.ok((await asA().taskClose.actionList({ taskId: task.id })).every((row) => row.status === "cancelled"));
		assert.equal((await asA().taskClose.taskGet({ id: task.id })).permissions.canInitiateConsult, false);
		await assertRejects(() => asB().taskClose.actionReply({ id: action.id, content: "迟到" }), "已经回复过");
		await assertRejects(() => asA().taskClose.actionCreate({ taskId: task.id, handleId: B.id }), "任务已结束");
	});
	it("旧流程的任意角色与填报条件按新规则解释", async () => {
		const workflow = await caller.taskClose.workflowCreate({
			name: `${TEST_PREFIX}旧流程-${suffix}`,
			statuses: [
				{ value: "open", label: "进行中" },
				{ value: "done", label: "完成" },
				{ value: "closed", label: "关闭" },
			],
			initial: "open",
			edges: [
				{ from: "open", to: "done", who: ["executor"], via: "action" },
				{ from: "done", to: "closed", who: ["creator"], via: "direct" },
			],
		});
		createdWorkflowIds.push(workflow.id);
		const [row] = await db.select().from(taskCloseWorkflow).where(eq(taskCloseWorkflow.id, workflow.id));
		const legacy = {
			...(row.payload as object),
			edges: [
				{ from: "open", to: "done", who: ["any"], via: "action", guard: "report_submitted" },
				{ from: "done", to: "closed", who: ["any"], via: "direct", guard: "report_submitted" },
			],
		};
		await db.update(taskCloseWorkflow).set({ payload: legacy }).where(eq(taskCloseWorkflow.id, workflow.id));
		const detail = await caller.taskClose.workflowGet({ id: workflow.id });
		assert.deepEqual(detail.edges[0].who, ["creator", "participant", "executor"]);
		assert.ok(!("guard" in detail.edges[0]));
		const task = await asA().taskClose.taskCreate({
			name: taskName("旧流程兼容"),
			workflowId: workflow.id,
			members: [{ userId: B.id, role: "executor" }],
		});
		await db.update(taskCloseTask).set({ workflow: legacy }).where(eq(taskCloseTask.id, task.id));
		await assertRejects(
			() => asC().taskClose.actionCreate({ taskId: task.id, handleId: B.id, toStatus: "done" }),
			"没有权限",
		);
		assert.deepEqual((await asA().taskClose.taskGet({ id: task.id })).permissions.actionTargets, ["done"]);
		assert.deepEqual((await asB().taskClose.taskGet({ id: task.id })).permissions.actionTargets, ["done"]);
		const action = await asB().taskClose.actionCreate({ taskId: task.id, handleId: A.id, toStatus: "done" });
		await asA().taskClose.actionRespond({ id: action.id, approved: true });
		await assertRejects(() => asC().taskClose.taskTransit({ id: task.id, to: "closed" }), "没有权限");
		await asA().taskClose.taskTransit({ id: task.id, to: "closed" });
	});
	it("串行多人审批逐步激活，全部通过后才推进", async () => {
		const taskId = await newTask("串行多人审批");
		const first = await asA().taskClose.actionCreate({
			taskId,
			toStatus: "done",
			handleId: B.id,
			nextHandleIds: [C.id],
			flowMode: "serial",
		});
		const allowed = await asA().taskClose.taskGet({ id: taskId });
		assert.equal(allowed.task.status, "open");
		assert.equal(allowed.permissions.locked, true);
		assert.deepEqual(allowed.permissions.actionTargets, []);
		assert.equal(allowed.permissions.canInitiateConsult, true);
		await asA().taskClose.actionCreate({ taskId, handleId: A.id });
		let actions = await asA().taskClose.actionList({ taskId });
		const second = actions.find((action) => action.handleId === C.id);
		assert.ok(second?.isLocking && second.status === "queued");
		assert.equal(
			(await asC().taskClose.actionMine({})).items.some((item) => item.id === second.id),
			false,
		);
		await assertRejects(() => asC().taskClose.actionRespond({ id: second.id, approved: true }), "已经答复过");
		await asB().taskClose.actionRespond({ id: first.id, approved: true });
		actions = await asA().taskClose.actionList({ taskId });
		assert.equal(actions.find((action) => action.id === second.id)?.status, "active");
		assert.equal((await asA().taskClose.taskGet({ id: taskId })).task.status, "open");
		await asC().taskClose.actionRespond({ id: second.id, approved: true });
		assert.equal((await asA().taskClose.taskGet({ id: taskId })).task.status, "done");
	});

	it("并行审批拒绝与通过竞争时回退并终止剩余节点", async () => {
		const taskId = await newTask("并行多人审批");
		const first = await asA().taskClose.actionCreate({
			taskId,
			toStatus: "done",
			handleId: B.id,
			nextHandleIds: [C.id],
			flowMode: "parallel",
		});
		const second = (await asA().taskClose.actionList({ taskId })).find((action) => action.handleId === C.id);
		assert.ok(second && second.status === "active" && second.isLocking);
		const outcomes = await Promise.allSettled([
			asB().taskClose.actionRespond({ id: first.id, approved: true }),
			asC().taskClose.actionRespond({ id: second.id, approved: false, reason: "需补充" }),
		]);
		assert.equal(outcomes[1].status, "fulfilled");
		assert.equal((await asA().taskClose.taskGet({ id: taskId })).task.status, "open");
		const actions = await asA().taskClose.actionList({ taskId });
		assert.ok(actions.every((action) => action.status !== "active" && action.status !== "queued"));
	});

	it("并行审批同时通过时最终推进一次", async () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			const taskId = await newTask(`并行通过${attempt}`);
			const first = await asA().taskClose.actionCreate({
				taskId,
				toStatus: "done",
				handleId: B.id,
				nextHandleIds: [C.id],
				flowMode: "parallel",
			});
			const second = (await asA().taskClose.actionList({ taskId })).find((action) => action.handleId === C.id);
			assert.ok(second);
			await Promise.all([
				asB().taskClose.actionRespond({ id: first.id, approved: true }),
				asC().taskClose.actionRespond({ id: second.id, approved: true }),
			]);
			assert.equal((await asA().taskClose.taskGet({ id: taskId })).task.status, "done");
			const logs = await asA().taskClose.logList({ taskId });
			assert.equal(logs.items.filter((item) => item.event === "action.respond" && item.toStatus === "done").length, 1);
		}
	});

	it("撤回后续审批节点会终止整条审批并恢复原状态", async () => {
		const taskId = await newTask("撤回多人审批");
		const first = await asA().taskClose.actionCreate({
			taskId,
			toStatus: "done",
			handleId: B.id,
			nextHandleIds: [C.id],
		});
		await asB().taskClose.actionRespond({ id: first.id, approved: true });
		const second = (await asA().taskClose.actionList({ taskId })).find((action) => action.handleId === C.id);
		assert.ok(second);
		await asA().taskClose.actionWithdraw({ id: second.id });
		assert.equal((await asA().taskClose.taskGet({ id: taskId })).task.status, "open");
		await assertRejects(() => asC().taskClose.actionRespond({ id: second.id, approved: true }), "已经答复过");
	});
	it("新建任务时绑定填报版本并初始化草稿", async () => {
		const template = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "创建时配置填报",
			payload: {
				id: "setup",
				kind: "OBJECT",
				fields: [{ id: "town", label: "街镇", type: "text", defaultValue: "示例街镇" }],
			},
		});
		createdReportTemplateIds.push(template.id);
		const created = await asA().taskClose.taskCreate({
			name: taskName("创建填报"),
			workflowId,
			report: { reportId: template.id },
			members: [{ userId: B.id, role: "executor" }],
		});
		const report = await asB().taskClose.reportGet({ taskId: created.id });
		assert.equal(report?.template.id, template.id);
		assert.deepEqual(report?.report.draft, { town: "示例街镇" });
	});
	it("填报模板在创建任务时固定,不能更换或移除;保存靠 revision 挡住覆盖", async () => {
		const old = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "原填报",
			payload: { id: "old", kind: "OBJECT", fields: [{ id: "name", label: "名称", type: "text" }] },
		});
		const next = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "新填报",
			payload: {
				id: "next",
				kind: "OBJECT",
				fields: [{ id: "town", label: "街镇", type: "text", defaultValue: "新值" }],
			},
		});
		createdReportTemplateIds.push(old.id, next.id);
		const task = await asA().taskClose.taskCreate({
			name: taskName("固定填报"),
			workflowId,
			report: { reportId: old.id },
		});
		const saved = await asA().taskClose.reportSaveDraft({ taskId: task.id, revision: 0, draft: { name: "旧数据" } });
		assert.equal(saved.revision, 1);
		await assertRejects(
			() => asB().taskClose.reportBind({ taskId: task.id, reportId: next.id }),
			"只有任务创建人或管理员",
		);
		// 换成别的模板、或重绑同一个模板,一律拒绝
		await assertRejects(() => asA().taskClose.reportBind({ taskId: task.id, reportId: next.id }), "不能更换或移除");
		await assertRejects(() => asA().taskClose.reportBind({ taskId: task.id, reportId: old.id }), "不能更换或移除");
		const report = await asA().taskClose.reportGet({ taskId: task.id });
		assert.equal(report?.template.id, old.id);
		assert.deepEqual(report?.report.draft, { name: "旧数据" });
		await assertRejects(
			() => asA().taskClose.reportSaveDraft({ taskId: task.id, revision: 0, draft: { name: "过期数据" } }),
			"填报已被修改",
		);
		const again = await asA().taskClose.reportSaveDraft({ taskId: task.id, revision: 1, draft: { name: "新数据" } });
		assert.equal(again.revision, 2);
	});
	it("带数下发:report.rows 直带行,数据规则过滤初始草稿,模板视角可下载模版再导入", async () => {
		const template = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "带数下发",
			payload: {
				id: "rows",
				kind: "TABLE",
				fields: [
					{ id: "town", label: "街镇", type: "text" },
					{ id: "value", label: "数值", type: "integer" },
				],
			},
			shared: true,
		});
		createdReportTemplateIds.push(template.id);
		const rows = [
			{ town: "甲镇", value: 1 },
			{ town: "甲镇", value: 2 },
			{ town: "乙镇", value: 3 },
		];
		const task = await asA().taskClose.taskCreate({
			name: taskName("带行"),
			workflowId,
			report: { reportId: template.id, rows, filter: [{ field: "town", value: "甲镇" }] },
			members: [{ userId: B.id, role: "executor" }],
		});
		assert.deepEqual((await asB().taskClose.reportGet({ taskId: task.id }))?.report.draft, [
			{ town: "甲镇", value: 1 },
			{ town: "甲镇", value: 2 },
		]);
		const formTemplate = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "带数下发-表单",
			payload: { id: "form_only", kind: "OBJECT", fields: [{ id: "town", label: "街镇", type: "text" }] },
		});
		createdReportTemplateIds.push(formTemplate.id);
		await assertRejects(
			() =>
				asA().taskClose.taskCreate({
					name: taskName("表单带行"),
					workflowId,
					report: { reportId: formTemplate.id, rows },
				}),
			"数据规则只支持表格形式模板",
		);
		// 单执行人:范围也可以挂在执行人身上(界面上的「数据范围」)
		const viaMember = await asA().taskClose.taskCreate({
			name: taskName("按人配范围"),
			workflowId,
			report: { reportId: template.id, rows },
			members: [{ userId: B.id, role: "executor", filter: [{ field: "town", value: "乙镇" }] }],
		});
		assert.deepEqual((await asB().taskClose.reportGet({ taskId: viaMember.id }))?.report.draft, [
			{ town: "乙镇", value: 3 },
		]);
		// 建任务前的模板视角:下载模版 → 解析回来(与任务视角同一套接口)
		const modelFile = await asA().taskClose.reportExcelDownload({ reportId: template.id });
		assert.ok(modelFile.fileBase64.length > 0);
		const imported = await asA().taskClose.reportExcelPreview({
			reportId: template.id,
			fileBase64: modelFile.fileBase64,
		});
		assert.deepEqual(imported.value, [], "空模版(只有表头)解析出 0 行");
		// shared 模板对非管理员也开放模板导入
		assert.ok((await asB().taskClose.reportExcelDownload({ reportId: template.id })).fileBase64.length > 0);
	});
	it("多执行人 + 填报模板 fan-out:子任务各拿一份副本、继承父任务的说明与链接,手动「保存」才同步回父任务", async () => {
		const template = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "fanout 分发",
			payload: {
				id: "fanout",
				kind: "TABLE",
				fields: [
					{ id: "town", label: "街镇", type: "text" },
					{ id: "value", label: "数值", type: "integer" },
				],
			},
		});
		createdReportTemplateIds.push(template.id);
		const links = [{ kind: "link" as const, url: "https://example.com/brief" }];
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: taskName("fanout"),
			description: "父任务说明",
			payload: { type: "素材", links },
			workflowId,
			report: {
				reportId: template.id,
				rows: [
					{ town: "甲镇", value: 1 },
					{ town: "乙镇", value: 2 },
				],
			},
			members: [
				{ userId: B.id, role: "executor", filter: [{ field: "town", value: "甲镇" }] },
				{ userId: C.id, role: "executor", filter: [{ field: "town", value: "乙镇" }] },
			],
		});
		const [parent] = await db.select().from(taskCloseTask).where(eq(taskCloseTask.id, parentId));
		assert.equal(parent?.parent_id, null);
		assert.deepEqual(parent?.report, { reportId: template.id });
		const children = await db.select().from(taskCloseTask).where(eq(taskCloseTask.parent_id, parentId));
		assert.equal(children.length, 2);
		const childB = children.find(
			(row) => (row.report as { filter?: Array<{ value: string }> }).filter?.[0]?.value === "甲镇",
		);
		const childC = children.find(
			(row) => (row.report as { filter?: Array<{ value: string }> }).filter?.[0]?.value === "乙镇",
		);
		assert.ok(childB && childC);
		// 子任务继承父任务的说明与链接
		for (const child of [childB, childC]) {
			assert.equal(child.description, "父任务说明");
			assert.deepEqual((child.payload as { links?: unknown }).links, links);
		}
		// 父任务**改了**说明,子任务跟着改(说明描述的是整件事)
		await asA().taskClose.taskUpdate({ id: parentId, name: parent.name ?? "父任务", description: "父任务说明(改)" });
		for (const child of await db.select().from(taskCloseTask).where(eq(taskCloseTask.parent_id, parentId))) {
			assert.equal(child.description, "父任务说明(改)", "父任务改说明要同步到子任务");
		}
		const reportB = await asB().taskClose.reportGet({ taskId: childB.id });
		assert.equal(reportB?.template.id, template.id);
		assert.deepEqual(reportB?.report.draft, [{ town: "甲镇", value: 1 }], "子任务拿的是下发时复制的那一份");
		assert.equal(reportB?.canSyncToParent, true);
		const reportC = await asC().taskClose.reportGet({ taskId: childC.id });
		assert.deepEqual(reportC?.report.draft, [{ town: "乙镇", value: 2 }]);
		const parentView = await asA().taskClose.reportGet({ taskId: parentId });
		assert.deepEqual(parentView?.report.draft, [
			{ town: "甲镇", value: 1 },
			{ town: "乙镇", value: 2 },
		]);
		assert.equal(parentView?.canSyncToParent, false, "父任务本身就是数据源,没有父可同步");

		// 自动保存只写自己那行:父任务不动,也没有跨任务锁
		const savedB = await asB().taskClose.reportSaveDraft({
			taskId: childB.id,
			revision: reportB?.report.revision ?? 0,
			draft: [{ town: "甲镇", value: 10 }],
		});
		assert.equal(savedB.revision, (reportB?.report.revision ?? 0) + 1);
		assert.deepEqual(
			(await asA().taskClose.reportGet({ taskId: parentId }))?.report.draft,
			[
				{ town: "甲镇", value: 1 },
				{ town: "乙镇", value: 2 },
			],
			"没点「保存」之前,父任务的数据不变",
		);
		// 另一个执行人改自己那份:各自 revision,互不冲突
		await asC().taskClose.reportSaveDraft({
			taskId: childC.id,
			revision: reportC?.report.revision ?? 0,
			draft: [{ town: "乙镇", value: 20 }],
		});
		const savedB2 = await asB().taskClose.reportSaveDraft({
			taskId: childB.id,
			revision: savedB.revision,
			draft: [{ town: "甲镇", value: 11 }],
		});
		assert.equal(savedB2.revision, savedB.revision + 1);

		// 手动「保存」:把我这份切片整片同步到父任务(别人的行原样保留)
		const synced = await asB().taskClose.reportSyncToParent({ taskId: childB.id });
		assert.equal(synced.pushed, 1);
		assert.deepEqual((await asA().taskClose.reportGet({ taskId: parentId }))?.report.draft, [
			{ town: "乙镇", value: 2 },
			{ town: "甲镇", value: 11 },
		]);
		// 回灌:我的视图 = 父数据按我的范围重算
		const afterSync = await asB().taskClose.reportGet({ taskId: childB.id });
		assert.deepEqual(afterSync?.report.draft, [{ town: "甲镇", value: 11 }]);
		assert.equal(afterSync?.report.revision, synced.revision);

		// 改范围字段:同步后这条行交给父任务,我这边按范围重算后就看不见了
		await asB().taskClose.reportSaveDraft({
			taskId: childB.id,
			revision: synced.revision,
			draft: [{ town: "丙镇", value: 11 }],
		});
		const moved = await asB().taskClose.reportSyncToParent({ taskId: childB.id });
		assert.equal(moved.kept, 0, "移出我范围的行不再留在我的视图里");
		assert.deepEqual((await asB().taskClose.reportGet({ taskId: childB.id }))?.report.draft, []);
		assert.deepEqual((await asA().taskClose.reportGet({ taskId: parentId }))?.report.draft, [
			{ town: "乙镇", value: 2 },
			{ town: "丙镇", value: 11 },
		]);

		// 父任务没有父可同步
		await assertRejects(() => asA().taskClose.reportSyncToParent({ taskId: parentId }), "只有子任务");
		// 两个执行人的数据范围完全相同 → 建任务时就拦,不等到保存互相覆盖
		await assertRejects(
			() =>
				asA().taskClose.taskCreate({
					name: taskName("范围重叠"),
					workflowId,
					report: { reportId: template.id, rows: [{ town: "甲镇", value: 1 }] },
					members: [
						{ userId: B.id, role: "executor", filter: [{ field: "town", value: "甲镇" }] },
						{ userId: C.id, role: "executor", filter: [{ field: "town", value: "甲镇" }] },
					],
				}),
			"数据范围不能相同",
		);
		// 删父任务连带软删子任务,不留指向已删根任务的孤儿
		await asA().taskClose.taskRemove({ id: parentId });
		const orphans = await db
			.select()
			.from(taskCloseTask)
			.where(inArray(taskCloseTask.id, [childB.id, childC.id]));
		assert.ok(
			orphans.every((row) => row.deleted_at !== null),
			"子任务跟着父任务一起软删",
		);
		await assertRejects(() => asB().taskClose.reportGet({ taskId: childB.id }), "任务不存在");
	});
	it("内容区按整棵树取并集:子任务加附件 / 链接,父任务看得到,也签得出地址", async () => {
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: taskName("共享内容"),
			workflowId,
			payload: { links: [{ kind: "link", url: "https://example.com/parent" }] },
			members: [
				{ userId: B.id, role: "executor" },
				{ userId: C.id, role: "executor" },
			],
		});
		const children = await db.select().from(taskCloseTask).where(eq(taskCloseTask.parent_id, parentId));
		// 找 B 那条子任务:成员表里 role=executor 的那个人
		const childRows = await db
			.select({ id: taskCloseMember.task_id })
			.from(taskCloseMember)
			.where(
				and(
					inArray(
						taskCloseMember.task_id,
						children.map((row) => row.id),
					),
					eq(taskCloseMember.user_id, B.id),
				),
			);
		const childId = childRows[0]?.id;
		assert.ok(childId);
		// 执行人(不是创建人)自己给子任务加附件 —— 以前只有创建人能做
		await asB().taskClose.taskAttach({ id: childId, attachments: [ATTACH_FILE_ID] });
		// 创建人给子任务补链接(整块 payload 仍属创建人 / 管理员)
		await asA().taskClose.taskUpdate({
			id: childId,
			name: taskName("共享内容"),
			payload: { links: [{ kind: "link", url: "https://example.com/child" }], attachments: [ATTACH_FILE_ID] },
		});
		// 父任务:链接并集 + 子任务附件都在,且签得出地址
		const parent = await asA().taskClose.taskGet({ id: parentId });
		assert.deepEqual(parent.links.map((block) => block.url).sort(), [
			"https://example.com/child",
			"https://example.com/parent",
		]);
		assert.ok(
			parent.attachments.some((file) => file.id === ATTACH_FILE_ID),
			"子任务的附件要出现在父任务里",
		);
		assert.deepEqual(
			parent.own.links.map((block) => block.url),
			["https://example.com/parent"],
			"own 只含本任务内容",
		);
		await asA().taskClose.attachmentUrl({ taskId: parentId, fileId: ATTACH_FILE_ID });
		// 子任务看父任务的链接
		const child = await asB().taskClose.taskGet({ id: childId });
		assert.ok(child.links.some((block) => block.url === "https://example.com/parent"));
		// 旁观者加附件被拒
		await db.insert(sysUser).values({ id: `viewer-${suffix}`, name: "旁观", email: `viewer-${suffix}@test.local` });
		extraTestUserIds.push(`viewer-${suffix}`);
		await assertRejects(
			() => callerAs({ id: `viewer-${suffix}`, name: "旁观" }).taskClose.taskAttach({ id: parentId, attachments: [] }),
			"无权给这条任务加附件",
		);
	});
	it("多执行人建任务 = 父 + N 子;我的任务列表只列父,执行人自己能直接看到子任务", async () => {
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: taskName("无模板分发"),
			workflowId,
			members: [
				{ userId: B.id, role: "executor" },
				{ userId: C.id, role: "executor" },
			],
		});
		const children = await db.select().from(taskCloseTask).where(eq(taskCloseTask.parent_id, parentId));
		assert.equal(children.length, 2, "两个执行人各一条子任务");
		assert.ok(
			children.every((child) => child.report === null),
			"没绑填报模板时子任务也没有填报规则",
		);
		const detail = await asA().taskClose.taskGet({ id: parentId });
		assert.equal(detail.children.length, 2, "父任务详情带出子任务");
		assert.equal(detail.members.filter((member) => member.role === "executor").length, 0, "父任务本身不设执行人");

		// 创建人:列表只有父任务(子任务挂在父里),父任务卡片带 childCount
		const mine = await asA().taskClose.taskList({ mine: true, pageSize: 100 });
		const parentRow = mine.items.find((item) => item.id === parentId);
		assert.equal(parentRow?.childCount, 2);
		const childIds = new Set(children.map((child) => child.id));
		assert.ok(!mine.items.some((item) => childIds.has(item.id)), "创建人的列表里不再单独列出子任务");

		// 执行人:自己的那条子任务必须在列表里(否则没入口干活),父任务看不到
		const childMembers = await db
			.select()
			.from(taskCloseMember)
			.where(inArray(taskCloseMember.task_id, [...childIds]));
		const bChild = children.find((child) =>
			childMembers.some(
				(member) => member.task_id === child.id && member.user_id === B.id && member.role === "executor",
			),
		);
		assert.ok(bChild, "B 是其中一条子任务的执行人");
		const asBList = await asB().taskClose.taskList({ mine: true, pageSize: 100 });
		assert.ok(
			asBList.items.some((item) => item.id === bChild.id),
			"执行人能在「我的任务」里看到自己那条子任务",
		);
		assert.ok(!asBList.items.some((item) => item.id === parentId), "执行人看不到父任务");

		// 子任务的**参与者**(不是执行人)也要在列表里看到自己参与的那条 —— 参与≠没活干
		await asA().taskClose.memberAdd({ taskId: bChild.id, userId: C.id, role: "participant" });
		const asCList = await asC().taskClose.taskList({ mine: true, pageSize: 100 });
		assert.ok(
			asCList.items.some((item) => item.id === bChild.id),
			"参与者能在「我的任务」里看到自己参与的子任务",
		);
	});
	it("父任务先自己加参与者,再从任务内的角色里选审批人(不反向依赖子任务执行人)", async () => {
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: taskName("父任务审批人"),
			workflowId,
			members: [
				{ userId: B.id, role: "executor" },
				{ userId: C.id, role: "executor" },
			],
		});
		const detail = await asA().taskClose.taskGet({ id: parentId });
		assert.equal(detail.members.filter((member) => member.role === "executor").length, 0, "父任务不设执行人");
		// 父任务要找人:**自己加参与者**,而不是反向依赖子任务的执行人
		await asA().taskClose.memberAdd({ taskId: parentId, userId: B.id, role: "participant" });
		const action = await asA().taskClose.actionCreate({ taskId: parentId, toStatus: "done", handleId: B.id });
		const mine = await asB().taskClose.actionMine({ pageSize: 100 });
		assert.ok(
			mine.items.some((item) => item.id === action.id),
			"加进来的参与者能在「待我处理」里看到审批",
		);
		await asB().taskClose.actionRespond({ id: action.id, approved: true });
	});

	it("任务详情只对相关方开放:陌生人 403;父任务参与者向下能看子任务,子任务看不到父任务", async () => {
		// 1) 只有创建人、没有其他人的任务
		const solo = await asA().taskClose.taskCreate({ name: taskName("只给相关方"), workflowId });
		await assertRejects(() => asB().taskClose.taskGet({ id: solo.id }), "无权查看这条任务");

		// 2) 父 + 两个子(fan-out);C 既是某个子任务的执行人,又加进父任务做参与者
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: taskName("树可见"),
			workflowId,
			members: [
				{ userId: B.id, role: "executor" },
				{ userId: C.id, role: "executor" },
			],
		});
		const kids = await db.select().from(taskCloseTask).where(eq(taskCloseTask.parent_id, parentId));
		assert.equal(kids.length, 2);
		await asA().taskClose.memberAdd({ taskId: parentId, userId: C.id, role: "participant" });
		// C:父任务参与者 → 父任务与两个子任务都能看(任务树向下可见)
		for (const id of [parentId, ...kids.map((kid) => kid.id)]) await asC().taskClose.taskGet({ id });
		// B:只是子任务的执行人,不是父任务的人 → 看不到父任务
		await assertRejects(() => asB().taskClose.taskGet({ id: parentId }), "无权查看这条任务");
	});
	it("并发保存只有一个成功;转交后旧执行人写不进去", async () => {
		const taskId = await newTask("填报生命周期");
		const payload = {
			id: "inspection",
			kind: "OBJECT" as const,
			fields: [{ id: "name", label: "名称", type: "text" as const, required: true }],
		};
		const template = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: "检查填报",
			payload,
		});
		createdReportTemplateIds.push(template.id);
		await asA().taskClose.reportBind({ taskId, reportId: template.id });
		const excel = await asB().taskClose.reportExcelDownload({ taskId, templateOnly: true });
		await assertRejects(
			() => asC().taskClose.reportExcelPreview({ taskId, fileBase64: excel.fileBase64 }),
			"当前执行人",
		);
		const preview = await asB().taskClose.reportExcelPreview({ taskId, fileBase64: excel.fileBase64 });
		assert.deepEqual(preview.value, {}, "空模版(只有表头)解析成空表单");
		await callerAs({ ...A, isSuper: true }).taskClose.reportTemplatePublish({
			id: template.id,
			payload: { ...payload, fields: [{ id: "other", label: "新版", type: "text" }] },
		});
		await assertRejects(() => asC().taskClose.reportGet({ taskId }), "无权查看");
		const guest = callerAs({ id: "share-guest", name: "访客" });
		assert.ok(await guest.taskClose.reportGet({ taskId }));
		const prepared = await asA().taskClose.reportSaveDraft({ taskId, revision: 0, draft: { other: "准备数据" } });
		assert.equal(prepared.revision, 1);

		// 同一个 revision 并发保存:只有一个落库
		const saves = await Promise.allSettled([
			asB().taskClose.reportSaveDraft({ taskId, revision: 1, draft: { other: "第一次" } }),
			asB().taskClose.reportSaveDraft({ taskId, revision: 1, draft: { other: "并发" } }),
		]);
		assert.equal(saves.filter((result) => result.status === "fulfilled").length, 1);
		const report = await asA().taskClose.reportGet({ taskId });
		assert.equal(report?.template.id, template.id);
		assert.equal(report?.report.revision, 2);

		// 转交后旧执行人不再是执行人,保存被拒
		await asA().taskClose.memberAdd({ taskId, userId: C.id, role: "participant" });
		await asB().taskClose.taskTransfer({ taskId, userId: C.id });
		await assertRejects(
			() => asB().taskClose.reportSaveDraft({ taskId, revision: 2, draft: { other: "旧执行人" } }),
			"当前执行人",
		);
		const saved = await asC().taskClose.reportSaveDraft({ taskId, revision: 2, draft: { other: "第二次" } });
		assert.equal(saved.revision, 3);
		assert.deepEqual((await asA().taskClose.reportGet({ taskId }))?.report.draft, { other: "第二次" });
	});

	it("串行征询只激活当前节点，并在回复后通知下一人", async () => {
		const id = await newTask("串行征询");
		const { id: first } = await asA().taskClose.actionCreate({ taskId: id, handleId: B.id, nextHandleIds: [C.id] });
		let actions = await asA().taskClose.actionList({ taskId: id });
		const next = actions.find((action) => action.handleId === C.id);
		assert.ok(next);
		assert.equal(next.status, "queued");
		assert.equal(
			(await asC().taskClose.actionMine({})).items.some((action) => action.id === next.id),
			false,
		);
		const before = await db
			.select()
			.from(sysNotification)
			.where(and(eq(sysNotification.source_type, "task_action"), eq(sysNotification.source_id, next.id)));
		assert.equal(before.length, 0);
		await assertRejects(() => asC().taskClose.actionReply({ id: next.id, content: "提前回复" }), "已经回复过");
		await asB().taskClose.actionReply({ id: first, content: "第一步意见" });
		actions = await asA().taskClose.actionList({ taskId: id });
		assert.equal(actions.find((action) => action.id === next.id)?.status, "active");
		assert.equal(
			(await asC().taskClose.actionMine({})).items.some((action) => action.id === next.id),
			true,
		);
		assert.equal(
			(
				await db
					.select()
					.from(sysNotification)
					.where(and(eq(sysNotification.source_type, "task_action"), eq(sysNotification.source_id, next.id)))
			).length,
			1,
		);
		await asC().taskClose.actionReply({ id: next.id, content: "第二步意见" });
		assert.equal((await asA().taskClose.taskGet({ id })).task.status, "open");
	});

	it("删除任务同时终止活动和排队的征询", async () => {
		const id = await newTask("删除终止征询");
		await asA().taskClose.actionCreate({ taskId: id, handleId: B.id, nextHandleIds: [C.id] });
		await asA().taskClose.taskRemove({ id });
		const rows = await db.select().from(taskCloseAction).where(eq(taskCloseAction.task_id, id));
		assert.equal(rows.length, 2);
		assert.ok(rows.every((row) => row.status === "cancelled"));
		assert.equal(
			(await asB().taskClose.actionMine({})).items.some((row) => row.taskId === id),
			false,
		);
	});

	it("并行征询的处理人互不阻塞", async () => {
		const id = await newTask("并行征询");
		const { id: first } = await asA().taskClose.actionCreate({
			taskId: id,
			handleId: B.id,
			nextHandleIds: [C.id],
			flowMode: "parallel",
		});
		const next = (await asA().taskClose.actionList({ taskId: id })).find((action) => action.handleId === C.id);
		assert.ok(next);
		assert.equal(next.status, "active");
		await asC().taskClose.actionReply({ id: next.id, content: "并行意见" });
		assert.equal(
			(await asA().taskClose.actionList({ taskId: id })).find((action) => action.id === first)?.status,
			"active",
		);
		await asB().taskClose.actionReply({ id: first, content: "另一意见" });
		assert.equal((await asA().taskClose.taskGet({ id })).task.status, "open");
	});

	it("并发指派最多产生一个执行人", async () => {
		const { id } = await asA().taskClose.taskCreate({ name: taskName("并发指派"), workflowId });
		const results = await Promise.allSettled([
			asA().taskClose.memberAdd({ taskId: id, userId: B.id, role: "executor" }),
			asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "executor" }),
		]);
		assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
		const rejected = results.find((result) => result.status === "rejected");
		assert.ok(rejected && rejected.status === "rejected" && String(rejected.reason).includes("已有执行人"));
		const members = (await asA().taskClose.taskGet({ id })).members;
		assert.equal(members.filter((member) => member.role === "executor").length, 1);
		// 多层指派依然每股只有一个执行人;而**建任务时**给多个执行人 = fan-out(见下一条用例)
		const members2 = (await asA().taskClose.taskGet({ id })).members;
		assert.equal(members2.filter((member) => member.role === "executor").length, 1);
	});

	it("撤回与回复竞争时不能复活已撤回的征询", async () => {
		const id = await newTask("撤回竞争");
		const action = await asA().taskClose.actionCreate({ taskId: id, handleId: B.id });
		const results = await Promise.allSettled([
			asA().taskClose.actionWithdraw({ id: action.id }),
			asB().taskClose.actionReply({ id: action.id, content: "意见" }),
		]);
		assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
		const row = (await asA().taskClose.actionList({ taskId: id })).find((item) => item.id === action.id);
		assert.ok(row?.status === "done" || row?.status === "cancelled");
	});

	it("主链:建 → 执行者发起完成 → 锁住 → 答复 → 关单", async () => {
		const id = await newTask("主链");

		let detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "初始状态取模板的 initial");
		assert.equal(detail.members.length, 1);
		assert.equal(detail.members[0].name, B.name, "成员要回填姓名");

		// 乙(执行者)发起「改状态」action —— 默认模板里 open→done 的 who 是 ["creator","executor"]
		const { id: actionId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		await assertRejects(() => asB().taskClose.actionReply({ id: actionId, content: "绕过审批" }), "审批必须通过或驳回");
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "审批期间任务状态不变");
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

		// ② 发起审批不改变任务状态;目标写在 detail.intendedTo
		const { id: actionId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
		items = await log();
		const created = items.find((row) => row.event === "action.create");
		assert.ok(created);
		assert.equal(created.fromStatus, null);
		assert.equal(created.toStatus, null);
		assert.equal(created.actorName, B.name);
		assert.equal((created.detail as { intendedTo: string }).intendedTo, "done");
		assert.equal(created.targetName, B.name, "动作事件的展示名是「指派人」");

		// ③ 答复通过:open → done
		await asB().taskClose.actionRespond({ id: actionId, approved: true });
		items = await log();
		const responded = items.find((row) => row.event === "action.respond");
		assert.ok(responded);
		assert.equal(responded.fromStatus, "open");
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
		assert.equal(asExecutor.permissions.canAddMember, true, "任务成员仍能加人(不是「所有登录用户」)");
		assert.equal(asExecutor.permissions.canManageMembers, false, "移出成员仍仅创建者");
		assert.equal(asExecutor.permissions.canUpdate, false);
		assert.deepEqual(asExecutor.permissions.myRoles, ["executor"]);

		// 非创建者**可以加**成员(需求:所有角色都能加),但**不能移出**、不能删任务
		await assertRejects(() => asB().taskClose.memberAdd({ taskId: id, userId: C.id, role: "executor" }), "已有执行人");
		const afterAdd = await asA().taskClose.taskGet({ id });
		assert.ok(
			afterAdd.members.some((m) => m.userId === C.id && m.role === "participant"),
			"非创建者(执行者 B)加的人要进成员表",
		);
		await assertRejects(
			() => asB().taskClose.memberRemove({ taskId: id, userId: C.id, role: "participant" }),
			"创建者",
		);
		await assertRejects(() => asB().taskClose.taskRemove({ id }), "创建者");
	});

	it("陌生人不能把自己加成执行人(成员写权限只给任务相关方)", async () => {
		const id = await newTask("陌生人不许入伙");
		const outsiderId = `out-${crypto.randomUUID().slice(0, 24)}`;
		const outsider = callerAs({ id: outsiderId, name: "路人" });
		await assertRejects(
			() => outsider.taskClose.memberAdd({ taskId: id, userId: outsiderId, role: "executor" }),
			"创建者、管理员或任务成员",
		);
		// 创建者与当前成员仍可加人
		await asA().taskClose.memberAdd({ taskId: id, userId: C.id, role: "participant" });
	});

	it("同一个人不能以两个角色重复入表", async () => {
		const id = await newTask("角色去重"); // 建任务时 B 已是 executor
		await assertRejects(
			() => asA().taskClose.memberAdd({ taskId: id, userId: B.id, role: "participant" }),
			"已经是任务成员",
		);
		const members = (await asA().taskClose.taskGet({ id })).members.filter((member) => member.userId === B.id);
		assert.equal(members.length, 1, "同一个人只该有一行");
	});

	it("taskUpdate 不传 payload 时保留原有内容与附件,传 null 才是清空", async () => {
		const id = await newTask("payload 保留");
		await asA().taskClose.taskUpdate({
			id,
			name: "payload 保留",
			payload: { type: "internal", links: [{ kind: "link", url: "/tasks" }] },
		});
		// 只改名字,不带 payload
		await asA().taskClose.taskUpdate({ id, name: "改了名字" });
		let detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.links[0]?.url, "/tasks", "不传 payload 不能把链接清空");
		assert.equal((detail.task.payload as { type?: string }).type, "internal", "type 也要保住");
		// 显式 null 才是清空
		await asA().taskClose.taskUpdate({ id, name: "改了名字", payload: null });
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.links.length, 0, "payload: null 才清空");
	});

	it("taskUpdate 不传 description / dueAt 时保留旧值,传 null 才是清空", async () => {
		const id = await newTask("字段保留");
		await asA().taskClose.taskUpdate({
			id,
			name: "字段保留",
			description: "原说明",
			dueAt: "2026-12-31T00:00:00.000Z",
		});
		// 只改名字,不带 description / dueAt
		await asA().taskClose.taskUpdate({ id, name: "只改名字" });
		let detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.description, "原说明", "不传 description 不能清空");
		assert.equal(detail.task.dueAt, "2026-12-31T00:00:00.000Z", "不传 dueAt 不能清空");
		// 显式 null 才是清空
		await asA().taskClose.taskUpdate({ id, name: "只改名字", description: null, dueAt: null });
		detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.description, null, "description: null 才清空");
		assert.equal(detail.task.dueAt, null, "dueAt: null 才清空");
	});

	it("payload 里的附件 id 必须真存在且已确认", async () => {
		const id = await newTask("伪造附件");
		await assertRejects(
			() =>
				asA().taskClose.taskUpdate({
					id,
					name: "伪造附件",
					payload: { attachments: ["not-a-real-file-id"] },
				}),
			"附件不存在",
		);
		const workflowId = (await asA().taskClose.workflowList())[0]?.id ?? "";
		await assertRejects(
			() =>
				asA().taskClose.taskCreate({
					name: "伪造附件任务",
					workflowId,
					payload: { attachments: ["not-a-real-file-id"] },
				}),
			"附件不存在",
		);
	});

	it("删掉之后这条 id 就查不到了(详情页据此自动回「我的任务」)", async () => {
		const id = await newTask("删后查不到");
		await asA().taskClose.taskRemove({ id });
		await assertRejects(() => asA().taskClose.taskGet({ id }), "任务不存在");
	});

	it("评论:附件 id 必须真实存在(未知的要拒)—— attachmentUrl 守卫的收口", async () => {
		const id = await newTask("附件守卫");
		await assertRejects(
			() => asC().taskClose.commentCreate({ taskId: id, content: "带假附件", attachments: [FAKE_ATTACH_ID] }),
			"1 个附件不存在",
		);
		// 没写下行的评论也不该落库(事务回滚)
		const rows = await asA().taskClose.commentList({ taskId: id });
		assert.equal(rows.length, 0, "先拒后回滚,不残半条评论");
	});

	it("评论:全员可发,附件回填,作者本人可删", async () => {
		const id = await newTask("评论");
		const { id: commentId } = await asC().taskClose.commentCreate({
			taskId: id,
			content: "  路过看一眼  ",
			attachments: [ATTACH_FILE_ID],
		});
		const rows = await asA().taskClose.commentList({ taskId: id });
		const mine = rows.find((row) => row.id === commentId);
		assert.ok(mine);
		assert.equal(mine.content, "路过看一眼", "内容要去首尾空格");
		assert.equal(mine.authorName, C.name, "回填作者姓名");
		// 附件回填:真实存在的 sys_file 行 → 数组里有一条(未知 id 在写入侧就拒了)
		assert.equal(mine.attachments?.length, 1, "附件回填 1 条真实夹具");

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
		await asB().taskClose.actionReply({ id: consultId, content: "意见:先补台账", attachments: [ATTACH_FILE_ID] });
		const detail = await asA().taskClose.taskGet({ id });
		assert.equal(detail.task.status, "open", "回复征询不推任务状态");
		assert.equal(detail.actions.find((row) => row.id === consultId)?.status, "done", "回复即算处理完");

		const comments = await asA().taskClose.commentList({ taskId: id });
		assert.ok(
			comments.some((comment) => comment.content === "意见:先补台账"),
			"意见要在评论区可见",
		);
		// 附件 id 现在写入侧就验存在 → 回填 1 条真实夹具(与 commentCreate 同口径)
		assert.equal(comments.find((comment) => comment.content === "意见:先补台账")?.attachments?.length, 1);

		// 动态:action.reply 一行,摘要取意见正文,展示名是征询发起人
		const replyLog = (await asA().taskClose.logList({ taskId: id })).items.find((row) => row.event === "action.reply");
		assert.ok(replyLog, "回复征询要留痕");
		assert.match(replyLog.excerpt ?? "", /先补台账/);
		assert.equal(replyLog.targetName, A.name, "展示名是被回复的征询发起人");

		// 同一条征询不能回复两次
		await assertRejects(() => asB().taskClose.actionReply({ id: consultId, content: "再补一句" }), "已经回复过了");
	});

	it("管理员只能沿模板的直接转移边操作", async () => {
		const id = await newTask("管理员改状态");
		// 丙临时持「系统管理员」角色 —— `isAdminUser` 查的就是 casbin 这张图。
		// 用丙(既不是创建者、也不是这条任务的成员),才验得到「管理员」这条路本身。
		await addUserRole(C.id, (await getSystemAdminRoleRow()).id);
		try {
			// 乙(执行者):open 没有到 archived 的 direct 边、也不是创建者 → 拒
			await assertRejects(() => asB().taskClose.taskTransit({ id, to: "archived" }), "直接转移");
			await assertRejects(() => asC().taskClose.taskTransit({ id, to: "archived" }), "直接转移");
			const approval = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: B.id });
			await asB().taskClose.actionRespond({ id: approval.id, approved: true });
			await asC().taskClose.taskTransit({ id, to: "closed" });
			assert.equal((await asC().taskClose.taskGet({ id })).task.status, "closed");
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
		// 乙发起审批 → 锁定状态转移
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
		assert.equal((await asA().taskClose.taskGet({ id })).task.status, "open", "根级审批先锁上");
		await assertRejects(
			() => asC().taskClose.actionCreate({ taskId: id, parentActionId: rootId, handleId: C.id }),
			"当前处理人",
		);

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

		// 甲答复追问:只把子动作点亮,父审批的状态锁仍然存在
		await asA().taskClose.actionRespond({ id: childId, approved: true });
		const after = await asA().taskClose.taskGet({ id });
		assert.equal(after.task.status, "open", "子动作答复不解锁");
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
			.select({ title: sysNotification.title, read_at: sysNotificationDelivery.read_at })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(and(eq(sysNotificationDelivery.recipient_id, C.id), like(sysNotification.content, "%征询%")));
		assert.ok(consultNotice.length > 0, "被征询的人也要收到通知(body 写明「征询了你」)");

		// ① 乙发起审批,指给**创建者**甲 —— 甲有一条未读的「轮到你了」通知,红点 +1;
		// **读掉它红点就消**(动作本身的待办不进徽标,「我的任务」页自己看得见)
		const { id: assignedId } = await asB().taskClose.actionCreate({ taskId: id, toStatus: "done", handleId: A.id });
		const assignRows = await db
			.select({ title: sysNotification.title, read_at: sysNotificationDelivery.read_at })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(
				and(
					eq(sysNotificationDelivery.recipient_id, A.id),
					eq(sysNotification.source_type, "task_action"),
					eq(sysNotification.source_id, assignedId),
				),
			);
		assert.ok(
			assignRows.some((row) => row.title.includes("轮到你") && row.read_at === null),
			"被审批的人要有未读的「轮到你了」通知",
		);
		assert.equal(await badgeOf(), before + 1, "新任务通知未读时点亮红点");

		// ② @提及:丙(参与者)评论里 @ 甲 → 甲再 +1;@陪路人 → 没有
		const beforeComment = await badgeOf();
		await asC().taskClose.commentCreate({ taskId: id, content: `@${A.name} 请看附件`, mentionIds: [A.id, A.id] });
		assert.equal(await badgeOf(), beforeComment + 1, "被 @ 的参与人要有通知");
		const mentionRows = await db
			.select({ title: sysNotification.title })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(and(eq(sysNotificationDelivery.recipient_id, A.id), like(sysNotification.title, "%@ 你%")));
		assert.ok(
			mentionRows.some((row) => row.title.includes(C.name)),
			"提及通知的标题里带**作者**(丙)",
		);
		await asB().taskClose.commentCreate({ taskId: id, content: "@某人不存在 看看" });
		assert.equal(await badgeOf(), beforeComment + 1, "提到不在参与名单里的名字不会产生任何通知");

		// ③ **把这一趟的两条读完 → 红点归零**(读了通知就消)
		const unreadTasks = await db
			.select({ id: sysNotificationDelivery.id })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(
				and(
					eq(sysNotificationDelivery.recipient_id, A.id),
					or(eq(sysNotification.source_id, id), eq(sysNotification.source_id, assignedId)),
					isNull(sysNotificationDelivery.read_at),
				),
			);
		for (const row of unreadTasks) await asA().notice.read({ id: row.id });
		assert.equal(await badgeOf(), before, "读了通知,红点取消");
	});

	it("未查看提醒按轮次去重，已查看或已完成的动作不再提醒", async () => {
		const taskId = await newTask("未查看提醒");
		const { id: actionId } = await asA().taskClose.actionCreate({ taskId, handleId: B.id });
		const now = new Date();
		await db
			.update(taskCloseAction)
			.set({ activated_at: new Date(now.getTime() - 181 * 60_000) })
			.where(eq(taskCloseAction.id, actionId));
		const results = await Promise.all(Array.from({ length: 4 }, () => checkActionReminder(actionId, now)));
		assert.equal(
			results.reduce((sum, count) => sum + count, 0),
			2,
		);
		const rows = await db
			.select()
			.from(sysNotification)
			.where(and(eq(sysNotification.source_id, actionId), eq(sysNotification.type, "action.unviewed")));
		assert.equal(rows.length, 2);
		await db.update(taskCloseAction).set({ viewed_at: now }).where(eq(taskCloseAction.id, actionId));
		assert.equal(await checkActionReminder(actionId, now), 0);
		await db.update(taskCloseAction).set({ viewed_at: null, status: "done" }).where(eq(taskCloseAction.id, actionId));
		assert.equal(await checkActionReminder(actionId, now), 0);
	});

	it("未查看提醒按 60 / 180 分钟两档独立触发", async () => {
		const taskId = await newTask("提醒边界");
		const { id: actionId } = await asA().taskClose.actionCreate({ taskId, handleId: B.id });
		const now = new Date();
		const setAged = (minutes: number) =>
			db
				.update(taskCloseAction)
				.set({ activated_at: new Date(now.getTime() - minutes * 60_000) })
				.where(eq(taskCloseAction.id, actionId));
		// `tc_action.activated_at` 是秒精度 `datetime`,写入时毫秒会四舍五入到秒 ——
		// 所以"刚好 60 分"可能进位成 60 分零几百毫秒而落到阈值之外。用例取 59 / 61 分钟验档位,
		// 边界本身由列精度决定,不在这里假装它精确到毫秒。
		const count = async () =>
			(
				await db
					.select()
					.from(sysNotification)
					.where(and(eq(sysNotification.source_id, actionId), eq(sysNotification.type, "action.unviewed")))
			).length;

		await setAged(59);
		assert.equal(await checkActionReminder(actionId, now), 0, "不到 60 分钟不该发");
		await setAged(61);
		assert.equal(await checkActionReminder(actionId, now), 1, "过 60 分钟发第一档");
		assert.equal(await checkActionReminder(actionId, now), 0, "同一档不重复发");
		await setAged(179);
		assert.equal(await checkActionReminder(actionId, now), 0, "不到 180 分钟不发第二档");
		await setAged(181);
		assert.equal(await checkActionReminder(actionId, now), 1, "过 180 分钟发第二档");
		assert.equal(await count(), 2);
	});

	it("读取站内通知不等于查看动作，仅处理人打开动作记录首次查看时间", async () => {
		const taskId = await newTask("查看动作");
		const { id: actionId } = await asA().taskClose.actionCreate({ taskId, handleId: B.id });
		const [delivery] = await db
			.select({ id: sysNotificationDelivery.id })
			.from(sysNotificationDelivery)
			.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
			.where(and(eq(sysNotification.source_id, actionId), eq(sysNotificationDelivery.recipient_id, B.id)))
			.limit(1);
		assert.ok(delivery);
		await asB().notice.read({ id: delivery.id });
		let [action] = await db.select().from(taskCloseAction).where(eq(taskCloseAction.id, actionId));
		assert.equal(action?.viewed_at, null);
		await assertRejects(() => asA().taskClose.actionView({ id: actionId }), "只有处理人");
		await asB().taskClose.actionView({ id: actionId });
		[action] = await db.select().from(taskCloseAction).where(eq(taskCloseAction.id, actionId));
		const first = action?.viewed_at?.getTime();
		assert.ok(first);
		await asB().taskClose.actionView({ id: actionId });
		[action] = await db.select().from(taskCloseAction).where(eq(taskCloseAction.id, actionId));
		assert.equal(action?.viewed_at?.getTime(), first);
	});

	it("提及按用户 ID 定位，同名成员不会误收，非法目标使评论回滚", async () => {
		const taskId = await newTask("结构化提及");
		await asA().taskClose.memberAdd({ taskId, userId: C.id, role: "participant" });
		await db.update(sysUser).set({ name: A.name }).where(eq(sysUser.id, B.id));
		try {
			await asC().taskClose.commentCreate({ taskId, content: `@${A.name} 请处理`, mentionIds: [A.id, A.id] });
			const deliveries = await db
				.select({ recipient: sysNotificationDelivery.recipient_id })
				.from(sysNotificationDelivery)
				.innerJoin(sysNotification, eq(sysNotification.id, sysNotificationDelivery.notification_id))
				.where(and(eq(sysNotification.source_id, taskId), eq(sysNotification.type, "comment.mentioned")));
			assert.deepEqual(
				deliveries.map((row) => row.recipient),
				[A.id],
			);
			const before = await asC().taskClose.commentList({ taskId });
			await assertRejects(
				() => asC().taskClose.commentCreate({ taskId, content: "非法提及", mentionIds: ["outside"] }),
				"只能提及任务成员",
			);
			assert.equal((await asC().taskClose.commentList({ taskId })).length, before.length);
		} finally {
			await db.update(sysUser).set({ name: B.name }).where(eq(sysUser.id, B.id));
		}
	});

	it("催办校验权限、联系方式与冷却，重复请求不重复投递", async () => {
		const taskId = await newTask("催办");
		const { id: actionId } = await asA().taskClose.actionCreate({ taskId, handleId: B.id });
		await assertRejects(
			() => asC().taskClose.actionUrge({ id: actionId, requestId: "denied", channels: ["email"] }),
			"只有任务创建人",
		);
		await assertRejects(
			() => asA().taskClose.actionUrge({ id: actionId, requestId: "no-phone", channels: ["sms"] }),
			"联系电话",
		);
		await db
			.update(sysUser)
			.set({ phone: "+8613800000000", email: `test-b-${suffix}@example.com` })
			.where(eq(sysUser.id, B.id));
		assert.equal((await asC().user.list()).find((user) => user.id === B.id)?.phone, null);
		assert.equal((await caller.user.list()).find((user) => user.id === B.id)?.phone, "+8613800000000");
		const input = { id: actionId, requestId: `urge-${suffix}`, channels: ["email", "sms"] as ("email" | "sms")[] };
		const [first, second] = await Promise.all([asA().taskClose.actionUrge(input), asA().taskClose.actionUrge(input)]);
		assert.equal(first.id, second.id);
		assert.notEqual(first.reused, second.reused);
		const deliveries = await db
			.select()
			.from(sysNotificationDelivery)
			.where(eq(sysNotificationDelivery.notification_id, first.id));
		assert.deepEqual(deliveries.map((item) => item.channel).sort(), ["email", "sms"]);
		assert.ok(deliveries.every((item) => item.status === "pending"));
		const history = await asA().taskClose.actionUrgeHistory({ id: actionId });
		assert.equal(history.length, 2);
		assert.ok(history.every((item) => item.status === "pending"));
		await assertRejects(() => asC().taskClose.actionUrgeHistory({ id: actionId }), "没有权限查看催办记录");
		await assertRejects(() => asA().taskClose.actionUrge({ ...input, requestId: "another" }), "冷却");
		await db
			.update(taskCloseAction)
			.set({ status: "done", last_urged_at: null })
			.where(eq(taskCloseAction.id, actionId));
		await assertRejects(() => asA().taskClose.actionUrge({ ...input, requestId: "completed" }), "已结束");
	});

	it("催办:无效邮箱被拒,sms 与 email 各自落到对应 target", async () => {
		const taskId = await newTask("催办渠道");
		const { id: actionId } = await asA().taskClose.actionCreate({ taskId, handleId: B.id });
		await db.update(sysUser).set({ phone: "+8613800000001", email: "not-an-email" }).where(eq(sysUser.id, B.id));
		try {
			await assertRejects(
				() => asA().taskClose.actionUrge({ id: actionId, requestId: `bad-mail-${suffix}`, channels: ["email"] }),
				"有效的邮箱",
			);
			const smsOnly = await asA().taskClose.actionUrge({
				id: actionId,
				requestId: `sms-only-${suffix}`,
				channels: ["sms"],
			});
			const smsDeliveries = await db
				.select()
				.from(sysNotificationDelivery)
				.where(eq(sysNotificationDelivery.notification_id, smsOnly.id));
			assert.equal(smsDeliveries.length, 1);
			assert.equal(smsDeliveries[0].channel, "sms");
			assert.equal(smsDeliveries[0].target, "+8613800000001", "短信必须投到电话,不是邮箱");
		} finally {
			await db
				.update(sysUser)
				.set({ phone: "+8613800000000", email: `test-b-${suffix}@example.com` })
				.where(eq(sysUser.id, B.id));
		}
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
type Who = "creator" | "participant" | "executor";
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

/**
 * 四个只读接口的回归:`reportTemplateList` / `taskList` / `attachmentUrl` / `contentHistory`。
 *
 * 都是**查询**,但各有自己的收口逻辑 —— `taskList` 的 `mine` 并集、`attachmentUrl` 的三条归属链、
 * `contentHistory` 的参与者判据、`reportTemplateList` 的版本归并。这些在别的用例里只被间接碰过。
 */
describe("任务闭环 · 只读接口", () => {
	it("删除模板保留已有填报，但阻止再次绑定和分发", async () => {
		const payload = {
			id: "delete_template",
			kind: "TABLE" as const,
			fields: [{ id: "town", label: "街镇", type: "text" as const }],
		};
		const template = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: `${TEST_PREFIX}删除模板-${suffix}`,
			payload,
		});
		createdReportTemplateIds.push(template.id);
		const task = await asA().taskClose.taskCreate({
			name: taskName("删除模板后保留填报"),
			workflowId,
			report: { reportId: template.id },
			members: [{ userId: B.id, role: "executor" }],
		});
		await asA().taskClose.reportSaveDraft({ taskId: task.id, revision: 0, draft: [{ town: "甲镇" }] });
		await assertRejects(() => asA().taskClose.reportTemplateRemove({ id: template.id }), "没有权限");
		const otherWithPermission = callerAs({ ...C, isSuper: true });
		await assertRejects(
			() => otherWithPermission.taskClose.reportTemplateRemove({ id: template.id }),
			"只有模板创建人或管理员",
		);
		await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateRemove({ id: template.id });
		assert.ok(
			!(await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateList()).some((item) => item.id === template.id),
		);
		const saved = await asB().taskClose.reportGet({ taskId: task.id });
		assert.deepEqual(saved?.report.draft, [{ town: "甲镇" }]);
		assert.equal(saved?.template.id, template.id);
		await asB().taskClose.reportSaveDraft({ taskId: task.id, revision: 1, draft: [{ town: "乙镇" }] });
		await assertRejects(
			() => asA().taskClose.taskCreate({ name: taskName("不应创建"), workflowId, report: { reportId: template.id } }),
			"填报模板已删除",
		);
		const unbound = await asA().taskClose.taskCreate({ name: taskName("不可绑定"), workflowId });
		await assertRejects(
			() => asA().taskClose.reportBind({ taskId: unbound.id, reportId: template.id }),
			"填报模板已删除",
		);
		await assertRejects(
			() => callerAs({ ...A, isSuper: true }).taskClose.reportTemplateRemove({ id: template.id }),
			"模板不存在",
		);
	});
	it("reportTemplateList:版本按倒序挂在模板下,别家建的也看得到", async () => {
		const payload = {
			id: "list_template",
			kind: "OBJECT" as const,
			fields: [{ id: "name", label: "名称", type: "text" as const }],
		};
		const template = await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateCreate({
			name: `${TEST_PREFIX}列表模板-${suffix}`,
			payload,
			shared: true,
		});
		createdReportTemplateIds.push(template.id);
		await callerAs({ ...A, isSuper: true }).taskClose.reportTemplatePublish({
			id: template.id,
			name: `${TEST_PREFIX}更新模板-${suffix}`,
			payload: { ...payload, fields: [{ id: "changed", label: "改过", type: "text" as const }] },
		});

		await assertRejects(() => asC().taskClose.reportTemplatePublish({ id: template.id, payload }), "没有权限");

		// 丙拿到「填报模板」的页面授权(casbin p 行挂菜单,装载时展开出 page:*:view)—— 但不是创建人
		const [reportMenu] = await db
			.select({ id: sysMenu.id })
			.from(sysMenu)
			.where(eq(sysMenu.path, "/task-close/report-templates"))
			.limit(1);
		assert.ok(reportMenu, "要先跑 `pnpm db:seed:menus` 才有「填报模板」菜单");
		const casbinRowId = testId("cb", "rp", suffix);
		createdCasbinRowIds.push(casbinRowId);
		await db
			.insert(sysCasbinRule)
			.values({ id: casbinRowId, ptype: "p", v0: `user:${C.id}`, v1: `menu:${reportMenu.id}`, v2: "access" });
		clearCasbinCache();

		const list = await asC().taskClose.reportTemplateList();
		const mine = list.find((row) => row.id === template.id);
		assert.ok(mine, "有页面权限的人都能看到模板(列表全局只读)");
		assert.equal(mine.name, `${TEST_PREFIX}更新模板-${suffix}`);
		assert.equal(mine.canManage, false, "丙不是创建人也不是管理员");
		assert.equal(
			(await callerAs({ ...A, isSuper: true }).taskClose.reportTemplateList()).find((row) => row.id === template.id)
				?.canManage,
			true,
		);
		assert.equal(
			(mine.payload as { fields: Array<{ id: string }> }).fields[0]?.id,
			"changed",
			"编辑保存后,payload 即最新发布的结构",
		);
	});

	it("taskList:mine 是「我创建 ∪ 我是成员」,keyword / status / 分页各自生效", async () => {
		const first = await newTask("列表");
		const second = await asA().taskClose.taskCreate({
			name: `${taskName("列表")}-第二`,
			workflowId,
			members: [{ userId: B.id, role: "participant" }],
		});
		const third = await asA().taskClose.taskCreate({ name: `${taskName("列表")}-第三`, workflowId });

		// keyword 用带后缀的片段,只命中本用例的三条
		const keyword = `列表-${suffix}`;
		const all = await asC().taskClose.taskList({ keyword });
		assert.equal(all.total, 3, "不传 mine 时任何登录用户都能看到全部任务");
		assert.deepEqual(all.items.map((row) => row.id).sort(), [first, second.id, third.id].sort());
		assert.equal(all.items[0]?.creatorName, A.name, "brief 里带上创建人姓名");

		// 乙:第一条是执行人、第二条是参与者 → 两条都算 mine;第三条跟他无关
		const mineOfB = await asB().taskClose.taskList({ keyword, mine: true });
		assert.equal(mineOfB.total, 2, "mine 要把「成员」也算进去,不能只看 creator_id");
		assert.ok(!mineOfB.items.some((row) => row.id === third.id), "丙/乙都不是第三条的参与者");
		assert.equal((await asC().taskClose.taskList({ keyword, mine: true })).total, 0);

		// status:取第一条的真实状态来筛,它必然在结果里
		const status = (await asA().taskClose.taskGet({ id: first })).task.status;
		const byStatus = await asC().taskClose.taskList({ keyword, status });
		assert.ok(
			byStatus.items.every((row) => row.status === status),
			"status 过滤要真的生效",
		);

		// workflowId:按一个不存在的模板 id 筛必为空(三条任务都是 workflows[0] 的)
		const byWorkflow = await asC().taskClose.taskList({ keyword, workflowId: "wf-not-exist" });
		assert.equal(byWorkflow.items.length, 0, "按流程模板筛要真的生效");
		assert.equal(byWorkflow.stats.total, 0, "统计跟随筛选");

		// createdAfter + 统计:把第二条拨到 8 天前、再设一个已过的截止时间
		await db
			.update(taskCloseTask)
			.set({
				created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
				due_at: new Date(Date.now() - 3 * 60 * 60 * 1000),
			})
			.where(eq(taskCloseTask.id, second.id));
		const filtered = await asC().taskClose.taskList({ keyword });
		assert.equal(filtered.stats.total, 3, "统计与列表同一筛选口径:total 与 total 一致");
		assert.equal(filtered.stats.recentCreated, 2, "拨到 8 天前的那条掉出「近 7 天新建」");
		assert.equal(filtered.stats.overdue, 1, "截止时间已过 → 已到期");
		assert.equal(filtered.stats.dueSoon, 0, "没有设在未来截止的任务");
		const byTime = await asC().taskClose.taskList({
			keyword,
			createdAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
		});
		assert.ok(!byTime.items.some((row) => row.id === second.id), "时间筛选要真的生效");
		assert.equal(byTime.stats.total, 2, "统计跟随时间筛选");

		// createdBefore 与组合区间:结束时间拨到 7 天前只剩第二条;开始+结束一起夹也只剩它
		const beforeOnly = await asC().taskClose.taskList({
			keyword,
			createdBefore: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
		});
		assert.deepEqual(
			beforeOnly.items.map((row) => row.id),
			[second.id],
			"结束时间筛选要真的生效",
		);
		assert.equal(beforeOnly.stats.total, 1, "统计跟随结束时间筛选");
		const windowed = await asC().taskClose.taskList({
			keyword,
			createdAfter: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
			createdBefore: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
		});
		assert.deepEqual(
			windowed.items.map((row) => row.id),
			[second.id],
			"开始 + 结束 的组合区间要真的生效",
		);

		// 分页:pageSize 2 → 第一页两条 / total 仍是 3
		const paged = await asC().taskClose.taskList({ keyword, page: 1, pageSize: 2 });
		assert.equal(paged.items.length, 2);
		assert.equal(paged.total, 3, "total 是命中总数,不受 pageSize 影响");
	});

	it("attachmentUrl:三条归属链都认,未挂载的文件一律 NOT_FOUND", async () => {
		const id = await newTask("附件地址");
		await asA().taskClose.taskUpdate({
			id,
			name: taskName("附件地址"),
			payload: { links: [], attachments: [ATTACH_FILE_ID] },
		});
		await asC().taskClose.commentCreate({
			taskId: id,
			content: "评论带附件",
			attachments: [COMMENT_FILE_ID],
		});

		// 链路一:payload.attachments
		const fromPayload = await asB().taskClose.attachmentUrl({ taskId: id, fileId: ATTACH_FILE_ID });
		assert.ok(fromPayload.url.includes(ATTACH_FILE_ID) || fromPayload.url.length > 0, "要签出地址");
		assert.equal(fromPayload.originName, "attachment.txt");
		assert.equal(fromPayload.size, 8);

		// 链路二:评论附件
		const fromComment = await asB().taskClose.attachmentUrl({ taskId: id, fileId: COMMENT_FILE_ID });
		assert.ok(fromComment.url.length > 0, "评论里的附件同样能取地址");

		// 真实存在、但没挂在这条任务上 → 不签
		await assertRejects(() => asB().taskClose.attachmentUrl({ taskId: id, fileId: FOREIGN_FILE_ID }), "附件不存在");
		// 压根不存在的 id 同样
		await assertRejects(() => asB().taskClose.attachmentUrl({ taskId: id, fileId: FAKE_ATTACH_ID }), "附件不存在");

		// download=true 走预签名,且带原始文件名
		const download = await asB().taskClose.attachmentUrl({ taskId: id, fileId: ATTACH_FILE_ID, download: true });
		assert.ok(decodeURIComponent(download.url).includes("attachment.txt"), "下载地址要带上原始文件名");
	});

	it("attachmentUrl:挂上去之后文件被删(status≠1)就不再签地址", async () => {
		const id = await newTask("附件已删");
		await asA().taskClose.taskUpdate({
			id,
			name: taskName("附件已删"),
			payload: { links: [], attachments: [DELETED_FILE_ID] },
		});
		await db.update(sysFile).set({ status: 2 }).where(eq(sysFile.id, DELETED_FILE_ID));
		// 归属链仍然成立(payload 里还在),但状态挡住了
		await assertRejects(() => asA().taskClose.attachmentUrl({ taskId: id, fileId: DELETED_FILE_ID }), "还没上传完成");
	});

	it("说明修订不再对外提供,但修订快照仍写入(旧附件归属靠它)", async () => {
		const { id } = await asA().taskClose.taskCreate({
			name: taskName("说明修订"),
			workflowId,
			description: "初版说明",
			payload: {
				links: [{ kind: "link", url: "https://example.com/v1" }],
				attachments: [ATTACH_FILE_ID],
			},
			members: [{ userId: B.id, role: "participant" }],
		});
		await asA().taskClose.taskUpdate({
			id,
			name: taskName("说明修订"),
			description: "第二版说明",
			payload: { links: [{ kind: "link", url: "https://example.com/v2" }] },
		});

		// 界面入口已取消,但快照照写:旧修订里的附件仍算"被任务引用"(attachmentUrl 的归属链要用)
		const revisions = await db
			.select()
			.from(taskCloseContentRevision)
			.where(eq(taskCloseContentRevision.task_id, id))
			.orderBy(desc(taskCloseContentRevision.revision));
		assert.deepEqual(
			revisions.map((row) => row.revision),
			[2, 1],
			"创建 = revision 1,改动追加一版",
		);
		assert.equal(revisions[0]?.description, "第二版说明");
		assert.equal(revisions[0]?.actor_id, A.id);
		assert.ok(JSON.stringify(revisions[0]?.payload).includes("https://example.com/v2"));
		assert.equal(revisions[1]?.description, "初版说明");
		assert.ok(JSON.stringify(revisions[1]?.payload).includes(ATTACH_FILE_ID), "初版仍记着当时挂的附件");
	});
});
