/**
 * 评论 / 征询回复里的 **@提及选人** —— 键入 `@`(或点工具条的 @ 按钮)都汇到这一处。
 *
 * 选单只做**过滤与插词**;真正的提及判定由服务端在写入时按任务名册再算一遍
 * (`routers/task-close.ts` 的 `notifyMentions`),前端这份名单只让交互顺滑。
 * 挂到使用侧只有三步:
 *  - `track(value, caret)` 在 textarea 的 onChange 里调用 → 检测光标前是不是在 `@词` 里;
 *  - `onKeyDown(e)` 在 textarea 的 onKeyDown 里**最先**调用 → ↑↓ 选择、Enter/Tab 插词、Esc 关闭,吃了就返回 true;
 *  - 渲染 `<MentionList … />`(放输入框下沿,常规流,不搞浮层定位)。
 */

import type { KeyboardEvent, RefObject } from "react";
import { useMemo, useState } from "react";

import { cn } from "#/lib/utils";

export type Participant = { id: string; name: string };

/** 一屏最多给 6 个候选(键盘 ↑↓ 都能摸得到) */
const MAX_OPTIONS = 6;

export function useMentionPicker(
	participants: readonly Participant[] | undefined,
	setText: (next: string) => void,
	textareaRef: RefObject<HTMLTextAreaElement | null>,
) {
	const [state, setState] = useState<{ start: number; fragment: string } | null>(null);
	const [highlight, setHighlight] = useState(0);

	const options = useMemo(() => {
		if (!state) return [];
		const kw = state.fragment.toLowerCase();
		return (participants ?? [])
			.filter((person) => person.name && (!kw || person.name.toLowerCase().includes(kw)))
			.slice(0, MAX_OPTIONS);
	}, [state, participants]);

	/** 在光标前找「`@` + 词」;找到就开着选单(state.start = @ 在全文的下标;fragment = @ 与光标之间的词) */
	function track(value: string, caret: number | null): void {
		const end = caret ?? value.length;
		const match = /@([^\s@]*)$/.exec(value.slice(0, end));
		if (!match) {
			if (state) setState(null);
			return;
		}
		setState({ start: end - match[0].length, fragment: match[1] ?? "" });
		setHighlight(0);
	}

	/** 把「@片段」替换成「@姓名 」—— 正文、光标位一并算好,等下一帧把焦点和光标放回去 */
	function insert(name: string, value: string): void {
		if (!state) return;
		const token = `@${name} `;
		const end = state.start + 1 + state.fragment.length;
		setText(`${value.slice(0, state.start)}${token}${value.slice(end)}`);
		setState(null);
		const caret = state.start + token.length;
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(caret, caret);
		});
	}

	/**
	 * textarea onKeyDown 里**最先**调用;返回 true = 这个键已经被选单吃掉,调用方就 return。
	 * Enter / Tab 也会被吃掉 —— 不然"回车选中"会顺便把调用方的"回车发送评论"带出来。
	 */
	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
		if (!state) return false;
		if (options.length === 0) {
			if (event.key === "Escape") {
				setState(null);
				return true;
			}
			return false;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setHighlight((index) => Math.min(Math.max(index + delta, 0), options.length - 1));
			return true;
		}
		if (event.key === "Enter" || event.key === "Tab") {
			const chosen = options[highlight];
			if (chosen) {
				event.preventDefault();
				insert(chosen.name, event.currentTarget.value);
				return true;
			}
		}
		if (event.key === "Escape") {
			setState(null);
			return true;
		}
		return false;
	}

	/** 工具条上的「@」按钮:在光标处补一个 @,并开着空过滤的选单(后面接着打字就自然收窄) */
	function insertAtCursor(value: string): void {
		const el = textareaRef.current;
		if (!el) return;
		const at = el.selectionStart ?? value.length;
		const next = `${value.slice(0, at)}@${value.slice(el.selectionEnd ?? at)}`;
		setText(next);
		setState({ start: at, fragment: "" });
		setHighlight(0);
		requestAnimationFrame(() => el.focus());
	}

	return { state, options, highlight, track, onKeyDown, insert, insertAtCursor, close: () => setState(null) };
}

/** 候选单 —— 浮在输入框正下方(常规流);点击不偷焦点(`onMouseDown` 抢先拦掉) */
export function MentionList({
	options,
	highlight,
	onPick,
}: {
	options: readonly Participant[];
	highlight: number;
	onPick: (person: Participant) => void;
}) {
	if (options.length === 0) return null;
	return (
		<ul
			aria-label="提及候选"
			className="mx-3 mb-1 max-h-44 overflow-y-auto rounded-lg border border-border bg-popover shadow-(--shadow-card)"
		>
			{options.map((person, index) => (
				<li key={person.id}>
					<button
						type="button"
						aria-label={`提及 ${person.name}`}
						// 用 onMouseDown 而不是 onClick:点了候选**不能**让 textarea 失焦(blur 会把选单提前关掉)
						onMouseDown={(event) => {
							event.preventDefault();
							onPick(person);
						}}
						className={cn(
							"flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
							index === highlight ? "bg-muted" : "hover:bg-muted/50",
						)}
					>
						<span aria-hidden className="text-xs text-muted-foreground">
							@
						</span>
						<span className="truncate text-foreground">{person.name}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
