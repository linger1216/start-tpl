/**
 * 「按这个人的上下文算」面板 —— 当前唯一调用方是值域插件的预览弹窗
 *(数据范围预览弹窗自铺的上下文段落没有这里的分组细节,属低度重复,不强合并)。
 *
 * 后端 (`buildPolicyCtx`) 把"我 + 我的角色 + 我的部门祖先链 + 我的部门children"
 * 装成一个对象:`ctx.user` / `ctx.roles[]` / `ctx.depts[]`(祖先链)/ `ctx.descendants[]`(子孙)。
 *
 * 前端这层**只认英文 prop**(`ancestors` / `departmentChildren`),UI 标签按 user 要求用中文:
 *
 *   - 部门祖先  = `ancestors`(根 → 我,我所属那段高亮)
 *   - 部门children = `departmentChildren`(扁平,我 + 子孙,我所属那段高亮)
 *
 * 后端响应字段已经同步(`ancestors` / `children`),父组件照此传(`children` 这一侧再加一层
 * `departmentChildren` 别名,因为 Biome `noChildrenProp` 规则不允许把响应字段 `children`
 * 直接当 prop 名)。`ctx.depts` / `ctx.descendants` 仍是底层数据模型(没动,改动会牵动引擎 +
 * 插件代码),只在「给 UI 看」这一步换名字。
 */
import { Building2, ChevronRight, User } from "lucide-react";

import { Tag } from "#/components/ui/tag";
import { cn } from "#/lib/utils";

type PolicyContextBlockProps = {
	/** 后端回的人话:有名字显示名字,库里查不到就退化成 id(`data-scope.ts:171` 同款) */
	userName: string;
	/** 「这是我本人」or「这是别人」—— 决定徽标文案,不影响数据 */
	isMe: boolean;
	/** 后端已经解好的角色名列表(去重后按 `sort, name` 排序过) */
	roles: string[];
	/**
	 * 部门祖先 —— 根在前;`mine=true` 是「我所属的」那段(叶节点),其余是它的祖先链。
	 * 后端响应字段已统一用 `ancestors`(不叫 `depts`,跟 `children` 形成对称)。
	 */
	ancestors: Array<{ name: string; mine: boolean }>;
	/**
	 * 部门children —— 「我的部门及以下」的扁平列表(我 + 子孙,去重)。
	 * 父组件传名字(`{ name, mine }`);前端只渲染,不查库。
	 *
	 * ⚠️ 不用 `children` 这个 prop 名 —— Biome `noChildrenProp` 把它当 React `children`
	 * 重载禁止,改叫 `departmentChildren` 避开。响应字段还是 `children`。
	 */
	departmentChildren: Array<{ name: string; mine: boolean }>;
	/** 紧凑还是宽松 —— 两个预览弹窗都传 `compact`;默认的宽松留给以后的主面板 */
	density?: "compact" | "roomy";
	className?: string;
};

export function PolicyContextBlock({
	userName,
	isMe,
	roles,
	ancestors,
	departmentChildren,
	density = "roomy",
	className,
}: PolicyContextBlockProps) {
	const whoLabel = isMe ? "我本人" : "换人试算";
	const roleCount = roles.length;
	const ancestorCount = ancestors.length;
	const childCount = departmentChildren.length;
	return (
		<div
			className={cn(
				"flex flex-col rounded-lg border border-border/60 bg-muted/30",
				density === "roomy" ? "gap-3 p-3" : "gap-2 p-2.5",
				className,
			)}
		>
			<Row icon={<User className="size-3.5" />} label={whoLabel}>
				<span className="text-foreground">{userName || "—"}</span>
			</Row>

			<Row icon={<Tag className="bg-hue-teal-soft text-hue-teal-fg text-xs">角色</Tag>} label={`${roleCount} 个`}>
				{roleCount === 0 ? (
					<span className="text-muted-foreground">—</span>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{roles.map((name) => (
							<Tag key={name} variant="secondary" className="text-xs">
								{name}
							</Tag>
						))}
					</div>
				)}
			</Row>

			<Row icon={<Building2 className="size-3.5 text-hue-violet-fg" />} label={`部门祖先(${ancestorCount})`}>
				{ancestorCount === 0 ? (
					<span className="text-muted-foreground">—</span>
				) : (
					<div className="flex flex-wrap items-center gap-x-1 gap-y-1">
						{ancestors.map((dept, index) => (
							<span key={`anc-${dept.name}`} className="inline-flex items-center gap-1">
								{index > 0 ? <ChevronRight className="size-3 text-muted-foreground/60" /> : null}
								{dept.mine ? (
									<Tag className="bg-hue-amber-soft text-hue-amber-fg border-hue-amber-border text-xs font-medium">
										{dept.name}
										<span className="ml-1 text-xs font-normal opacity-80">我所属</span>
									</Tag>
								) : (
									<span className="text-foreground/80">{dept.name}</span>
								)}
							</span>
						))}
					</div>
				)}
			</Row>

			<Row icon={<Building2 className="size-3.5 text-hue-violet-fg" />} label={`部门children(${childCount})`}>
				{childCount === 0 ? (
					<span className="text-muted-foreground">—</span>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{departmentChildren.map((dept) => (
							<Tag
								key={`${dept.name}-${dept.mine ? "mine" : "sub"}`}
								className={cn(
									"text-xs font-medium",
									dept.mine
										? "bg-hue-amber-soft text-hue-amber-fg border-hue-amber-border"
										: "bg-hue-violet-soft text-hue-violet-fg border-hue-violet-border",
								)}
							>
								{dept.name}
								{dept.mine ? <span className="ml-1 text-xs font-normal opacity-80">我所属</span> : null}
							</Tag>
						))}
					</div>
				)}
			</Row>
		</div>
	);
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<span className="inline-flex items-center justify-center">{icon}</span>
				<span>{label}</span>
			</div>
			<div className="pl-5 text-sm">{children}</div>
		</div>
	);
}
