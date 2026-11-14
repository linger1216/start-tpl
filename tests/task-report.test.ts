/**
 * 结构化填报(`taskClose.report*`)的端到端回归 —— 走**真实的库**,直调 procedure。
 *
 * 这个文件盯的是**填报这一侧的边界**:模板的可见性(谁能用谁能改)、绑定的口子、
 * 草稿的并发与校验、表单填报同步给父任务、Excel 的进出。
 *
 * 身份口径与其它任务测试一致(`callerAs`,HTTP 入口不可达):夹具里的用户**不带 `isSuper`**,
 * 走的是真判定路径 —— 「谁能不能看 / 能不能改」这类断言才有意义。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { sysFile, taskMemberTable, taskReportTemplateTable, taskTable } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { assertRejects, callerAs, closeDb } from "./helpers.ts";
import { createTaskFixture, FORM_SCHEMA, TABLE_SCHEMA, type TaskFixture } from "./task-fixtures.ts";

let fx: TaskFixture;
/** 附件夹具:status=1 的 sys_file 一行(2026-10 起附件 id 必须真实存在) */
const FILE_ID = "file-report-fx";

before(async () => {
	fx = await createTaskFixture();
	await db.insert(sysFile).values({
		id: FILE_ID,
		bucket: "private",
		object_key: "fx/report.txt",
		origin_name: "现场照片.jpg",
		size: 8,
		status: 1,
	});
});

after(async () => {
	await fx.cleanup();
	await db.delete(sysFile).where(eq(sysFile.id, FILE_ID));
	await closeDb();
});

const asA = () => callerAs(fx.a);
const asB = () => callerAs(fx.b);
const asC = () => callerAs(fx.c);
const admin = () => callerAs({ ...fx.a, isSuper: true });

/** 建一条任务(甲创建),返回任务 id */
async function newTask(label: string, members: Array<{ userId: string; role: "executor" | "participant" }> = []) {
	const { id } = await asA().taskClose.taskCreate({
		name: `__test__填报-${label}-${fx.suffix}`,
		workflowId: fx.workflowId,
		members,
	});
	return id;
}

/**
 * 父任务下、某个执行人的那条子任务 id。
 *
 * ⚠️ 列表接口不暴露 `parentId`,这里直接查库;而且 **fan-out 要 ≥2 个执行人才分派子任务**
 * (一个执行人时他就是那条任务本身的成员,不另起子任务) —— 建任务时记得给两个执行人。
 */
async function childOf(parentId: string, executorId: string): Promise<string> {
	const rows = await db
		.select({ id: taskTable.id })
		.from(taskTable)
		.innerJoin(taskMemberTable, eq(taskMemberTable.task_id, taskTable.id))
		.where(
			and(
				eq(taskTable.parent_id, parentId),
				eq(taskMemberTable.role, "executor"),
				eq(taskMemberTable.user_id, executorId),
			),
		);
	assert.ok(rows[0]?.id, "多执行人 ⇒ 分派出了子任务");
	return rows[0].id;
}

describe("填报模板:可见性与发布/删除的权限", () => {
	it("非管理员只能用「别人共享的」模板;没共享的拿不到", async () => {
		const shared = await fx.newTemplate(TABLE_SCHEMA, { name: "共享模板", shared: true });
		const priv = await fx.newTemplate(TABLE_SCHEMA, { name: "私有模板" });

		// 乙不是创建人也不是管理员:共享的能用
		const file = await asB().taskClose.reportExcelDownload({ reportId: shared });
		assert.ok(file.fileBase64.length > 0);
		// 没共享的:直接被挡
		await assertRejects(() => asB().taskClose.reportExcelDownload({ reportId: priv }), "无权使用该填报模板");
		// 模板视角的导入也是同一套可见性
		const preview = await asB().taskClose.reportExcelPreview({ reportId: shared, fileBase64: file.fileBase64 });
		assert.deepEqual(preview.value, []);
		await assertRejects(
			() => asB().taskClose.reportExcelPreview({ reportId: priv, fileBase64: file.fileBase64 }),
			"无权使用该填报模板",
		);
	});

	it("发布 / 删除:只有创建人或管理员能动别人的模板", async () => {
		const templateId = await fx.newTemplate(TABLE_SCHEMA);
		// 乙拿到「发布 / 删除填报模板」两个权限点(否则中间件先挡,测不到 resolver 里那条)
		await fx.grant(fx.b.id, { perm: "sys:tc_report_template:edit" });
		await fx.grant(fx.b.id, { perm: "sys:tc_report_template:remove" });
		// 乙(非创建人、非管理员)改不动
		await assertRejects(
			() =>
				asB().taskClose.reportTemplatePublish({
					id: templateId,
					payload: TABLE_SCHEMA,
				}),
			"只有模板创建人或管理员可以发布",
		);
		await assertRejects(
			() => asB().taskClose.reportTemplateRemove({ id: templateId }),
			"只有模板创建人或管理员可以删除",
		);
		// 管理员可以
		await admin().taskClose.reportTemplatePublish({
			id: templateId,
			name: "管理员改过的名字",
			payload: TABLE_SCHEMA,
			shared: true,
		});
		const listed = await asB().taskClose.reportTemplateList();
		assert.ok(
			listed.some((item) => item.id === templateId && item.name === "管理员改过的名字"),
			"管理员发布后,共享模板对所有人可见",
		);
		// 不存在的模板
		await assertRejects(() => asB().taskClose.reportTemplateRemove({ id: "no-such-template" }), "模板不存在");
	});

	it("列表只给该给的:共享的 + 自己建的,软删的不出现", async () => {
		await fx.grant(fx.b.id, { path: "/task-close" });
		const mine = await fx.newTemplate(TABLE_SCHEMA, { name: "甲的私有模板" });
		const shared = await fx.newTemplate(TABLE_SCHEMA, { name: "共享模板乙", shared: true });
		const gone = await fx.newTemplate(TABLE_SCHEMA, { name: "已删模板" });
		await db
			.update(taskReportTemplateTable)
			.set({ deleted_at: new Date() })
			.where(eq(taskReportTemplateTable.id, gone));

		const list = await asB().taskClose.reportTemplateList();
		const ids = list.map((item) => item.id);
		assert.ok(ids.includes(shared), "共享模板对所有人可见");
		assert.ok(!ids.includes(mine), "别人的私有模板不该出现");
		assert.ok(!ids.includes(gone), "软删的模板不该出现");
	});
});

describe("填报的绑定与读取", () => {
	it("没绑填报的任务可以后绑一次;绑了就不能再换", async () => {
		const taskId = await newTask("后绑定");
		const templateId = await fx.newTemplate(TABLE_SCHEMA);
		const bound = await asA().taskClose.reportBind({ taskId, reportId: templateId });
		assert.ok(bound.id);
		// 再绑一次 → 拒
		await assertRejects(
			() => asA().taskClose.reportBind({ taskId, reportId: templateId }),
			"填报模板在创建任务时确定，不能更换或移除",
		);
	});

	it("子任务不能单独绑;已分派的任务也不能再绑", async () => {
		const templateId = await fx.newTemplate(TABLE_SCHEMA);
		// 建父任务(带执行人 → 自动分派子任务)
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: `__test__填报-分派-${fx.suffix}`,
			workflowId: fx.workflowId,
			members: [
				{ userId: fx.b.id, role: "executor" },
				{ userId: fx.c.id, role: "executor" },
			],
		});
		const childId = await childOf(parentId, fx.b.id);
		await assertRejects(
			() => asA().taskClose.reportBind({ taskId: childId, reportId: templateId }),
			"子任务不能单独绑定填报模板",
		);
		// 父任务已分派 ⇒ 也不能再绑
		await assertRejects(
			() => asA().taskClose.reportBind({ taskId: parentId, reportId: templateId }),
			"已分派的任务不能再绑定填报模板",
		);
	});

	it("reportGet:附件要解出文件名;无关的人进不来", async () => {
		const templateId = await fx.newTemplate({
			id: "with_file",
			kind: "OBJECT",
			fields: [{ id: "photo", label: "照片", type: "attachment", required: false, allowEmpty: false, readOnly: false }],
			rules: [],
		});
		const { id: taskId } = await asA().taskClose.taskCreate({
			name: `__test__填报-附件-${fx.suffix}`,
			workflowId: fx.workflowId,
			report: { reportId: templateId },
		});
		await asA().taskClose.reportSaveDraft({ taskId, revision: 0, draft: { photo: [FILE_ID] } });
		const view = await asA().taskClose.reportGet({ taskId });
		assert.ok(view);
		assert.deepEqual(
			view.files.map((file) => file.name),
			["现场照片.jpg"],
			"附件按 id 解出原始文件名",
		);
		// 丙既不是创建人也不是成员 ⇒ 进不来
		await assertRejects(() => asC().taskClose.reportGet({ taskId }), "无权查看填报");
	});

	it("任务没有填报时 reportGet 返回 null(不是报错)", async () => {
		const taskId = await newTask("没填报");
		assert.equal(await asA().taskClose.reportGet({ taskId }), null);
	});
});

describe("填报草稿:谁能写、并发与校验", () => {
	async function taskWithReport() {
		const templateId = await fx.newTemplate({
			id: "draft_rules",
			kind: "TABLE",
			fields: [
				{ id: "town", label: "街镇", type: "text", required: false, allowEmpty: false, readOnly: false },
				{
					id: "fixed",
					label: "固定值",
					type: "text",
					required: false,
					allowEmpty: false,
					readOnly: true,
					defaultValue: "锁定",
				},
			],
			rules: [],
		});
		const { id } = await asA().taskClose.taskCreate({
			name: `__test__填报-草稿-${fx.suffix}`,
			workflowId: fx.workflowId,
			report: { reportId: templateId },
			members: [{ userId: fx.b.id, role: "executor" }],
		});
		return id;
	}

	it("执行人也能写(不只是创建人);无关的人不行", async () => {
		const taskId = await taskWithReport();
		// 乙是执行人 ⇒ 能写
		const saved = await asB().taskClose.reportSaveDraft({
			taskId,
			revision: 0,
			draft: [{ town: "甲镇", fixed: "锁定" }],
		});
		assert.equal(saved.revision, 1);
		// 丙无关 ⇒ 拒
		await assertRejects(
			() => asC().taskClose.reportSaveDraft({ taskId, revision: 1, draft: [{ town: "甲镇", fixed: "锁定" }] }),
			"只有任务创建人或当前执行人可以填写",
		);
	});

	it("revision 对不上就是冲突;只读字段不许改;草稿过大直接拒", async () => {
		const taskId = await taskWithReport();
		await assertRejects(
			() => asA().taskClose.reportSaveDraft({ taskId, revision: 99, draft: [{ town: "甲镇", fixed: "锁定" }] }),
			"填报已被修改，请刷新后重试",
		);
		// 只读字段被改
		await assertRejects(
			() => asA().taskClose.reportSaveDraft({ taskId, revision: 0, draft: [{ town: "甲镇", fixed: "改了" }] }),
			"只读字段不可修改",
		);
		// 体积上限(2MB)
		await assertRejects(
			() => asA().taskClose.reportSaveDraft({ taskId, revision: 0, draft: [{ town: "x".repeat(2_100_000) }] }),
			"填报数据过大",
		);
	});

	it("任务没有填报行 → 明确报 NOT_FOUND", async () => {
		const taskId = await newTask("没填报行");
		await assertRejects(
			() => asA().taskClose.reportSaveDraft({ taskId, revision: 0, draft: [{ town: "甲镇" }] }),
			"任务没有填报",
		);
	});
});

describe("表单填报同步给父任务", () => {
	async function parentAndChild() {
		const templateId = await fx.newTemplate(FORM_SCHEMA);
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: `__test__填报-表单父-${fx.suffix}`,
			workflowId: fx.workflowId,
			report: { reportId: templateId },
			members: [
				{ userId: fx.b.id, role: "executor" },
				{ userId: fx.c.id, role: "executor" },
			],
		});
		const childId = await childOf(parentId, fx.b.id);
		return { parentId, childId, templateId };
	}

	it("点「保存填报」⇒ 父任务看得到子任务那份(带执行人)", async () => {
		const { parentId, childId } = await parentAndChild();
		await asB().taskClose.reportSaveDraft({
			taskId: childId,
			revision: 0,
			draft: { company: "联通信", owner: "张三", items: [{ itemName: "管道排污", level: "中" }] },
		});
		// 没同步之前,父任务看不到
		let parent = await asA().taskClose.reportGet({ taskId: parentId });
		assert.equal(parent?.syncedChildren.length, 0, "没点保存 ⇒ 父任务看不到");

		const synced = await asB().taskClose.reportSyncToParent({ taskId: childId });
		assert.equal(synced.pushed, 1);
		parent = await asA().taskClose.reportGet({ taskId: parentId });
		assert.equal(parent?.syncedChildren.length, 1);
		assert.equal(parent?.syncedChildren[0].executorName, fx.b.name, "父任务看得到是谁填的");
		assert.equal((parent?.syncedChildren[0].payload as { company: string }).company, "联通信");
	});

	it("父任务导出:父子填报分两张表,子任务一行一个执行人", async () => {
		const { parentId, childId } = await parentAndChild();
		await asB().taskClose.reportSaveDraft({
			taskId: childId,
			revision: 0,
			draft: { company: "联通信", owner: "张三", items: [] },
		});
		await asB().taskClose.reportSyncToParent({ taskId: childId });
		const file = await asA().taskClose.reportExcelDownload({ taskId: parentId, templateOnly: false });
		const book = XLSX.read(file.fileBase64, { type: "base64" });
		assert.ok(book.SheetNames.includes("父任务填报"));
		assert.ok(book.SheetNames.includes("子任务填报"), "父任务导出要带上子任务那份");
		const childSheetName = "子任务填报";
		const childSheet = XLSX.utils.sheet_to_json(book.Sheets[childSheetName], { header: 1 }) as unknown[][];
		assert.equal(childSheet[0]?.[0], "执行人", "子任务表首列是执行人");
		assert.equal(childSheet[1]?.[0], fx.b.name);
		assert.ok(String(childSheet[1]?.[1]).includes("联通信"), "子任务表带上企业名称");
	});

	it("同步的权限与边界:父任务不能同步、无关人不能同步", async () => {
		const { parentId, childId } = await parentAndChild();
		await assertRejects(() => asA().taskClose.reportSyncToParent({ taskId: parentId }), "只有子任务可以同步");
		await assertRejects(
			() => asC().taskClose.reportSyncToParent({ taskId: childId }),
			"只有任务创建人或当前执行人可以同步",
		);
	});

	it("表单填报没填完不许同步", async () => {
		const templateId = await fx.newTemplate({
			id: "need_more",
			kind: "OBJECT",
			fields: [{ id: "company", label: "企业名称", type: "text", required: true, allowEmpty: false, readOnly: false }],
			rules: [],
		});
		const { id: parentId } = await asA().taskClose.taskCreate({
			name: `__test__填报-必填父-${fx.suffix}`,
			workflowId: fx.workflowId,
			report: { reportId: templateId },
			members: [
				{ userId: fx.b.id, role: "executor" },
				{ userId: fx.c.id, role: "executor" },
			],
		});
		const childId = await childOf(parentId, fx.c.id);
		await assertRejects(() => asC().taskClose.reportSyncToParent({ taskId: childId }), "此项必填");
	});
});

describe("Excel 的进出", () => {
	it("任务视角下载的是模板(空表),解析回来 0 行", async () => {
		const templateId = await fx.newTemplate(TABLE_SCHEMA);
		const { id: taskId } = await asA().taskClose.taskCreate({
			name: `__test__填报-模版-${fx.suffix}`,
			workflowId: fx.workflowId,
			report: { reportId: templateId },
		});
		const file = await asA().taskClose.reportExcelDownload({ taskId });
		const parsed = await asA().taskClose.reportExcelPreview({ taskId, fileBase64: file.fileBase64 });
		assert.deepEqual(parsed.value, []);
	});

	it("任务和模板只能二选一;坏文件给出可读的错误", async () => {
		const templateId = await fx.newTemplate(TABLE_SCHEMA);
		await assertRejects(
			() => asA().taskClose.reportExcelDownload({ reportId: templateId, taskId: "whatever" }),
			"必须且只能指定任务或填报模板",
		);
		await assertRejects(
			() => asA().taskClose.reportExcelPreview({ reportId: templateId, taskId: "whatever", fileBase64: "aGk=" }),
			"必须且只能指定任务或填报模板",
		);
		await assertRejects(
			() => asA().taskClose.reportExcelPreview({ reportId: templateId, fileBase64: "不是 Excel" }),
			"文件编码或大小无效",
		);
	});
});
