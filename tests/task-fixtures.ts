/**
 * 任务模块测试的公共夹具。
 *
 * 为什么单独一份:造用户 / 造填报模板 / 建父子任务 / 收尾清理 这几件事在好几个测试文件里都要用,
 * 各抄一遍迟早抄歪。**这份只管「怎么造」,不管「测什么」** —— 断言留在各测试文件里。
 *
 * 纪律(同 `tests/helpers.ts`):
 *  1. 夹具数据一律 `TEST_PREFIX` 打头,`cleanup()` 物理清干净(不留孤儿行);
 *  2. 每个测试文件**自己**建夹具、自己收 —— 不依赖执行顺序,也不共用别人的数据。
 *
 * ⚠️ 夹具里的用户**不带 `isSuper`** —— 走的是真判定路径(casbin + `who` 协议),
 * 所以「谁能不能看 / 能不能改」这类断言才有意义;要测管理员口径另说。
 */
import assert from "node:assert/strict";
import { and, eq, inArray, or } from "drizzle-orm";
import {
	sysCasbinRule,
	sysMenu,
	sysNotification,
	sysNotificationAttempt,
	sysNotificationDelivery,
	sysUser,
	taskActionTable,
	taskCommentTable,
	taskLogTable,
	taskMemberTable,
	taskReminderTable,
	taskReportSubmissionTable,
	taskReportTable,
	taskReportTemplateTable,
	taskTable,
	taskWorkflowTable,
} from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { clearCasbinCache } from "../src/lib/casbin.ts";
import type { TaskReportSchema } from "../src/lib/task/report-spec.ts";
import { purgeTestAuditRows, TEST_PREFIX, testId, uniqueSuffix } from "./helpers.ts";

export type FixtureUser = { id: string; name: string };

/** 表格模板:一行一人,带街镇(用来做数据范围) */
export const TABLE_SCHEMA: TaskReportSchema = {
	id: "fx_table",
	kind: "TABLE",
	fields: [
		{ id: "town", label: "街镇", type: "text", readOnly: false, required: false, allowEmpty: false },
		{ id: "value", label: "数值", type: "integer", readOnly: false, required: false, allowEmpty: false },
	],
	rules: [],
};

/** 表单模板:几个标量字段 + 一个数组字段(数组元素含附件与选择) */
export const FORM_SCHEMA: TaskReportSchema = {
	id: "fx_form",
	kind: "OBJECT",
	fields: [
		{ id: "company", label: "企业名称", type: "text", readOnly: false, required: false, allowEmpty: false },
		{ id: "owner", label: "负责人", type: "text", readOnly: false, required: false, allowEmpty: false },
		{
			id: "items",
			label: "检查事项",
			type: "array",
			readOnly: false,
			required: false,
			allowEmpty: false,
			itemFields: [
				{ id: "itemName", label: "事项名称", type: "text", readOnly: false, required: false },
				{
					id: "level",
					label: "隐患等级",
					type: "select",
					readOnly: false,
					required: false,
					options: ["高", "中", "低"],
				},
				{ id: "photo", label: "照片", type: "attachment", readOnly: false, required: false },
			],
		},
	],
	rules: [],
};

export interface TaskFixture {
	suffix: string;
	/** 甲(创建人)、乙(执行人)、丙(参与者) */
	a: FixtureUser;
	b: FixtureUser;
	c: FixtureUser;
	/** 默认流程模板 id(库里 seed 出来的那套) */
	workflowId: string;
	/** 造一条填报模板并登记待清理 */
	newTemplate(payload: TaskReportSchema, options?: { name?: string; shared?: boolean }): Promise<string>;
	/**
	 * 给某个测试用户授一条**菜单权限**(casbin `p` 行)—— 收尾时清掉并清缓存。
	 *
	 * 任务模块里只有「填报模板」那几个接口走权限点(`lib/rbac.ts` 的 `PERM_BY_PATH`),
	 * 其余都是「只要求登录」(行级授权写在 resolver 里)。要测 resolver 自己的
	 * 「只有创建人或管理员」这条,前提是**先过了权限点** —— 所以得先授。
	 */
	grant(userId: string, menu: { path: string } | { perm: string }): Promise<void>;
	/** 收尾:清任务、清模板、清用户、清审计 */
	cleanup(): Promise<void>;
}

/**
 * 建一套夹具 —— 用户 + 流程模板 id。
 *
 * 用法:`const fx = await createTaskFixture(); try { ... } finally { await fx.cleanup(); }`
 */
export async function createTaskFixture(): Promise<TaskFixture> {
	const suffix = uniqueSuffix();
	const a: FixtureUser = { id: testId("u", "甲", suffix, 36), name: `${TEST_PREFIX}甲${suffix}` };
	const b: FixtureUser = { id: testId("u", "乙", suffix, 36), name: `${TEST_PREFIX}乙${suffix}` };
	const c: FixtureUser = { id: testId("u", "丙", suffix, 36), name: `${TEST_PREFIX}丙${suffix}` };
	await db.insert(sysUser).values([
		{ id: a.id, name: a.name, email: `${a.id}@test.local` },
		{ id: b.id, name: b.name, email: `${b.id}@test.local` },
		{ id: c.id, name: c.name, email: `${c.id}@test.local` },
	]);
	const [workflow] = await db.select({ id: taskWorkflowTable.id }).from(taskWorkflowTable).limit(1);
	const workflowId = workflow?.id ?? "";
	if (!workflowId) throw new Error("库里没有流程模板 —— 先跑 `pnpm db:seed:task-close`");
	const templateIds: string[] = [];
	const casbinRowIds: string[] = [];
	return {
		suffix,
		a,
		b,
		c,
		workflowId,
		async newTemplate(payload, options) {
			const id = `rpt-${suffix}-${templateIds.length + 1}`;
			templateIds.push(id);
			await db.insert(taskReportTemplateTable).values({
				id,
				name: options?.name ?? `${TEST_PREFIX}夹具模板-${suffix}`,
				creator_id: a.id,
				payload,
				shared: options?.shared ? 1 : 0,
			});
			return id;
		},
		async grant(userId, menu) {
			const [row] = await db
				.select({ id: sysMenu.id })
				.from(sysMenu)
				.where("perm" in menu ? eq(sysMenu.perm, menu.perm) : eq(sysMenu.path, menu.path))
				.limit(1);
			assert.ok(row?.id, `菜单不存在(perm=${"perm" in menu ? menu.perm : menu.path})`);
			const ruleId = testId("cb", "grant", uniqueSuffix());
			casbinRowIds.push(ruleId);
			await db.insert(sysCasbinRule).values({
				id: ruleId,
				ptype: "p",
				v0: `user:${userId}`,
				v1: `menu:${row.id}`,
				v2: "access",
			});
			clearCasbinCache();
		},
		async cleanup() {
			if (casbinRowIds.length) {
				await db.delete(sysCasbinRule).where(inArray(sysCasbinRule.id, casbinRowIds));
				clearCasbinCache();
			}
			await purgeTestAuditRows([a.id, b.id, c.id]);
			const ids = (
				await db
					.select({ id: taskTable.id })
					.from(taskTable)
					.where(inArray(taskTable.creator_id, [a.id, b.id, c.id]))
			).map((row) => row.id);
			if (ids.length > 0) {
				const actions = await db
					.select({ id: taskActionTable.id })
					.from(taskActionTable)
					.where(inArray(taskActionTable.task_id, ids));
				const reminders = await db
					.select({ id: taskReminderTable.id })
					.from(taskReminderTable)
					.where(inArray(taskReminderTable.task_id, ids));
				const notifications = await db
					.select({ id: sysNotification.id })
					.from(sysNotification)
					.where(
						or(
							and(eq(sysNotification.source_type, "task"), inArray(sysNotification.source_id, ids)),
							and(eq(sysNotification.source_type, "task_reminder"), inArray(sysNotification.source_id, ids)),
							and(
								eq(sysNotification.source_type, "task_scheduled_reminder"),
								inArray(
									sysNotification.source_id,
									reminders.map((r) => r.id),
								),
							),
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
					await db
						.delete(sysNotificationDelivery)
						.where(inArray(sysNotificationDelivery.notification_id, notificationIds));
					await db.delete(sysNotification).where(inArray(sysNotification.id, notificationIds));
				}
				await db.delete(taskReminderTable).where(inArray(taskReminderTable.task_id, ids));
				await db.delete(taskActionTable).where(inArray(taskActionTable.task_id, ids));
				await db.delete(taskMemberTable).where(inArray(taskMemberTable.task_id, ids));
				await db.delete(taskCommentTable).where(inArray(taskCommentTable.task_id, ids));
				await db.delete(taskLogTable).where(inArray(taskLogTable.task_id, ids));
				const reportIds = (
					await db.select({ id: taskReportTable.id }).from(taskReportTable).where(inArray(taskReportTable.task_id, ids))
				).map((row) => row.id);
				if (reportIds.length)
					await db.delete(taskReportSubmissionTable).where(inArray(taskReportSubmissionTable.report_id, reportIds));
				await db.delete(taskReportTable).where(inArray(taskReportTable.task_id, ids));
				await db.delete(taskTable).where(inArray(taskTable.id, ids));
			}
			if (templateIds.length)
				await db.delete(taskReportTemplateTable).where(inArray(taskReportTemplateTable.id, templateIds));
			await db.delete(sysUser).where(inArray(sysUser.id, [a.id, b.id, c.id]));
		},
	};
}
