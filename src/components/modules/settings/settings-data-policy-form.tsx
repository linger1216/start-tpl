import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { MultiSelect, type MultiSelectOption } from "#/components/modules/shared/multi-select";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { useTRPC } from "#/integrations/trpc/react";
import {
	ACTION_LABEL,
	EFFECT_LABEL,
	POLICY_ACTIONS,
	POLICY_EFFECTS,
	POLICY_MAX_RULES,
	POLICY_RESOURCES,
	POLICY_SCOPE_KINDS,
	POLICY_SUBJECT_KINDS,
	type PolicyAction,
	type PolicyEffect,
	type PolicyRowView,
	type PolicyScopeKind,
	type PolicySubjectKind,
	RESOURCE_KIND_LABEL,
	SUBJECT_KIND_LABEL,
} from "#/lib/data-policy-spec";

/** 「全部资源」在下拉里要有个值(`null` 表达"不挑资源",Base UI 的 Select 不认 null) */
const ALL_RESOURCES = "__all__";

/**
 * 新增态的一张**资源卡**:一类资源 + 一个范围 + 一个动作 / 效果。
 *
 * 为什么不是一个平铺字段集:一个主体要 A B C D 四份授权,这四份常常**类型 / 范围 / 动作都不一样**
 * (整类只读 + 某几行可写…),平铺字段一次只能表达一种,界面就得"保存 → 关弹窗 → 再选一次主体"。
 */
export type PolicyResourceCard = {
	/** `null` = 全部资源(`*`) */
	resourceType: string | null;
	scopeKind: PolicyScopeKind;
	scopeIds: string[];
	action: PolicyAction;
	effect: PolicyEffect;
};

/** 新增:一批资源卡 × 多选主体,一次调用落完 */
export type PolicyCreatePayload = {
	subKind: PolicySubjectKind;
	subjectIds: string[];
	resources: PolicyResourceCard[];
	remark?: string;
};

/** 编辑:一行,连唯一键(主体 / 资源 / 动作)一起改 */
export type PolicyUpdatePayload = {
	subKind: PolicySubjectKind;
	subjectIds: string[];
	resourceType: string | null;
	scopeKind: PolicyScopeKind;
	scopeIds: string[];
	action: PolicyAction;
	effect: PolicyEffect;
	/** 1 启用 / 0 停用(表里的 `status`) */
	status: number;
	remark?: string;
};

/** 三个下拉的选项 —— `items` 与 `<SelectItem>` **两边都要给**(Base UI 不从子元素收集 label,踩过) */
const SUBJECT_ITEMS = POLICY_SUBJECT_KINDS.map((kind) => ({
	value: kind,
	label: SUBJECT_KIND_LABEL[kind],
}));

const SCOPE_ITEMS = POLICY_SCOPE_KINDS.map((kind) => ({
	value: kind,
	label: RESOURCE_KIND_LABEL[kind],
}));

const ACTION_ITEMS = POLICY_ACTIONS.map((act) => ({ value: act, label: ACTION_LABEL[act] ?? act }));

const EFFECT_ITEMS = POLICY_EFFECTS.map((eft) => ({ value: eft, label: EFFECT_LABEL[eft] }));

/** 资源下拉:`null` = 全部资源(`*`),其余是引擎**已登记**的类型 */
const ALL_RESOURCE_ITEMS = [
	{ value: ALL_RESOURCES, label: "全部资源" },
	...Object.entries(POLICY_RESOURCES).map(([value, meta]) => ({ value, label: meta.label })),
];

/**
 * 编辑态把"当前值"补进候选里。
 *
 * 为什么需要:候选名单是**按需查**的(`user.list` 还带着行级数据权限),可能出现"这行规则指向的对象
 * 不在候选名单里"(比如是别人建的、或不在自己的数据范围内)。不补的话单选控件会显示成空 ——
 * 看着像没选,其实值还在 state 里,保存时会用旧值,界面与行为不一致最容易误导人。
 */
function withCurrent(
	options: MultiSelectOption[],
	value: string | null,
	label: string | null | undefined,
): MultiSelectOption[] {
	if (!value || options.some((option) => option.value === value)) return options;
	return [{ value, label: label || value }, ...options];
}

/** 新增态的第一张卡:给一套能直接用的默认值(网格履职 + 按组织) */
function newCard(): PolicyResourceCard {
	return { resourceType: "demo_grid", scopeKind: "org", scopeIds: [], action: "*", effect: "allow" };
}

/** 这一张卡会生成几条规则(整类型 / 全部资源 = 1 条,按组织 / 按行 = 对象个数) */
function rowsOfCard(card: PolicyResourceCard): number {
	return card.resourceType && card.scopeKind !== "type" ? card.scopeIds.length : 1;
}

/**
 * 规则表单 —— 同时服务「新增规则」与「改一条规则」。
 *
 * **新增是"一个主体 × 多类资源"一次落完**(`create`):每类资源各自选范围 / 动作 / 效果,
 * 底部实时汇总「将新增 N 条」。为什么不做"一次只加一条":库里几十条规则里,「给这个人配齐
 * 网格履职的整类只读 + 三个街镇的可写 + 用户管理的整类」这种活是常态 —— 逐条点太慢。
 * 代价是选择会叉积(主体 × 每类资源的对象数),所以上下限都摆在明面上:单条上限
 * `POLICY_MAX_SCOPES = 50`、总量上限 `POLICY_MAX_RULES = 200`(服务端用同一份常量再拦一道)。
 *
 * **编辑态仍是单行**(`update`),但三要素(主体 / 资源 / 动作)也可以改 —— 语义上是**把这行规则
 * 搬到新的键上**:服务端会先查目标键是否已存在(撞了报冲突,提示直接删旧的那条)。因为 `(v0,v1,v2)`
 * 是唯一键,编辑一次只能搬一条,所以主体与范围在编辑态都退化成单值选择。
 */
export function SettingsDataPolicyForm({
	row,
	creating,
	open,
	pending,
	onOpenChange,
	onCreate,
	onUpdate,
}: {
	/** 编辑哪一行(creating 时忽略) */
	row: PolicyRowView | null;
	creating: boolean;
	open: boolean;
	pending: boolean;
	onOpenChange: (next: boolean) => void;
	onCreate: (payload: PolicyCreatePayload) => void;
	onUpdate: (payload: PolicyUpdatePayload) => void;
}) {
	const trpc = useTRPC();
	// ── 两种形态共用的那一半:授权给谁、说明 ──
	const [subKind, setSubKind] = useState<PolicySubjectKind>("user");
	const [subjectIds, setSubjectIds] = useState<string[]>([]);
	const [remark, setRemark] = useState("");
	// ── 新增态:资源卡列表(每张卡自己的范围 / 动作 / 效果)──
	const [cards, setCards] = useState<PolicyResourceCard[]>([newCard()]);
	const cardKeys = useStableKeys(cards.length, "policy-card");
	// ── 编辑态:单行的资源 / 范围 / 动作 / 效果 / 启用 ──
	const [resourceType, setResourceType] = useState<string | null>("demo_grid");
	const [scopeKind, setScopeKind] = useState<PolicyScopeKind>("org");
	const [scopeIds, setScopeIds] = useState<string[]>([]);
	const [action, setAction] = useState<PolicyAction>("*");
	const [effect, setEffect] = useState<PolicyEffect>("allow");
	const [status, setStatus] = useState(true);

	// ── 候选名单(按需加载:这个页面上「选部门」一次要拉 3700 个节点,不该在打开页面时就拉)──
	// 新增态要按**每一张卡**判断需不需要,否则"选了按组织"的那张卡会拿到空候选
	const needDepts =
		subKind === "dept" || (creating ? cards.some((card) => card.scopeKind === "org") : scopeKind === "org");
	const needUsers =
		subKind === "user" ||
		(creating
			? cards.some((card) => card.resourceType === "sys_user" && card.scopeKind === "row")
			: resourceType === "sys_user" && scopeKind === "row");
	const needGrids = creating
		? cards.some((card) => card.resourceType === "demo_grid" && card.scopeKind === "row")
		: resourceType === "demo_grid" && scopeKind === "row";
	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: open && needUsers });
	const rolesQuery = useQuery({ ...trpc.role.list.queryOptions(), enabled: open && subKind === "role" });
	const deptsQuery = useQuery({ ...trpc.department.tree.queryOptions(), enabled: open && needDepts });
	const gridsQuery = useQuery({ ...trpc.demoGrid.list.queryOptions(), enabled: open && needGrids });

	const userOptions = useMemo<MultiSelectOption[]>(
		() => (usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.name || user.email, hint: user.email })),
		[usersQuery.data],
	);
	const roleOptions = useMemo<MultiSelectOption[]>(
		() => (rolesQuery.data ?? []).map((role) => ({ value: role.code, label: role.name, hint: role.code })),
		[rolesQuery.data],
	);
	// 部门重名很常见(每个街镇都有一个"网格组"),所以带一个"上级"提示帮助分辨 —— 与用户管理同口径
	const deptOptions = useMemo<MultiSelectOption[]>(() => {
		const rows = deptsQuery.data ?? [];
		const nameOf = new Map(rows.map((node) => [node.id, node.name]));
		return rows.map((node) => ({
			value: node.id,
			label: node.name,
			hint: node.parentId ? (nameOf.get(node.parentId) ?? undefined) : undefined,
		}));
	}, [deptsQuery.data]);
	const gridOptions = useMemo<MultiSelectOption[]>(
		() =>
			(gridsQuery.data ?? []).map((grid) => ({
				value: grid.id,
				label: grid.name,
				hint: grid.townName || undefined,
			})),
		[gridsQuery.data],
	);

	/** 主体候选:按种类切换 */
	const subjectOptions =
		subKind === "user" ? userOptions : subKind === "role" ? roleOptions : subKind === "dept" ? deptOptions : [];
	/** 范围候选:按资源类型切换(整类型与「全部资源」不需要选具体对象) */
	const scopeOptionsOf = (type: string | null, kind: PolicyScopeKind) =>
		kind === "org" ? deptOptions : type === "sys_user" ? userOptions : gridOptions;

	const subjectPlaceholder = subKind === "dept" ? "搜索部门…" : subKind === "role" ? "搜索角色…" : "搜索用户…";
	const scopePlaceholder = (kind: PolicyScopeKind) => (kind === "org" ? "搜索组织…" : "搜索数据行…");
	/** 编辑态:候选是按需查的,可能不含这一条,所以把当前值补进去(否则单选控件显示成空) */
	const subjectChoices = withCurrent(
		subjectOptions,
		row && row.subjectKind === subKind ? row.subjectId : null,
		row?.subjectLabel,
	);
	const scopeChoices = withCurrent(
		scopeOptionsOf(resourceType, scopeKind),
		row && row.resourceType === resourceType && row.resourceKind === scopeKind ? row.resourceId : null,
		row?.resourceDetail,
	);

	useEffect(() => {
		if (!open) return;
		setSubKind(row?.subjectKind === "all" ? "all" : (row?.subjectKind ?? "user"));
		setSubjectIds(row?.subjectId && row.subjectKind !== "all" ? [row.subjectId] : []);
		setRemark(row?.remark ?? "");
		// 新增态每次打开都从一张干净的卡开始(不记住上一次的选择:那更可能是"上一次忘了改"的隐患)
		setCards([newCard()]);
		// 编辑态
		setResourceType(row ? row.resourceType : "demo_grid");
		setScopeKind(row && row.resourceKind !== "all" ? row.resourceKind : "type");
		setScopeIds(row?.resourceId && row.resourceKind !== "type" ? [row.resourceId] : []);
		setAction((row?.action ?? "*") as PolicyAction);
		setEffect((row?.effect ?? "allow") as PolicyEffect);
		setStatus((row?.status ?? 1) === 1);
		// `creating` 不进依赖:重新打开表单时 `row` 一定会变(null ⇄ 行),用 `row` 就够覆盖两种打开方式
	}, [open, row]);

	/** 主体个数:授给「所有人」只有一条 `*` 规则 */
	const subjectCount = subKind === "all" ? 1 : subjectIds.length;
	/** 这批选择会生成多少条规则(服务端用同一个 `POLICY_MAX_RULES` 再拦一道) */
	const ruleCount = subjectCount * cards.reduce((sum, card) => sum + rowsOfCard(card), 0);
	/** 第几张卡还没选具体对象(没选 = 那类资源的按组织 / 按行授权会落空) */
	const missingScope = cards.findIndex(
		(card) => card.resourceType && card.scopeKind !== "type" && card.scopeIds.length === 0,
	);

	const problem = (() => {
		if (subKind !== "all" && subjectIds.length === 0) return "请先选择要授权的对象";
		if (creating) {
			if (cards.length === 0) return "至少配一类资源(点「再加一类资源」)";
			if (missingScope >= 0) return `第 ${missingScope + 1} 类资源还没选具体的组织或数据行`;
			if (ruleCount > POLICY_MAX_RULES) return `一次最多新增 ${POLICY_MAX_RULES} 条规则,当前选择会生成 ${ruleCount} 条`;
			return null;
		}
		// 编辑态:主体 / 资源 / 动作可以改(等于把这行规则搬到新键上),但一次只搬一条
		if (subKind !== "all" && subjectIds.length !== 1) return "编辑一次只能改一行规则:请选中一个主体";
		if (resourceType && scopeKind !== "type" && scopeIds.length !== 1)
			return "编辑一次只能改一行规则:请选中一个组织或数据行";
		return null;
	})();

	/** 改某一张卡的字段(资源类型变了就把范围重置成"整类型") */
	function patchCard(index: number, patch: Partial<PolicyResourceCard>) {
		setCards((prev) => prev.map((card, i) => (i === index ? { ...card, ...patch } : card)));
	}

	function handleSubmit() {
		if (problem) return;
		const trimmed = remark.trim() || undefined;
		if (creating) {
			onCreate({
				subKind,
				subjectIds,
				// 「全部资源」没有范围可言,统一归到"整类型"的语义上(界面上的残留选择不带出去)
				resources: cards.map((card) => ({
					...card,
					scopeKind: card.resourceType ? card.scopeKind : "type",
					scopeIds: card.resourceType ? card.scopeIds : [],
				})),
				remark: trimmed,
			});
			return;
		}
		onUpdate({
			subKind,
			subjectIds,
			resourceType,
			scopeKind: resourceType ? scopeKind : "type",
			scopeIds: resourceType ? scopeIds : [],
			action,
			effect,
			status: status ? 1 : 0,
			remark: trimmed,
		});
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{creating ? "新增数据权限规则" : "修改数据权限规则"}</DialogTitle>
					<DialogDescription>
						{creating
							? "一个主体可以一次配多类资源:每类资源各自选范围 / 动作 / 效果,保存一次全部落库。已存在的规则只保留原样,不会被覆盖。"
							: "改主体 / 资源 / 动作 = 把这行规则搬到新的键上;目标键已存在会提示冲突。"}
					</DialogDescription>
				</DialogHeader>

				{/* 字段区自己滚(弹窗本身永不出滚动条)—— 卡片多了高度不失控 */}
				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
					<DetailRow label="授权给" htmlFor="policy-subject-kind">
						<Select
							items={SUBJECT_ITEMS}
							value={subKind}
							onValueChange={(next) => {
								setSubKind(next as PolicySubjectKind);
								setSubjectIds([]);
							}}
						>
							<SelectTrigger id="policy-subject-kind" size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SUBJECT_ITEMS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>

					{subKind === "all" ? (
						<p className="rounded-lg bg-hue-amber-soft px-3 py-2 text-xs text-hue-amber-fg">
							授给「所有人」= 一条 `*` 规则,它会让**每一个**登录账号都命中这份授权;
							通常只有「区级部门看全部」这种口径才这么写,单个人的权限请选「用户」。
						</p>
					) : (
						<DetailRow label="选中对象">
							{creating ? (
								<MultiSelect
									options={subjectOptions}
									value={subjectIds}
									onChange={setSubjectIds}
									placeholder={subjectPlaceholder}
								/>
							) : (
								<SearchSelect
									value={subjectIds[0]}
									onValueChange={(next) => setSubjectIds([next])}
									options={subjectChoices}
									placeholder={subjectPlaceholder}
								/>
							)}
						</DetailRow>
					)}

					{creating ? (
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-medium text-foreground">资源(一类一行,每行自己的范围 / 动作 / 效果)</span>
								<ActionButton
									onClick={() =>
										setCards((prev) => {
											const last = prev[prev.length - 1];
											// 新行继承上一行的类型 / 动作 / 效果,只把对象清空(下一个街镇接着选)
											return [...prev, last ? { ...last, scopeIds: [] } : newCard()];
										})
									}
								>
									再加一类资源
								</ActionButton>
							</div>

							{cards.length === 0 ? (
								<p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
									还没有任何资源(至少配一类才能保存)。
								</p>
							) : null}

							{cards.map((card, index) => (
								<div key={cardKeys[index]} className="space-y-3 rounded-lg border border-border p-3">
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs text-muted-foreground">
											第 {index + 1} 类资源
											<span className="ml-2 tabular-nums">
												{card.scopeKind !== "type" && card.resourceType ? `${card.scopeIds.length} 个对象` : "整类"}
											</span>
										</span>
										<ActionButton
											tone="danger"
											aria-label={`删除第 ${index + 1} 类资源`}
											onClick={() => setCards((prev) => prev.filter((_, i) => i !== index))}
										>
											删除
										</ActionButton>
									</div>

									<DetailRow label="资源">
										<Select
											items={ALL_RESOURCE_ITEMS}
											value={card.resourceType ?? ALL_RESOURCES}
											onValueChange={(next) =>
												patchCard(index, {
													resourceType: next === ALL_RESOURCES ? null : next,
													scopeKind: "type",
													scopeIds: [],
												})
											}
										>
											<SelectTrigger size="sm" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{ALL_RESOURCE_ITEMS.map((item) => (
													<SelectItem key={item.value} value={item.value}>
														{item.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</DetailRow>

									{card.resourceType ? (
										<>
											<DetailRow label="范围">
												<Select
													items={SCOPE_ITEMS}
													value={card.scopeKind}
													onValueChange={(next) =>
														patchCard(index, { scopeKind: next as PolicyScopeKind, scopeIds: [] })
													}
												>
													<SelectTrigger size="sm" className="w-full">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{SCOPE_ITEMS.map((item) => (
															<SelectItem key={item.value} value={item.value}>
																{item.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</DetailRow>

											{card.scopeKind !== "type" ? (
												<DetailRow label={card.scopeKind === "org" ? "组织及以下" : "具体数据行"}>
													<MultiSelect
														options={scopeOptionsOf(card.resourceType, card.scopeKind)}
														value={card.scopeIds}
														onChange={(next) => patchCard(index, { scopeIds: next })}
														placeholder={scopePlaceholder(card.scopeKind)}
													/>
												</DetailRow>
											) : null}
										</>
									) : null}

									<div className="grid grid-cols-2 gap-3">
										<DetailRow label="动作">
											<Select
												items={ACTION_ITEMS}
												value={card.action}
												onValueChange={(next) => patchCard(index, { action: (next ?? "*") as PolicyAction })}
											>
												<SelectTrigger size="sm" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{ACTION_ITEMS.map((item) => (
														<SelectItem key={item.value} value={item.value}>
															{item.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</DetailRow>
										<DetailRow label="效果">
											<Select
												items={EFFECT_ITEMS}
												value={card.effect}
												onValueChange={(next) => patchCard(index, { effect: next as PolicyEffect })}
											>
												<SelectTrigger size="sm" className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{EFFECT_ITEMS.map((item) => (
														<SelectItem key={item.value} value={item.value}>
															{item.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</DetailRow>
									</div>
								</div>
							))}
						</div>
					) : (
						<>
							<DetailRow label="资源">
								<Select
									items={ALL_RESOURCE_ITEMS}
									value={resourceType ?? ALL_RESOURCES}
									onValueChange={(next) => {
										setResourceType(next === ALL_RESOURCES ? null : next);
										setScopeKind("type");
										setScopeIds([]);
									}}
								>
									<SelectTrigger size="sm" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{ALL_RESOURCE_ITEMS.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</DetailRow>

							{resourceType ? (
								<>
									<DetailRow label="范围">
										<Select
											items={SCOPE_ITEMS}
											value={scopeKind}
											onValueChange={(next) => {
												setScopeKind(next as PolicyScopeKind);
												setScopeIds([]);
											}}
										>
											<SelectTrigger size="sm" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{SCOPE_ITEMS.map((item) => (
													<SelectItem key={item.value} value={item.value}>
														{item.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</DetailRow>

									{scopeKind !== "type" ? (
										<DetailRow label={scopeKind === "org" ? "组织及以下" : "具体数据行"}>
											<SearchSelect
												value={scopeIds[0]}
												onValueChange={(next) => setScopeIds([next])}
												options={scopeChoices}
												placeholder={scopePlaceholder(scopeKind)}
											/>
										</DetailRow>
									) : null}
								</>
							) : null}

							<div className="grid grid-cols-2 gap-3">
								<DetailRow label="动作">
									<Select
										items={ACTION_ITEMS}
										value={action}
										onValueChange={(next) => setAction((next ?? "*") as PolicyAction)}
									>
										<SelectTrigger size="sm" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ACTION_ITEMS.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</DetailRow>
								<DetailRow label="效果">
									<Select items={EFFECT_ITEMS} value={effect} onValueChange={(next) => setEffect(next as PolicyEffect)}>
										<SelectTrigger size="sm" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{EFFECT_ITEMS.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</DetailRow>
							</div>

							<DetailRow label="启用">
								<Switch aria-label="启用" checked={status} onCheckedChange={setStatus} />
							</DetailRow>
						</>
					)}

					<DetailRow label="说明" htmlFor="policy-remark">
						<Input
							id="policy-remark"
							value={remark}
							placeholder="如:借调古美路街道网格,帮看两个月"
							className="text-xs"
							onChange={(event) => setRemark(event.target.value)}
						/>
					</DetailRow>

					{creating ? (
						problem ? (
							<p className="text-xs text-destructive">{problem}</p>
						) : (
							<p className="text-xs text-muted-foreground">
								将新增 {ruleCount} 条规则:
								{subKind === "all" ? "所有人" : `${subjectCount} 个主体`} × {cards.length} 类资源
								{cards.some((card) => card.effect === "deny") ? "(含拒绝规则:从可见集合里做减法)" : ""}。
							</p>
						)
					) : null}
				</div>

				{row ? <DetailMeta meta={{ createdAt: row.createdAt, updatedAt: row.updatedAt }} /> : null}
				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={pending || Boolean(problem)} onClick={handleSubmit}>
						{pending ? "保存中…" : creating ? "创建" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
