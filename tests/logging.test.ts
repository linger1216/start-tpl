import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { inArray, sql } from "drizzle-orm";

import { sysLog } from "../src/db/data-base-schema.ts";
import { db } from "../src/db/index.ts";
import { trpcRouter } from "../src/integrations/trpc/router.ts";
import { collectLogs, type LogLine, logger, sanitize } from "../src/lib/logger.ts";
import { anonymousCaller, caller, closeDb } from "./helpers.ts";

/**
 * **日志覆盖率**(「100% 日志覆盖率」的那条回归线)。
 *
 * 底座在 `src/integrations/trpc/init.ts`:所有 procedure 都由 `publicProcedure` / `protectedProcedure` 造出来,
 * 第一层中间件就是 `loggingMiddleware` ⇒ **每次后端调用至少两行**(debug 起 / info 成 / error 败),
 * 都带 `traceId` —— 一次调用里的内部日志(策略 / 存储 / 审计)靠它串成一条时间线。
 * 这里证明的是:**这条保证不靠每个 resolver 记得加,而且不允许有 procedure 漏在外面**。
 *
 * 为什么不做"同一性断言"(`proc._def.middlewares.includes(loggingMiddleware)`):
 * tRPC v11 的 `.use()` 存的是 standalone 包装函数,**不是**原函数(实测 `===` 恒 false),
 * 所以改成**行为断言** —— 每个 path 真调一次,它的两行必须出现在日志流里。
 */
// 65 → 77:新增数据权限两个 router(dataScope 7 个 + dataPlugin 5 个),全部走 protectedProcedure
// 77 → 78:新增 `user.profile`(个人资料页,protectedProcedure)
// 78 → 79:新增 `dict.import`(字典 Excel 导入,protectedProcedure)
// 79 → 80:新增 `para.import`(参数 Excel 导入,protectedProcedure)
// 80 → 81:新增 `role.import`(角色 Excel 导入,protectedProcedure)
// 81 → 82:新增 `user.import`(用户 Excel 导入,protectedProcedure)
// 82 → 98:新增任务闭环 `taskClose` 16 个(3 模板/任务 + 2 成员 + 4 动作 + 3 评论 …全部 protectedProcedure)
// 98 → 102:任务闭环新增流程模板管理 4 个(`workflowGet/Create/Update/Remove`,protectedProcedure)
// 102 → 103:任务闭环新增 `attachmentUrl`(任务附件取地址,protectedProcedure)
// 103 → 104:任务闭环新增 `logList`(活动日志读接口,protectedProcedure)
// 104 → 105:任务闭环新增 `taskTransfer`(转交执行人,protectedProcedure)
const EXPECTED_PROCEDURES = 105;

/**
 * 循环里会**故意**用无身份 caller 调每一个 procedure(在 `requireUser` 那层就被挡下,不会有副作用),
 * 但审计中间件排在它前面,而审计"只记 mutation"且不看身份 ⇒ 52 个 mutation 会真的往 `sys_log` 写 52 行失败记录。
 * 入参带上 `key: "page.*"` 让审计按 `log.skip_paths`(默认 `page.`)跳过 —— 这只是在省清理,
 * 下面仍然按 traceId 把可能写进去的行删掉并断言为 0。
 */
const AUDIT_SKIPPED_INPUT = { key: "page.日志覆盖率" };

/** `trpcRouter` 的内部结构里,每个 procedure 以**点分 path** 为键(如 `para.list`) */
function proceduresOf(): string[] {
	const router = trpcRouter as unknown as { _def?: { procedures?: Record<string, unknown> } };
	return Object.keys(router._def?.procedures ?? {}).sort();
}

/** 按点分 path 取到 caller 上的那个方法(`demoGrid.list` → `caller.demoGrid.list`) */
function byPath(root: unknown, path: string): (input?: unknown) => Promise<unknown> {
	const target = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root);
	return target as (input?: unknown) => Promise<unknown>;
}

/**
 * 测试脚本默认把日志全关(`LOG_SILENT=1`,而且 `node --test` 会把 `NODE_ENV` 置成 `test`,
 * `silent()` 两个条件都命中)⇒ 断言日志前必须临时打开,并在 `finally` 里原样还回去。
 */
async function withLogs<T>(level: "debug" | "info", fn: (lines: LogLine[]) => Promise<T>): Promise<T> {
	const saved = {
		LOG_SILENT: process.env.LOG_SILENT,
		NODE_ENV: process.env.NODE_ENV,
		LOG_LEVEL: process.env.LOG_LEVEL,
		LOG_SLOW_MS: process.env.LOG_SLOW_MS,
	};
	process.env.LOG_SILENT = "0";
	delete process.env.NODE_ENV;
	process.env.LOG_LEVEL = level;
	const { lines, restore } = collectLogs();
	try {
		return await fn(lines);
	} finally {
		restore();
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

const firstLine = (lines: LogLine[], event: string) => lines.find((line) => line.event === event);
const countOf = (lines: LogLine[], event: string) => lines.filter((line) => line.event === event).length;

/** 审计是 fire-and-forget ⇒ 删行可能撞上还在飞的 insert,重试到干净为止 */
async function purgeAuditRows(traceIds: string[]): Promise<number> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		await db.delete(sysLog).where(inArray(sysLog.trace_id, traceIds));
		const [row] = await db.select({ n: sql<number>`count(*)` }).from(sysLog).where(inArray(sysLog.trace_id, traceIds));
		const left = Number(row?.n ?? 0);
		if (left === 0) return 0;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return 1;
}

const traceIds: string[] = [];

after(async () => {
	if (traceIds.length > 0) await purgeAuditRows(traceIds);
	await closeDb();
});

describe("日志覆盖率", () => {
	it("每个 procedure 无身份调用都留下 `trpc.start` + `trpc.err`(同一 traceId)", async () => {
		const procedures = proceduresOf();
		assert.equal(
			procedures.length,
			EXPECTED_PROCEDURES,
			"procedure 数量变了 —— 新接口必须仍走 publicProcedure / protectedProcedure,然后改这个数字",
		);

		await withLogs("debug", async (lines) => {
			for (const path of procedures) {
				const from = lines.length;
				await assert.rejects(byPath(anonymousCaller, path)(AUDIT_SKIPPED_INPUT), (error: { code?: string }) => {
					assert.equal(error.code, "UNAUTHORIZED", `${path} 应该先被登录拦下(是不是没走 protectedProcedure?)`);
					return true;
				});

				const added = lines.slice(from).filter((line) => line.path === path);
				const start = added.find((line) => line.event === "trpc.start");
				const failure = added.find((line) => line.event === "trpc.err");
				assert.ok(start, `${path} 没有 trpc.start —— 日志中间件没挂上`);
				assert.ok(failure, `${path} 没有 trpc.err —— 失败没被记下来`);
				assert.equal(failure.traceId, start.traceId, `${path} 的 start / err 必须是同一个 traceId`);
				traceIds.push(String(start.traceId));
			}
		});

		assert.equal(await purgeAuditRows(traceIds), 0, "审计残留必须清干净(测试身份不该在 sys_log 里留行)");
	});

	it("成功的调用:`trpc.start`(debug)与 `trpc.ok`(info)同一 traceId,带 path / type / 耗时", async () => {
		await withLogs("debug", async (lines) => {
			await caller.para.list();

			const start = firstLine(lines, "trpc.start");
			const ok = firstLine(lines, "trpc.ok");
			assert.ok(start, "缺少 trpc.start");
			assert.ok(ok, "缺少 trpc.ok");
			assert.equal(ok.traceId, start.traceId, "成败两行要用同一个 traceId");
			assert.equal(ok.path, "para.list");
			assert.equal(ok.type, "query");
			assert.equal(typeof ok.ms, "number");
			assert.equal(start.level, "debug");
			assert.equal(ok.level, "info");
			assert.equal(countOf(lines, "trpc.err"), 0, "成功不该有 err");
			traceIds.push(String(start.traceId));
		});
	});

	it("`LOG_LEVEL=info` 时入口行(debug)被过滤,成功那行仍在 —— 级别开关真的生效", async () => {
		await withLogs("info", async (lines) => {
			await caller.para.list();
			assert.equal(countOf(lines, "trpc.start"), 0, "debug 级不该出现");
			assert.equal(countOf(lines, "trpc.ok"), 1);
		});
	});

	it("失败的调用把 traceId 挂到错误对象上(排查时能从报错直接搜日志)", async () => {
		await withLogs("debug", async (lines) => {
			const error = await anonymousCaller.para.list().then(
				() => null,
				(caught: Error & { traceId?: string }) => caught,
			);
			assert.ok(error, "无身份调用必须失败");
			const failure = firstLine(lines, "trpc.err");
			assert.ok(failure, "缺少 trpc.err");
			assert.equal(failure.code, "UNAUTHORIZED");
			assert.equal(error.traceId, failure.traceId, "错误对象上的 traceId 要能对上日志");
			traceIds.push(String(failure.traceId));
		});
	});

	it("慢调用记 warn:阈值每次调用现读(`LOG_SLOW_MS=0` 立刻生效)", async () => {
		await withLogs("debug", async (lines) => {
			process.env.LOG_SLOW_MS = "0";
			await caller.para.list();
			const slow = firstLine(lines, "trpc.slow");
			assert.ok(slow, "超过阈值没有记 warn");
			assert.equal(slow.level, "warn");
			assert.equal(slow.path, "para.list");
			assert.equal(slow.traceId, firstLine(lines, "trpc.start")?.traceId);
		});
	});

	it("入参只在 debug 记,并且落进日志前已经脱敏(凭据字段一律 `***`)", async () => {
		await withLogs("debug", async (lines) => {
			await caller.dict.byCode({ code: "logging_probe_missing", password: "Passw0rd123" } as { code: string });
			const start = firstLine(lines, "trpc.start");
			assert.ok(start, "缺少 trpc.start");
			const input = start.input as Record<string, unknown>;
			assert.equal(input.password, "***", "凭据字段必须脱敏");
			assert.equal(input.code, "logging_probe_missing", "普通字段原样保留");
		});
	});
});

describe("日志脱敏与截断(sanitize 是唯一闸门)", () => {
	it("`ts` / `level` / `event` 是保留名:字段里塞同名的键顶不掉日志自己的三个键", async () => {
		await withLogs("info", async (lines) => {
			logger.info("probe.reserved", { event: "伪造的事件名", level: "error", ts: "伪造的时间", keep: 1 });
			const line = firstLine(lines, "probe.reserved");
			assert.ok(line, "事件名被字段顶掉了(保留名必须最后盖)");
			assert.equal(line.level, "info");
			assert.notEqual(line.ts, "伪造的时间");
			assert.equal((line as Record<string, unknown>).keep, 1, "普通字段照常保留");
		});
	});

	it("凭据类字段名(大小写不敏感、子串匹配)一律 `***`", () => {
		assert.deepEqual(sanitize({ token: "t0ken", password: "p", nested: { Authorization: "Bearer x", cookie: "c" } }), {
			token: "***",
			password: "***",
			nested: { Authorization: "***", cookie: "***" },
		});
	});

	it("超长字符串截断并标注原长,数组只留前 10 个", () => {
		assert.equal(sanitize("x".repeat(400)), `${"x".repeat(300)}…(400)`);
		const many = sanitize(Array.from({ length: 12 }, (_value, index) => index)) as unknown[];
		assert.equal(many.length, 11);
		assert.equal(many.at(-1), "…(12)");
	});

	it("过深的嵌套折叠成 `…`,Date 转 ISO 串,函数丢掉", () => {
		assert.deepEqual(sanitize({ a: { b: { c: { d: { e: 1 } } } } }), { a: { b: { c: { d: "…" } } } });
		assert.equal(sanitize(new Date("2026-01-02T03:04:05.000Z")), "2026-01-02T03:04:05.000Z");
		assert.deepEqual(sanitize({ fn: () => 1 }), { fn: undefined });
	});
});
