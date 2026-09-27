import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { SearchSelect } from "#/components/ui/search-select";
import { useTRPC } from "#/integrations/trpc/react";
import { EffectBadge, SubjectKindBadge } from "./settings-data-policy-badges";

/**
 * 「谁能看到什么」—— 选一个人,把判定链整条摊开。
 *
 * 界面上一共四段,顺序就是判定顺序(**与 `dataScopeWhere` 逐条对齐**):
 *  1. **主体集合**:这个人会以哪些身份去命中规则(`*` / 本人 / 他的角色 / 他的部门及祖先);
 *  2. **命中规则**:这些主体在策略表里的**全部**规则(含停用与备注,便于解释"为什么没生效");
 *  3. **每个资源的结论**:判定链吃出来的是"不限制 / 受范围限制 / 一条看不到";
 *  4. **实测条数**:用编译出来的条件真去 `count(*)` —— 列表接口会返回几行,这里就是几行。
 *
 * 它是排障入口,不是权限编辑器:只读,不改任何东西。数字**实测**而不是推算 —— 这正是
 * `tests/data-policy.test.ts` 之外,给运维留的第二双眼睛。
 */
export function SettingsDataPolicyExplain({
	open,
	onOpenChange,
	initialUserId,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	/** 从某条"按人授权"的规则点进来时,默认就试算这个人(`null` = 没带人进来) */
	initialUserId?: string | null;
}) {
	const trpc = useTRPC();
	// 「没选人」在这一件里**只有一个写法:空串**;控件要的 `undefined` 在下面那一处转换,
	// 不让 "" / null / undefined 三种空值在同一个文件里到处跑(以前就是三种混着写)
	const [userId, setUserId] = useState("");

	useEffect(() => {
		if (open) setUserId(initialUserId ?? "");
	}, [open, initialUserId]);

	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: open });
	const explainQuery = useQuery({
		...trpc.policy.explain.queryOptions({ userId }),
		enabled: open && userId.length > 0,
	});
	const data = explainQuery.data;

	const userOptions = (usersQuery.data ?? []).map((user) => ({
		value: user.id,
		label: user.name ? `${user.name}(${user.email})` : user.email,
	}));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>谁能看到什么</DialogTitle>
					<DialogDescription>
						选一个账号,把「他是谁 → 命中哪条规则 → 编译成什么条件 → 实测几行」整条判定链摊开。判定只认 Casbin
						引擎,这里不改任何权限。
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-3">
					<div className="flex items-center gap-2">
						<span className="shrink-0 text-xs text-muted-foreground">账号</span>
						<SearchSelect
							value={userId === "" ? undefined : userId}
							onValueChange={setUserId}
							options={userOptions}
							placeholder="搜索姓名 / 邮箱…"
							triggerClassName="w-full"
						/>
					</div>

					{userId.length === 0 ? (
						<p className="text-xs text-muted-foreground">先选一个账号。</p>
					) : explainQuery.isFetching && !data ? (
						<p className="text-xs text-muted-foreground">读取中…</p>
					) : data ? (
						<div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
							{!data.configured ? (
								<p className="rounded-lg bg-hue-amber-soft px-3 py-2 text-xs text-hue-amber-fg">
									策略表里**一条启用中的规则都没有** —— 数据权限未启用,所有列表都不加范围条件。这与「菜单表为空 =
									菜单未启用」是同一个口径:空表是"还没开始配",不是"谁都看不到"。
								</p>
							) : null}

							<section className="space-y-1.5">
								<div className="text-xs font-medium text-muted-foreground">主体集合 · 共 {data.subjects.length} 个</div>
								<ul className="divide-y divide-border rounded-lg border border-border">
									{data.subjects.map((subject) => (
										<li key={subject.raw} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
											<SubjectKindBadge kind={subject.kind} />
											<span className="text-xs font-medium text-foreground">{subject.label}</span>
											<span translate="no" className="font-mono text-xs text-muted-foreground">
												{subject.raw}
											</span>
											<span className="w-full text-xs text-muted-foreground">{subject.why}</span>
										</li>
									))}
								</ul>
							</section>

							<section className="space-y-1.5">
								<div className="text-xs font-medium text-muted-foreground">命中规则 · 共 {data.rules.length} 条</div>
								{data.rules.length === 0 ? (
									<p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
										没有任何规则命中这个人的主体 —— 也就是说,**每个受管资源的列表都会返回 0
										行**(失败关闭)。想让这个人看到东西,就给他加一条规则。
									</p>
								) : (
									<ul className="divide-y divide-border rounded-lg border border-border">
										{data.rules.map((rule) => (
											<li
												key={`${rule.sub}|${rule.obj}|${rule.act}`}
												className="flex flex-wrap gap-x-2 gap-y-1 px-3 py-2"
											>
												<span translate="no" className="font-mono text-xs text-foreground">
													{rule.sub}
												</span>
												<span className="text-xs text-muted-foreground">→</span>
												<span translate="no" className="font-mono text-xs text-foreground">
													{rule.obj}
												</span>
												<Badge variant="outline" className="shrink-0 text-xs">
													{rule.act}
												</Badge>
												<EffectBadge effect={rule.eft} />
												{rule.remark ? (
													<span className="w-full text-xs text-muted-foreground">{rule.remark}</span>
												) : null}
											</li>
										))}
									</ul>
								)}
							</section>

							<section className="space-y-1.5">
								<div className="text-xs font-medium text-muted-foreground">
									各资源结论 · 数字是**实测**条数(不是推算)
								</div>
								{data.resources.map((resource) => (
									<div key={resource.resourceType} className="space-y-2 rounded-lg border border-border px-3 py-2.5">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-xs font-medium text-foreground">{resource.label}</span>
											<Badge className={`text-xs ${resourceTone(resource, data.configured)}`}>
												{resourceConclusion(resource, data.configured)}
											</Badge>
											<span className="ml-auto tabular-nums text-xs text-muted-foreground">
												可见 {resource.visibleCount} / 共 {resource.totalCount} 条
											</span>
										</div>
										{resource.orgs.length > 0 ? (
											<div className="flex flex-wrap items-center gap-2">
												<span className="shrink-0 text-xs text-muted-foreground">组织及以下</span>
												<BadgeList values={resource.orgs.map((item) => item.label)} layout="wrap" color="ocean" />
											</div>
										) : null}
										{resource.rows.length > 0 ? (
											<div className="flex flex-wrap items-center gap-2">
												<span className="shrink-0 text-xs text-muted-foreground">具体行</span>
												<BadgeList values={resource.rows.map((item) => item.label)} layout="wrap" color="brand" />
											</div>
										) : null}
										{resource.denyOrgs.length > 0 || resource.denyRows.length > 0 ? (
											<div className="flex flex-wrap items-center gap-2">
												<span className="shrink-0 text-xs text-muted-foreground">被拒绝</span>
												<BadgeList
													values={[...resource.denyOrgs, ...resource.denyRows].map((item) => item.label)}
													layout="wrap"
													color="rainbow"
												/>
											</div>
										) : null}
									</div>
								))}
							</section>
						</div>
					) : (
						<p className="text-xs text-destructive">读不到这个账号的数据范围(可能账号已删除)。</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** 结论文案 —— 四种状态与 `dataScopeWhere` 的四条分支一一对应 */
function resourceConclusion(
	resource: { allowed: boolean; unrestricted: boolean; denied: boolean },
	configured: boolean,
): string {
	if (!configured) return "未启用,不过滤";
	if (!resource.allowed) return "一条也看不到(1 = 0)";
	if (resource.denied) return "全部被拒绝(1 = 0)";
	if (resource.unrestricted) return "不受限制";
	return "受范围限制";
}

function resourceTone(
	resource: { allowed: boolean; unrestricted: boolean; denied: boolean },
	configured: boolean,
): string {
	const ok = configured && resource.allowed && !resource.denied;
	if (!ok) return "bg-hue-rose-soft text-hue-rose-fg";
	if (resource.unrestricted) return "bg-hue-blue-soft text-hue-blue-fg";
	return "bg-hue-teal-soft text-hue-teal-fg";
}
