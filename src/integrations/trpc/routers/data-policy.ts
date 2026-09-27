/**
 * 数据权限路由 —— 「系统设置 ▸ 数据权限」。
 *
 * 管的是 `sys_data_policy` 里的**直白授权规则**(行级数据权限的载体)。这里**不是** Casbin 的原生
 * CRUD:规则永远只有 `p` 一行、`(v0,v1,v2)` 是唯一键、没有 `g` 行(角色 ↔ 权限点已经归
 * `/settings/roles` 的权限树)。所以界面上是"人话的规则台账",背后写的就是引擎认的那几列。
 *
 * 六件事:
 *  · `list`       全表 + 把主体 / 资源 / 行 id 翻成人话(前端分页,与其它台账页一致);
 *  · `explain`    「谁能看到什么」—— 把判定链(主体集合 → 命中规则 → 可见集合 → 实测条数)整条摊开;
 *  · `create`     **批量登记**:一个主体(可多选)× 多行资源(每行各自的动作 / 效果)一次落完,
 *                 **只补不覆盖**;先全校验、后统一写 —— 一批里有一条不合法就一条都不写;
 *  · `update`     改**一行**(含唯一键 —— 主体 / 资源 / 动作一起改就是"搬家";键重复会明确报冲突);
 *  · `updateMany` 批量改标量字段(动作 / 效果 / 启用):改动作时撞上已有键的那行**跳过并回报名单**,
 *                 不整批失败;
 *  · `remove`     批量删除。
 *
 * ⚠️ 判定只认 Casbin(`lib/data-policy.ts`):本文件只负责把界面意图翻译成合法的
 * `v0/v1/v2/v3`,**不在这里另写一套判断**。
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db";
import { sysDataPolicy } from "#/db/data-base-schema";
import {
	clearDataPolicyCache,
	ensureRule,
	explainPolicyFor,
	listPolicyRows,
	REGISTERED_RESOURCE_TYPES,
} from "#/lib/data-policy";
import {
	POLICY_ACTIONS,
	POLICY_EFFECTS,
	POLICY_MAX_RULES,
	POLICY_MAX_SCOPES,
	POLICY_SCOPE_KINDS,
	POLICY_SUBJECT_KINDS,
	type PolicyAction,
	type PolicyEffect,
	type PolicyRule,
	type PolicyScopeKind,
	type PolicySubjectKind,
	policyRuleProblem,
} from "#/lib/data-policy-spec";
import { logger } from "#/lib/logger";
import { createTRPCRouter, protectedProcedure } from "../init";

const effectSchema = z.enum(POLICY_EFFECTS);
const actionSchema = z.enum(POLICY_ACTIONS);
/** 资源类型必须是**引擎已登记**的:没登记的类型写进去会被当成非法行静默忽略(最难查的一类问题) */
const resourceTypeSchema = z.string().refine((value) => REGISTERED_RESOURCE_TYPES.includes(value), {
	message: `资源类型只能是 ${REGISTERED_RESOURCE_TYPES.join(" / ")}`,
});

/**
 * 资源那一半的形状(资源 / 范围 / 对象 / 动作)。
 *
 * **新增的每一行资源与编辑共用这一份**,别抄第二遍 —— 抄一遍就会漂(比如 `scopeIds` 的上限改了、
 * 另一处忘了改;上限值本身在 `data-policy-spec.ts`,表单提示用的是同一份)。
 */
const resourceShape = {
	/** `null` = 全部资源(`*`) */
	resourceType: resourceTypeSchema.nullable().default(null),
	/** 整类型 / 该组织及以下 / 具体一行 */
	scopeKind: z.enum(POLICY_SCOPE_KINDS).default("type"),
	/** 按组织 / 按行时的范围对象(可多选,与主体做叉积);整类型与「全部资源」时忽略 */
	scopeIds: z.array(z.string().min(1).max(64)).max(POLICY_MAX_SCOPES).default([]),
	action: actionSchema.default("*"),
};

/**
 * 新增 = **主体(可多选)× 多行资源**的叉积,一次调用落完。
 *
 * 为什么资源是一个数组而不是一组平铺字段:一个主体要 A B C D 四份授权,而这四份常常
 * **类型 / 范围 / 动作都不一样**(整类只读 + 某几行可写…),平铺字段一次只能表达一种,
 * 界面就得"保存 → 关弹窗 → 再选一次主体",这才是最烦人的地方。
 */
const createInput = z.object({
	subKind: z.enum(POLICY_SUBJECT_KINDS),
	/** `subKind = "all"` 时忽略;其余情况下每个 id 生成一组规则 */
	subjectIds: z.array(z.string().min(1).max(64)).max(POLICY_MAX_RULES).default([]),
	resources: z
		.array(z.object({ ...resourceShape, effect: effectSchema.default("allow") }))
		.min(1)
		.max(POLICY_MAX_SCOPES),
	remark: z.string().max(255).nullable().default(null),
});

/**
 * 编辑 = 连**唯一键**一起改。
 *
 * 主体 / 资源 / 动作是 `(v0,v1,v2)` 唯一键,所以"改键"在库里就是把这一行搬到新键上;
 * 主体与范围都**只允许一个**是刻意的:编辑一行规则却在界面上多选,等于把"改"变成"拆成 N 条"——
 * 那种意图请走「新增规则」(新增支持叉积)。
 */
const updateInput = z.object({
	...resourceShape,
	subKind: z.enum(POLICY_SUBJECT_KINDS),
	subjectIds: z.array(z.string().min(1).max(64)).max(POLICY_MAX_RULES).default([]),
	id: z.string().min(1),
	effect: effectSchema,
	status: z.number().int().min(0).max(1),
	remark: z.string().max(255).nullable().default(null),
});

/** 批量改**标量**字段(动作 / 效果 / 启用)—— 一项都不给就没意义,直接拒 */
const updateManyInput = z
	.object({
		ids: z.array(z.string().min(1)).min(1).max(POLICY_MAX_RULES),
		action: actionSchema.optional(),
		effect: effectSchema.optional(),
		status: z.number().int().min(0).max(1).optional(),
	})
	.refine((value) => value.action !== undefined || value.effect !== undefined || value.status !== undefined, {
		message: "至少给一项要改的内容(动作 / 效果 / 启用)",
	});

/** 主体那一半的入参 —— `subjectsFrom` 只吃这一半 */
type PolicySubjectInput = { subKind: PolicySubjectKind; subjectIds: string[] };
/** 资源那一半的入参 —— `objectsFrom` 只吃这一半 */
type PolicyResourceInput = { resourceType: string | null; scopeKind: PolicyScopeKind; scopeIds: string[] };

/** 界面选择 → `v0`(主体串):`*` / `user:<id>` … */
function subjectsFrom(input: PolicySubjectInput): string[] {
	if (input.subKind === "all") return ["*"];
	const ids = [...new Set(input.subjectIds.map((id) => id.trim()).filter(Boolean))];
	if (ids.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "请先选择要授权的对象" });
	return ids.map((id) => `${input.subKind}:${id}`);
}

/** 界面选择 → `v1`(资源串):`*` / `demo_grid` / `demo_grid@org:<部门>` / `demo_grid@<行>` */
function objectsFrom(input: PolicyResourceInput): string[] {
	if (!input.resourceType) return ["*"];
	if (input.scopeKind === "type") return [input.resourceType];
	const ids = [...new Set(input.scopeIds.map((id) => id.trim()).filter(Boolean))];
	if (ids.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "按组织 / 按行授权时必须选一个具体对象" });
	return ids.map((id) =>
		input.scopeKind === "org" ? `${input.resourceType}@org:${id}` : `${input.resourceType}@${id}`,
	);
}

export const dataPolicyRouter = createTRPCRouter({
	/** 规则台账(全表 + 人话标签;几十条量级,前端分页) */
	list: protectedProcedure.query(async () => listPolicyRows()),

	/**
	 * 「谁能看到什么」—— 选一个人,把判定链与每个资源的实测条数摊开。
	 *
	 * 只读:判定完全走 `dataScopeWhere` 那条路(同一批函数),所以界面上的数字就是列表接口
	 * 真会返回的条数。想看"改完会怎样"就真改(改完有 `policy.*` 日志可查)。
	 */
	explain: protectedProcedure.input(z.object({ userId: z.string().min(1) })).query(async ({ input }) => {
		const explain = await explainPolicyFor(input.userId);
		if (!explain) throw new TRPCError({ code: "NOT_FOUND", message: "这个用户不存在" });
		return explain;
	}),

	/** 批量新增规则 —— 需要 `sys:policy:add`;已存在的行**不动**(含备注与效果) */
	create: protectedProcedure.input(createInput).mutation(async ({ input }) => {
		const subjects = subjectsFrom(input);
		const objectsPerRow = input.resources.map((row) => objectsFrom(row));
		// ① 主体 × 资源是叉积:多选很方便,但一次点出来的行数要有个上限,免得手滑生成上千条
		const plan = subjects.length * objectsPerRow.reduce((sum, objects) => sum + objects.length, 0);
		if (plan > POLICY_MAX_RULES) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `一次最多新增 ${POLICY_MAX_RULES} 条规则,当前选择会生成 ${subjects.length} 主体 × ${objectsPerRow.map((objects) => objects.length).join(" + ")} 资源 = ${plan} 条`,
			});
		}
		// ② 先**全部**校验(含"同一个主体 + 资源 + 动作只能有一个效果"),任何一条不合法 ⇒ 整批拒
		//    —— 校验与写库分成两趟,是为了"坏输入一个字节都不写库"
		const planned: { sub: string; obj: string; act: PolicyAction; eft: PolicyEffect }[] = [];
		const effectOf = new Map<string, PolicyEffect>();
		for (const [index, objects] of objectsPerRow.entries()) {
			const row = input.resources[index];
			const action = (row?.action ?? "*") as PolicyAction;
			const effect = (row?.effect ?? "allow") as PolicyEffect;
			for (const sub of subjects) {
				for (const obj of objects) {
					// 按引擎的同一套解析规则校验:写进去引擎认不出来,这份授权就会静默失效
					const problem = policyRuleProblem({ sub, obj, act: action, eft: effect } satisfies PolicyRule);
					if (problem) {
						throw new TRPCError({ code: "BAD_REQUEST", message: `第 ${index + 1} 行资源不合法:${problem}` });
					}
					const key = `${sub}|${obj}|${action}`;
					const before = effectOf.get(key);
					if (before && before !== effect) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `同一个主体 + 资源 + 动作只能有一个效果:${sub} → ${obj} 同时要了「${before}」与「${effect}」`,
						});
					}
					effectOf.set(key, effect);
					planned.push({ sub, obj, act: action, eft: effect });
				}
			}
		}
		// ③ 全部合法后才落库:逐条 `ensureRule`(只补不覆盖,唯一键 `(v0,v1,v2)` 兜底)
		const remark = input.remark?.trim() || "后台手工维护";
		let created = 0;
		let existed = 0;
		for (const rule of planned) {
			if (await ensureRule(rule.sub, rule.obj, rule.act, remark, rule.eft)) created += 1;
			else existed += 1;
		}
		return { created, existed };
	}),

	/**
	 * 改**这一行**(含唯一键) —— 需要 `sys:policy:edit`。
	 *
	 * 主体 / 资源 / 动作变了 = 这行规则搬家:先按目标键查重(库里 `uk_sys_data_policy_sub_obj_act`
	 * 是最后一道闸,但撞库报出来的是数据库错误,这里提前换成一句人话);
	 * 只改效果/状态/说明时目标键就是原键,`id <> 自己` 的查重天然为空,不额外分支。
	 */
	update: protectedProcedure.input(updateInput).mutation(async ({ input }) => {
		const [existing] = await db
			.select({ id: sysDataPolicy.id, v0: sysDataPolicy.v0, v1: sysDataPolicy.v1, v2: sysDataPolicy.v2 })
			.from(sysDataPolicy)
			.where(eq(sysDataPolicy.id, input.id))
			.limit(1);
		if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "这条规则不存在(可能已被删除)" });

		const subjects = subjectsFrom(input);
		const objects = objectsFrom(input);
		if (subjects.length !== 1 || objects.length !== 1) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "编辑一次只能改一行规则:主体与范围各选一个" });
		}
		const [v0] = subjects;
		const [v1] = objects;
		const v2 = input.action;
		// 先按引擎的同一套解析规则校验:写进去引擎认不出来,这份授权就会静默失效
		const problem = policyRuleProblem({ sub: v0, obj: v1, act: v2, eft: input.effect } satisfies PolicyRule);
		if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: `策略不合法:${problem}` });

		const moved = existing.v0 !== v0 || existing.v1 !== v1 || existing.v2 !== v2;
		if (moved) {
			const [conflict] = await db
				.select({ id: sysDataPolicy.id })
				.from(sysDataPolicy)
				.where(
					and(
						eq(sysDataPolicy.v0, v0),
						eq(sysDataPolicy.v1, v1),
						eq(sysDataPolicy.v2, v2),
						ne(sysDataPolicy.id, input.id),
					),
				)
				.limit(1);
			if (conflict) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "已存在同样的规则(主体 + 资源 + 动作):改无可改,直接删掉这一条即可",
				});
			}
		}

		await db
			.update(sysDataPolicy)
			.set({
				v0,
				v1,
				v2,
				v3: input.effect,
				status: input.status,
				remark: input.remark?.trim() || null,
				update_time: new Date(),
			})
			.where(eq(sysDataPolicy.id, input.id));
		clearDataPolicyCache();
		logger.info("policy.update", {
			id: input.id,
			sub: v0,
			obj: v1,
			act: v2,
			effect: input.effect,
			status: input.status,
			moved,
		});
		return { ok: true, moved };
	}),

	/**
	 * 批量改标量字段 —— 需要 `sys:policy:edit`。台账里勾 N 条一次改掉。
	 *
	 * 两个口径写死在这里:
	 *  1. **先全校验、再统一改**:校验不过的行在写库之前就抛出去,不会留半批;
	 *  2. **改动作可能撞键**(`(v0,v1,v2)` 唯一键):撞上的那一行**跳过并回报名单**,其余照改 ——
	 *     批量操作不该因为其中一条冲突就全军覆没。撞键按**传入顺序**逐行判断,所以同一批里
	 *     先改的那条会占住新键。
	 */
	updateMany: protectedProcedure.input(updateManyInput).mutation(async ({ input }) => {
		const rows = await db
			.select({
				id: sysDataPolicy.id,
				v0: sysDataPolicy.v0,
				v1: sysDataPolicy.v1,
				v2: sysDataPolicy.v2,
				v3: sysDataPolicy.v3,
			})
			.from(sysDataPolicy)
			.where(inArray(sysDataPolicy.id, input.ids));
		const byId = new Map(rows.map((row) => [row.id, row]));
		// 按传入顺序处理(ids 里可能有重复 / 不存在的;不存在的计入 skipped)
		const targets: { row: (typeof rows)[number]; act: PolicyAction; eft: PolicyEffect }[] = [];
		let skipped = 0;
		for (const id of input.ids) {
			const row = byId.get(id);
			if (!row) {
				skipped += 1;
				continue;
			}
			const act = (input.action ?? row.v2) as PolicyAction;
			const eft = (input.effect ?? (row.v3 === "deny" ? "deny" : "allow")) as PolicyEffect;
			const problem = policyRuleProblem({ sub: row.v0, obj: row.v1, act, eft } satisfies PolicyRule);
			if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: `策略不合法:${problem}` });
			targets.push({ row, act, eft });
		}

		let updated = 0;
		const conflicts: string[] = [];
		for (const { row, act, eft } of targets) {
			if (act !== row.v2) {
				const [conflict] = await db
					.select({ id: sysDataPolicy.id })
					.from(sysDataPolicy)
					.where(
						and(
							eq(sysDataPolicy.v0, row.v0),
							eq(sysDataPolicy.v1, row.v1),
							eq(sysDataPolicy.v2, act),
							ne(sysDataPolicy.id, row.id),
						),
					)
					.limit(1);
				if (conflict) {
					conflicts.push(row.id);
					continue;
				}
			}
			await db
				.update(sysDataPolicy)
				.set({
					v2: act,
					v3: eft,
					...(input.status === undefined ? {} : { status: input.status }),
					update_time: new Date(),
				})
				.where(eq(sysDataPolicy.id, row.id));
			updated += 1;
		}
		if (updated > 0) clearDataPolicyCache();
		logger.info("policy.update_many", {
			requested: input.ids.length,
			updated,
			skipped,
			conflicts: conflicts.length,
		});
		return { updated, skipped, conflicts };
	}),

	/** 批量删除 —— 需要 `sys:policy:remove` */
	remove: protectedProcedure.input(z.object({ ids: z.array(z.string().min(1)).min(1) })).mutation(async ({ input }) => {
		const rows = await db
			.select({ id: sysDataPolicy.id })
			.from(sysDataPolicy)
			.where(inArray(sysDataPolicy.id, input.ids));
		await db.delete(sysDataPolicy).where(inArray(sysDataPolicy.id, input.ids));
		clearDataPolicyCache();
		logger.info("policy.remove", { count: rows.length });
		return { removed: rows.length };
	}),
});
