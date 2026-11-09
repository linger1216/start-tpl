/**
 * 任务闭环(`tc_log`)活动日志的**词表与文本** —— 客户端安全:不引 DB、不引 React、不引图标。
 *
 * 为什么单独一个文件(而不是塞进 `routers/task-close.ts`):
 *  - 库里只存**英文事件码**与**状态 value**;中文是"读取时算出来的",router 与界面都要用这套词表;
 *  - 该 router 会连带拉起 tRPC 运行时,而这个文件要被前端 / 纯函数测试直接 import。
 *
 * 图标与色调**不在这里**(lucide 是客户端概念,别让它进 router 的 import 图)——
 * 见 `components/modules/task-close/task-close-log.tsx` 的注册表。
 */

/** 17 个事件码 —— **加事件要同时改**:这里 + 界面注册表 + `doc/task-close.md` */
export const TASK_LOG_EVENTS = [
	"task.create",
	"task.update",
	"task.remove",
	"task.transit",
	"action.create",
	"action.respond",
	"action.reply",
	"action.withdraw",
	"comment.create",
	"comment.remove",
	"member.add",
	"member.remove",
	"member.transfer",
	"report.bind",
	"report.distribute",
	"report.submit",
	"report.return",
] as const;

export type TaskLogEvent = (typeof TASK_LOG_EVENTS)[number];

/** 事件名(短标签;`describeLog()` 会再拼上对象与状态,别把它当完整句子用) */
export const TASK_LOG_LABEL: Record<TaskLogEvent, string> = {
	"task.create": "创建任务",
	"task.update": "修改任务",
	"task.remove": "删除任务",
	"task.transit": "改状态",
	"action.create": "发起审批",
	"action.respond": "答复审批",
	"action.reply": "回复征询",
	"action.withdraw": "撤回动作",
	"comment.create": "发表评论",
	"comment.remove": "删除评论",
	"member.add": "加入成员",
	"member.remove": "移出成员",
	"member.transfer": "转交",
	"report.bind": "配置填报",
	"report.distribute": "分发填报数据",
	"report.submit": "提交填报",
	"report.return": "退回填报",
};

/**
 * 事件类别 = 事件码的前缀 —— **不落库**(存了就是第二个真源,迟早和 `event` 打架),
 * 需要"只看状态 / 只看成员"时用 `logCategoryOf()` 现算。
 */
export type TaskLogCategory = "task" | "action" | "comment" | "member";

export function logCategoryOf(event: string): TaskLogCategory | null {
	const [head] = event.split(".");
	return head === "task" || head === "action" || head === "comment" || head === "member" ? head : null;
}

/**
 * 一行日志的**读取形状**(router 出参 / 界面入参共用)。
 *
 * `targetName` 由读取侧按 `event` 决定去哪张表查 —— 尽力而为:查不到回退 null,界面显示 id。
 * (`targetId` 是 `tc_log` 里的原值:动作 / 评论 / 人的 id;`task.*` 事件为 null。)
 */
export type TaskLogItem = {
	id: string;
	event: string;
	fromStatus: string | null;
	toStatus: string | null;
	targetId: string | null;
	targetName: string | null;
	actorId: string;
	actorName: string | null;
	detail: unknown;
	/** 评论正文摘要(`comment.create` 才有;读取侧截断) */
	excerpt: string | null;
	/** ISO 时刻;理论上不为 null(列 not null),与 `commentList` 同口径仍按可空处理 */
	createdAt: string | null;
};

/** 这次事件有没有动任务状态 —— 流程脊(`TaskFlowSpine`)就取这些行 */
export function logMovedStatus(item: Pick<TaskLogItem, "toStatus">): boolean {
	return item.toStatus !== null;
}

/** `task.update` 记下来的字段键 → 中文(新增可编辑字段时记得补) */
export const TASK_LOG_FIELD_LABEL: Record<string, string> = {
	name: "标题",
	description: "说明",
	dueAt: "截止时间",
	priority: "优先级",
	payload: "内容 / 附件",
};

export type LogTextContext = {
	/** 状态 value → 展示名(传 `(v) => statusLabelOf(statuses, v)`) */
	statusLabel: (value: string) => string;
	/** 成员角色 → 展示名(复用调用点既有的 `roleText`,不在这里再维护一份角色词表) */
	roleLabel: (role: string) => string;
};

/** 把 `detail` 当袋子读 —— 库里的 JSON 可能是任何东西,读不到就当没有,绝不抛 */
function bag(detail: unknown): Record<string, unknown> {
	return detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean {
	return value === true;
}

/**
 * 一行日志 → 两行文字:**标题**(动作本身,不含人名,界面自己配头像 / 人名)
 * + **附注**(驳回原因 / 改了哪些字段 / 角色;没有就 null)。
 *
 * 认不出的 `event` 不崩:标题回退成事件码本身,附注给一句人话。
 */
export function describeLog(item: TaskLogItem, ctx: LogTextContext): { title: string; note: string | null } {
	const detail = bag(item.detail);
	const from = item.fromStatus ? ctx.statusLabel(item.fromStatus) : null;
	const to = item.toStatus ? ctx.statusLabel(item.toStatus) : null;
	/** `甲 → 乙`;有一头缺就只写存在的那头 */
	const arrow = (a: string | null, b: string | null) => (a && b ? `${a} → ${b}` : (b ?? a ?? ""));

	switch (item.event) {
		case "task.create":
			return { title: TASK_LOG_LABEL["task.create"], note: null };
		case "task.update": {
			const fields = Array.isArray(detail.fields) ? detail.fields : [];
			const names = fields
				.map((field) => text(bag(field).key))
				.filter((key): key is string => key !== null)
				.map((key) => TASK_LOG_FIELD_LABEL[key] ?? key);
			const parts = [
				names.length > 0 ? `改了 ${names.join("、")}` : null,
				bool(detail.payloadChanged) ? "内容 / 附件有改动" : null,
			].filter((part): part is string => part !== null);
			return { title: TASK_LOG_LABEL["task.update"], note: parts.length > 0 ? parts.join(" · ") : null };
		}
		case "task.remove":
			return { title: TASK_LOG_LABEL["task.remove"], note: null };
		case "task.transit":
			return { title: `${TASK_LOG_LABEL["task.transit"]}:${arrow(from, to)}`, note: null };
		case "action.create": {
			const intended = text(detail.intendedTo);
			const intendedFrom = text(detail.intendedFrom);
			const target = item.targetName ?? text(detail.handleId);
			if (intended) {
				return {
					title: `${TASK_LOG_LABEL["action.create"]}:${arrow(intendedFrom ? ctx.statusLabel(intendedFrom) : from, ctx.statusLabel(intended))}`,
					note: target ? `指派给 ${target}${bool(detail.isLocking) ? " · 任务已锁定" : ""}` : null,
				};
			}
			return { title: "发起征询", note: target ? `征询 ${target}` : null };
		}
		case "action.respond": {
			const approved = bool(detail.approved);
			const note = approved ? null : (text(detail.reason) ?? null);
			const moved = from && to && from !== to;
			return {
				title: approved
					? `${TASK_LOG_LABEL["action.respond"]}:通过${moved ? `(${arrow(from, to)})` : ""}`
					: `${TASK_LOG_LABEL["action.respond"]}:驳回${moved ? `(${arrow(from, to)})` : ""}`,
				note: note ? `驳回原因:${note}` : null,
			};
		}
		case "action.reply": {
			const of = item.targetName ?? text(detail.consultOf);
			const count = typeof detail.attachments === "number" ? detail.attachments : 0;
			const parts = [item.excerpt ? `意见:${item.excerpt}` : null, count > 0 ? `附 ${count} 个附件` : null].filter(
				(part): part is string => part !== null,
			);
			return {
				title: of ? `回复征询(对 ${of})` : TASK_LOG_LABEL["action.reply"],
				note: parts.length > 0 ? parts.join(" · ") : null,
			};
		}
		case "action.withdraw":
			return { title: TASK_LOG_LABEL["action.withdraw"], note: null };
		case "comment.create": {
			const count = typeof detail.attachments === "number" ? detail.attachments : 0;
			const note = [item.excerpt, count > 0 ? `附 ${count} 个附件` : null].filter((part) => part !== null).join(" · ");
			return { title: TASK_LOG_LABEL["comment.create"], note: note.length > 0 ? note : null };
		}
		case "comment.remove":
			return { title: TASK_LOG_LABEL["comment.remove"], note: item.excerpt ? `“${item.excerpt}”` : null };
		case "member.add": {
			const role = text(detail.role);
			const who = item.targetName ?? item.targetId;
			return {
				title: who ? `${TASK_LOG_LABEL["member.add"]}:${who}` : TASK_LOG_LABEL["member.add"],
				note: role ? `角色:${ctx.roleLabel(role)}${bool(detail.isPrimary) ? "(主)" : ""}` : null,
			};
		}
		case "member.remove": {
			const role = text(detail.role);
			const who = item.targetName ?? item.targetId;
			return {
				title: who ? `${TASK_LOG_LABEL["member.remove"]}:${who}` : TASK_LOG_LABEL["member.remove"],
				note: role ? `角色:${ctx.roleLabel(role)}` : null,
			};
		}
		case "member.transfer": {
			const who = item.targetName ?? item.targetId;
			return {
				title: who ? `${TASK_LOG_LABEL["member.transfer"]}:${who}` : TASK_LOG_LABEL["member.transfer"],
				note: "新执行人(主);原执行人改为参与者",
			};
		}
		case "report.bind":
			return {
				title:
					detail.versionId === null
						? "移除填报"
						: detail.previousVersionId
							? "更换填报模板"
							: TASK_LOG_LABEL["report.bind"],
				note: null,
			};
		case "report.distribute":
			return { title: TASK_LOG_LABEL["report.distribute"], note: null };
		case "report.submit":
			return { title: TASK_LOG_LABEL["report.submit"], note: null };
		case "report.return": {
			const reason = text(detail.reason);
			return { title: TASK_LOG_LABEL["report.return"], note: reason ? `退回原因:${reason}` : null };
		}
		default:
			// 将来新增事件码而界面没跟上时走这里:显示码本身,不白屏、不错位
			return { title: TASK_LOG_LABEL[item.event as TaskLogEvent] ?? item.event, note: "未知事件类型" };
	}
}
