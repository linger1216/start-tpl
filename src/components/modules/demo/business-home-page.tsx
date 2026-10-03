import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, Building2, ChevronRight, Shield, Users } from "lucide-react";
import { PageHeader } from "#/components/layout/page-header";
import { StatCards, type StatItem } from "#/components/modules/shared/stat-cards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { useTRPC } from "#/integrations/trpc/react";
import { noticeLevelStyle } from "#/lib/notice-levels";
import { formatLocalMinute } from "#/lib/time";

/**
 * 业务首页示范 —— 「派生新项目后,把它改成真的 `routes/(main)/index.tsx`」。
 *
 * 设计意图:
 *  - 用现有 tRPC procedure 直读真库,**只统计数 + 拿最近 5 条**,首屏出结果前不必再来一轮 query
 *  - 三段布局:**顶部 4 张统计卡** → **「我的通知」+「最近操作」两栏并排** → **4 个常用入口**
 *  - 整页放在 max-w-6xl 的容器里,不撑满 —— 后台首页不该像工作台那么宽,信息密度要上去
 *
 * 派生时改 4 处:
 *  1. 删下面 4 个 `useQuery`(换成你自己的真实数据源 —— 比如「今日订单 / 今日 GMV / 待办数 / 在线用户」);
 *  2. 把统计卡的 label / Icon / tone 换成业务指标;
 *  3. 「我的通知」那一栏可保留(铃铛同源)、或换成「待办」;
 *  4. 「最近操作」换成「最近订单 / 客户动态」之类。
 */
export function BusinessHomeDemo() {
	const trpc = useTRPC();

	// 注意:这几个 query 都接受 `limit` —— 这里只用来算「行数」,真实首屏出几张卡要多少行由调用方控制。
	// 派生项目换成「今日订单 / 在线会话」之类,也是 1 条 query 就够,不用为每张卡单独写 procedure。
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	const deptsQuery = useQuery(trpc.department.tree.queryOptions());
	const rolesQuery = useQuery(trpc.role.list.queryOptions());
	const noticeQuery = useQuery(trpc.notice.list.queryOptions({ limit: 5 }));
	const logQuery = useQuery(trpc.log.list.queryOptions({ limit: 5 }));

	const stats: StatItem[] = [
		{
			key: "users",
			label: "用户总数",
			value: usersQuery.data?.length ?? 0,
			unit: "人",
			Icon: Users,
			tone: "bg-hue-blue-soft text-hue-blue-fg",
		},
		{
			key: "depts",
			label: "部门总数",
			value: deptsQuery.data?.length ?? 0,
			unit: "个",
			Icon: Building2,
			tone: "bg-hue-teal-soft text-hue-teal-fg",
		},
		{
			key: "roles",
			label: "角色总数",
			value: rolesQuery.data?.length ?? 0,
			unit: "个",
			Icon: Shield,
			tone: "bg-hue-violet-soft text-hue-violet-fg",
		},
		{
			key: "unread",
			label: "未读通知",
			value: noticeQuery.data?.unread ?? 0,
			unit: "条",
			Icon: Bell,
			tone: "bg-hue-amber-soft text-hue-amber-fg",
		},
	];

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
			<PageHeader
				title="业务首页示范"
				description="派生新项目后,把这一页搬到 routes/(main)/index.tsx,改 4 个 query 就是你的真首页。"
				descriptionInline
			/>

			<StatCards items={stats} />

			{/* 双栏:左边「我的通知」、右边「最近操作」—— 桌面端并排,小屏堆叠 */}
			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">我的通知</CardTitle>
						<CardDescription>从铃铛同源取数,后台首页 / 顶栏共享未读。</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						{noticeQuery.isPending ? (
							<div className="space-y-2">
								<div className="skeleton-shimmer h-4 rounded bg-muted" />
								<div className="skeleton-shimmer h-4 rounded bg-muted" />
								<div className="skeleton-shimmer h-4 rounded bg-muted" />
							</div>
						) : (noticeQuery.data?.items ?? []).length === 0 ? (
							<p className="text-sm text-muted-foreground">没有新通知 —— 休息一下吧。</p>
						) : (
							<ul className="divide-y divide-border">
								{(noticeQuery.data?.items ?? []).map((item) => {
									const levelStyle = noticeLevelStyle(item.level);
									const LevelIcon = levelStyle.Icon;
									return (
										<li key={item.id} className="flex items-start gap-2.5 py-2.5">
											<LevelIcon className={`mt-0.5 size-3.5 shrink-0 ${levelStyle.tone}`} aria-hidden />
											<div className="min-w-0 flex-1">
												<div className="flex items-baseline justify-between gap-2">
													<span className="truncate font-medium text-foreground">{item.title}</span>
													<span className="shrink-0 text-xs text-muted-foreground">
														{item.createTime ? formatLocalMinute(item.createTime) : ""}
													</span>
												</div>
												<p className="line-clamp-1 text-xs text-muted-foreground">{item.body}</p>
											</div>
										</li>
									);
								})}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">最近操作</CardTitle>
						<CardDescription>审计日志最新 5 条 —— 同样在「系统设置 ▸ 审计日志」可看全量。</CardDescription>
					</CardHeader>
					<CardContent className="pt-0">
						{logQuery.isPending ? (
							<div className="space-y-2">
								<div className="skeleton-shimmer h-4 rounded bg-muted" />
								<div className="skeleton-shimmer h-4 rounded bg-muted" />
								<div className="skeleton-shimmer h-4 rounded bg-muted" />
							</div>
						) : (logQuery.data ?? []).length === 0 ? (
							<p className="text-sm text-muted-foreground">暂无操作记录。</p>
						) : (
							<ul className="divide-y divide-border">
								{(logQuery.data ?? []).map(
									(item: {
										id: string;
										operatorName: string | null;
										label: string | null;
										createTime: string | null;
									}) => (
										<li key={item.id} className="flex items-baseline justify-between gap-2 py-2 text-sm">
											<span className="truncate">
												<span className="font-medium text-foreground">{item.operatorName ?? "—"}</span>
												<span className="ml-1.5 text-muted-foreground">{item.label}</span>
											</span>
											<span className="shrink-0 text-xs text-muted-foreground">
												{item.createTime ? formatLocalMinute(item.createTime) : ""}
											</span>
										</li>
									),
								)}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>

			{/* 快捷入口 —— 4 个最常用的设置页 */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">常用入口</CardTitle>
					<CardDescription>点击直接跳过去。派生后换成你业务里最常用的 4 项。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						{QUICK_LINKS.map((link) => (
							<Link
								key={link.to}
								to={link.to}
								className="group flex items-center gap-3 rounded-xl border border-border p-3 transition-[background-color,border-color,box-shadow] duration-150 hover:border-border-strong hover:bg-secondary hover:shadow-raise-1"
							>
								<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary ring-1 ring-border ring-inset">
									<link.icon className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-foreground">{link.title}</div>
									<p className="text-xs text-muted-foreground">{link.desc}</p>
								</div>
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
							</Link>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

const QUICK_LINKS = [
	{
		to: "/settings/users",
		title: "用户管理",
		desc: "账号、姓名、所属部门",
		icon: Users,
	},
	{
		to: "/settings/departments",
		title: "部门管理",
		desc: "组织树 / 部门成员",
		icon: Building2,
	},
	{
		to: "/settings/roles",
		title: "角色管理",
		desc: "权限点 / 角色成员",
		icon: Shield,
	},
	{
		to: "/notices",
		title: "通知中心",
		desc: "发通知 / 看已读",
		icon: Bell,
	},
] as const;
