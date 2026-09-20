import { Badge } from "#/components/ui/badge";
import { STATUS, STATUS_BADGE_CLASS, STATUS_LABEL, type StatusValue } from "#/lib/constants";

/**
 * 状态徽章 —— 两种口径,别混用:
 *
 *  · `StatusBadge`      **数字状态** 1/0 → 启用/禁用。适合数据库里的 `status` 列
 *                       (接受任意 number,非 1 一律按 0 处理,兼容历史脏数据)。
 *  · `StatusWordBadge`  **状态词** → 语义色。适合业务状态列(已关联 / 待复核 / 需现场核查…)。
 *
 * 为什么合在一个文件:`StatusWordBadge` 之前在业务域里另写了一份
 * (`GovernanceStatusCell`),两处都在回答"这个状态该是什么颜色"。
 * 状态词表按业务域不同,所以默认词表只放**跨域通用档**,域内词由调用方用
 * `variants` 覆盖或补充 —— 不要为了加一个状态词再复制一个组件。
 */

/** 数字状态:非 1 视为 0 */
export function StatusBadge({ status }: { status: number }) {
	const v: StatusValue = status === STATUS.ENABLED ? STATUS.ENABLED : STATUS.DISABLED;
	return <Badge className={`border-transparent ${STATUS_BADGE_CLASS[v]}`}>{STATUS_LABEL[v]}</Badge>;
}

/** 状态词徽章的语义档位(与 `ui/badge` 的 variant 同名) */
export type StatusWordVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * 跨域通用状态词表 —— 只放"任何业务域都认"的词。
 * 域内专有词(如「免现场检查」「建议约谈」)由调用方通过 `variants` 传入,不往这里堆。
 */
const COMMON_STATUS_WORDS: Record<string, StatusWordVariant> = {
	启用: "default",
	正常: "default",
	已完成: "default",
	已通过: "default",
	暂停: "secondary",
	草稿: "secondary",
	待处理: "secondary",
	待复核: "secondary",
	异常: "destructive",
	失败: "destructive",
	已驳回: "destructive",
};

export function StatusWordBadge({
	value,
	/** 域内补充 / 覆盖的「词 → variant」表 */
	variants,
	/** 空值占位符 */
	empty = "—",
}: {
	value: unknown;
	variants?: Record<string, StatusWordVariant>;
	empty?: string;
}) {
	const text = value === undefined || value === null || value === "" ? empty : String(value);
	if (text === empty) return <span className="text-muted-foreground">{empty}</span>;
	const map = variants ? { ...COMMON_STATUS_WORDS, ...variants } : COMMON_STATUS_WORDS;
	return <Badge variant={map[text] ?? "secondary"}>{text}</Badge>;
}
