import { ArrowRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useStableKeys } from "#/hooks/use-stable-keys";
import type { WorkflowStatus } from "#/lib/task-close-spec";
import { cn } from "#/lib/utils";

/** `who` 协议的取值(与 `doc/task-close.md` 的 who 协议一致;`[]` 是系统自带,编辑器不产出) */
export type WorkflowWho = "creator" | "participant" | "executor" | "any";

/** 一条状态转移边 —— 与 `tc_workflow.payload.edges` 同形(`who` 见 `doc/task-close.md` 的 who 协议) */
export type WorkflowEdgeInput = { from: string; to: string; who: WorkflowWho[]; via: "direct" | "action" };

/** 编辑态回填的整份模板定义(新建时为 null) */
export type WorkflowEditing = {
	id: string;
	name: string;
	statuses: WorkflowStatus[];
	initial: string;
	edges: WorkflowEdgeInput[];
};

export type WorkflowFormPayload = Omit<WorkflowEditing, "id">;

type DraftEdge = WorkflowEdgeInput & { key: string };

/** 对话框里一行边的 React key —— 模块级自增,删中间一行不会串位 */
let edgeSeed = 0;
const draftEdge = (edge: WorkflowEdgeInput): DraftEdge => ({ ...edge, key: `edge-${edgeSeed++}` });

/** 单次编辑最多 200 条边(与 `normalizeWorkflow` 的上限一致) */
const MAX_EDGES = 200;

/** 新建模板时的起步值 —— 给一套能立刻保存的最小状态机,省得对着空表单发愣 */
const BLANK: Omit<WorkflowEditing, "id"> = {
	name: "",
	statuses: [
		{ value: "open", label: "进行中" },
		{ value: "done", label: "待核验" },
		{ value: "closed", label: "已关闭" },
	],
	initial: "open",
	edges: [
		{ from: "open", to: "done", who: ["creator", "executor"], via: "action" },
		{ from: "done", to: "closed", who: ["creator"], via: "direct" },
	],
};

const WHO_OPTIONS: { value: WorkflowWho; label: string }[] = [
	{ value: "creator", label: "创建者" },
	{ value: "participant", label: "参与者" },
	{ value: "executor", label: "执行者" },
	{ value: "any", label: "任意" },
];

const VIA_OPTIONS: { value: "direct" | "action"; label: string }[] = [
	{ value: "direct", label: "直接改" },
	{ value: "action", label: "审批动作" },
];

/**
 * 新建 / 编辑流程模板 —— 结构化编辑器。
 *
 * 三块一起编辑:`statuses`(每行 value + label)、`initial`(从当前状态里挑)、`edges`(可增删的行)。
 * **改状态会连带收拾边**:改标识会把边 / 初始态里的旧值一起改名,删状态则剔除引用它的边 ——
 * 服务端 `normalizeWorkflow` 还会再校验一遍(前端只是提前挡,服务端为准)。
 */
export function TaskCloseWorkflowForm({
	open,
	onOpenChange,
	pending,
	editing,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	/** 非空 = 编辑态 */
	editing: WorkflowEditing | null;
	onSubmit: (payload: WorkflowFormPayload) => void;
}) {
	const [name, setName] = useState("");
	const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
	const [initial, setInitial] = useState("");
	const [edges, setEdges] = useState<DraftEdge[]>([]);
	const statusKeys = useStableKeys(statuses.length, "tc-status");

	useEffect(() => {
		if (!open) return;
		const source = editing ?? BLANK;
		setName(source.name);
		setStatuses(source.statuses.map((status) => ({ ...status })));
		setInitial(source.initial);
		setEdges(source.edges.map(draftEdge));
	}, [open, editing]);

	/** 改一个状态;改 `value` 时把边与初始态里的旧值一起改名(不让引用断掉) */
	function patchStatus(index: number, patch: Partial<WorkflowStatus>) {
		const prevValue = statuses[index]?.value ?? "";
		setStatuses((prev) => prev.map((status, i) => (i === index ? { ...status, ...patch } : status)));
		if (patch.value !== undefined && patch.value !== prevValue) {
			const nextValue = patch.value;
			setEdges((prev) =>
				prev.map((edge) => ({
					...edge,
					from: edge.from === prevValue ? nextValue : edge.from,
					to: edge.to === prevValue ? nextValue : edge.to,
				})),
			);
			setInitial((prev) => (prev === prevValue ? nextValue : prev));
		}
	}

	function addStatus() {
		const used = new Set(statuses.map((status) => status.value));
		let n = statuses.length + 1;
		while (used.has(`status${n}`)) n += 1;
		setStatuses((prev) => [...prev, { value: `status${n}`, label: `状态 ${n}` }]);
	}

	/** 删一个状态:剔除引用了它的边,`initial` 失效则回落第一个 */
	function removeStatus(index: number) {
		const removed = statuses[index]?.value;
		const next = statuses.filter((_, i) => i !== index);
		const values = new Set(next.map((status) => status.value));
		setStatuses(next);
		setEdges((prev) => prev.filter((edge) => values.has(edge.from) && values.has(edge.to)));
		setInitial((prev) => (prev !== removed && values.has(prev) ? prev : (next[0]?.value ?? "")));
	}

	function addEdge() {
		if (edges.length >= MAX_EDGES) return;
		const first = statuses[0]?.value ?? "";
		setEdges((prev) => [...prev, draftEdge({ from: first, to: first, who: ["creator"], via: "direct" })]);
	}

	function patchEdge(key: string, patch: Partial<WorkflowEdgeInput>) {
		setEdges((prev) => prev.map((edge) => (edge.key === key ? { ...edge, ...patch } : edge)));
	}

	function toggleWho(key: string, value: WorkflowWho, on: boolean) {
		setEdges((prev) =>
			prev.map((edge) => {
				if (edge.key !== key) return edge;
				const who = on ? [...new Set([...edge.who, value])] : edge.who.filter((item) => item !== value);
				return { ...edge, who };
			}),
		);
	}

	const statusOptions = statuses.map((status) => ({ value: status.value, label: status.label }));
	const statusValues = statuses.map((status) => status.value);

	/**
	 * 同一对 (from,to) 只能有一条边(服务端 `normalizeWorkflow` 会拒)。
	 * 这里先本地标出来 + 禁用保存,避免"填完才被接口打回"。
	 */
	const duplicateKeys = useMemo(() => {
		const byPair = new Map<string, string[]>();
		for (const edge of edges) {
			const pair = `${edge.from}->${edge.to}`;
			byPair.set(pair, [...(byPair.get(pair) ?? []), edge.key]);
		}
		const dup = new Set<string>();
		for (const keys of byPair.values()) {
			if (keys.length > 1) for (const key of keys) dup.add(key);
		}
		return dup;
	}, [edges]);

	const canSubmit =
		name.trim().length > 0 &&
		statuses.length > 0 &&
		statuses.every((status) => status.value.trim().length > 0 && status.label.trim().length > 0) &&
		statusValues.includes(initial) &&
		duplicateKeys.size === 0 &&
		edges.every((edge) => statusValues.includes(edge.from) && statusValues.includes(edge.to) && edge.who.length > 0);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{editing ? "编辑流程模板" : "新建流程模板"}</DialogTitle>
					<DialogDescription>
						「直接改」的边不建动作,创建者直接改状态;「审批动作」的边会锁住任务,等答复结算。
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-4 py-1 pr-1">
					<DetailRow label="模板名称" htmlFor="tcw-name">
						<Input
							id="tcw-name"
							className="h-8 text-sm"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="比如:默认事项流程"
						/>
					</DetailRow>

					<div className="space-y-4">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-sm font-medium">状态</span>
								<ActionButton disabled={statuses.length >= 30} onClick={addStatus}>
									新增状态
								</ActionButton>
							</div>
							<p className="text-xs text-muted-foreground">
								每行:标识(英文,落库与边引用用)+ 展示名(界面只显示它)。改标识会把边与初始态一起改名。
							</p>
							{statuses.map((status, index) => (
								<div key={statusKeys[index]} className="flex flex-wrap items-center gap-1.5">
									<Input
										value={status.value}
										aria-label={`第 ${index + 1} 个状态标识`}
										placeholder="标识,如 open"
										className="h-8 w-32 font-mono text-xs"
										onChange={(event) => patchStatus(index, { value: event.target.value })}
									/>
									<Input
										value={status.label}
										aria-label={`第 ${index + 1} 个状态展示名`}
										placeholder="展示名,如 进行中"
										className="h-8 w-40 text-sm"
										onChange={(event) => patchStatus(index, { label: event.target.value })}
									/>
									<ActionButton tone="danger" disabled={statuses.length <= 1} onClick={() => removeStatus(index)}>
										删除
									</ActionButton>
								</div>
							))}
						</div>
						<DetailRow label="初始态">
							<Select
								items={statusOptions}
								value={initial || null}
								onValueChange={(next) => setInitial(next ? String(next) : "")}
							>
								<SelectTrigger size="sm" className="w-full">
									<SelectValue placeholder="先从上面加状态" />
								</SelectTrigger>
								<SelectContent>
									{statusOptions.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</DetailRow>
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">状态转移边</span>
							<Button variant="outline" size="sm" onClick={addEdge} disabled={edges.length >= MAX_EDGES}>
								<Plus className="size-3.5" />
								新增转移边
							</Button>
						</div>
						{duplicateKeys.size > 0 ? (
							<p className="text-xs text-destructive">
								同一对状态只能有一条边:把重复的转移删掉,或在「直接改 / 审批动作」里二选一。
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								「审批动作」的边会先进入系统的锁态「待审批」（pending），答复通过后再落到目标状态。想让某对状态
								<span className="font-medium text-foreground">必须</span>
								走审批,就只留审批边、别加对应的直接边。
							</p>
						)}
						{edges.length === 0 ? (
							<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
								还没有转移边。点「新增转移边」加一条。
							</p>
						) : (
							<div className="space-y-2">
								{edges.map((edge) => (
									<div
										key={edge.key}
										className={cn(
											"space-y-2 rounded-xl border p-2.5",
											duplicateKeys.has(edge.key) ? "border-destructive/50 bg-destructive/5" : "border-border",
										)}
									>
										<div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
											<Select
												items={statusOptions}
												value={edge.from || null}
												onValueChange={(next) => patchEdge(edge.key, { from: next ? String(next) : "" })}
											>
												<SelectTrigger size="sm" className="w-full">
													<SelectValue placeholder="从" />
												</SelectTrigger>
												<SelectContent>
													{statusOptions.map((item) => (
														<SelectItem key={item.value} value={item.value}>
															{item.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<ArrowRight className="size-3.5 justify-self-center text-muted-foreground" />
											<Select
												items={statusOptions}
												value={edge.to || null}
												onValueChange={(next) => patchEdge(edge.key, { to: next ? String(next) : "" })}
											>
												<SelectTrigger size="sm" className="w-full">
													<SelectValue placeholder="到" />
												</SelectTrigger>
												<SelectContent>
													{statusOptions.map((item) => (
														<SelectItem key={item.value} value={item.value}>
															{item.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<div className="justify-self-end">
												<ActionButton
													tone="danger"
													onClick={() => setEdges((prev) => prev.filter((item) => item.key !== edge.key))}
												>
													删除
												</ActionButton>
											</div>
										</div>
										<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
											<Select
												items={VIA_OPTIONS}
												value={edge.via}
												onValueChange={(next) => patchEdge(edge.key, { via: next === "action" ? "action" : "direct" })}
											>
												<SelectTrigger size="sm" className="w-28">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{VIA_OPTIONS.map((item) => (
														<SelectItem key={item.value} value={item.value}>
															{item.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											{edge.via === "action" ? (
												<span className="text-xs text-muted-foreground">发起后经「待审批」再结算</span>
											) : null}
											{/* `who` 的含义随 via 变:直接改是"谁能改",审批是"谁能发起" */}
											<span className="text-xs text-muted-foreground">
												{edge.via === "action" ? "谁可发起审批" : "谁可直接改"}
											</span>
											{WHO_OPTIONS.map((option) => (
												<span key={option.value} className="flex items-center gap-1.5">
													<Checkbox
														aria-label={`选择${option.label}`}
														checked={edge.who.includes(option.value)}
														onCheckedChange={(checked) => toggleWho(edge.key, option.value, checked === true)}
													/>
													<button
														type="button"
														tabIndex={-1}
														className="text-xs text-foreground"
														onClick={() => toggleWho(edge.key, option.value, !edge.who.includes(option.value))}
													>
														{option.label}
													</button>
												</span>
											))}
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button
						disabled={pending || !canSubmit}
						onClick={() =>
							onSubmit({
								name: name.trim(),
								statuses,
								initial,
								edges: edges.map((edge) => ({ from: edge.from, to: edge.to, who: edge.who, via: edge.via })),
							})
						}
					>
						{pending ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
