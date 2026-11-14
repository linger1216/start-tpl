import { Trash2, UserPlus } from "lucide-react";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { cn } from "#/lib/utils";

export function TaskMembers({
	creatorId,
	creatorName,
	members,
	canAddMember,
	canManage,
	removing,
	onAdd,
	onRemove,
	onRemind,
	roleText,
}: {
	creatorId: string;
	creatorName: string | null;
	members: Array<{ userId: string; role: string; name: string | null }>;
	canAddMember: boolean;
	canManage: boolean;
	removing: boolean;
	onAdd: () => void;
	onRemove: (member: { userId: string; role: "participant" | "executor"; name: string }) => void;
	onRemind?: (person: { id: string; name: string }) => void;
	roleText: (role: string) => string;
}) {
	return (
		<section className="grid gap-2 p-3.5">
			<header className="flex items-center justify-between">
				<h2 className="inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-base font-semibold tracking-tight text-foreground">
					参与人 <span className="text-xs font-medium tabular-nums text-muted-foreground">{members.length + 1}</span>
				</h2>
				{canAddMember ? (
					<Button size="icon-sm" variant="outline" aria-label="加成员" onClick={onAdd}>
						<UserPlus className="size-3.5" />
					</Button>
				) : null}
			</header>
			<ul className="grid gap-0.5">
				<PeopleRow
					roleLabel="创建人"
					name={creatorName ?? PLACEHOLDER_EMPTY}
					main={false}
					onRemind={onRemind ? () => onRemind({ id: creatorId, name: creatorName ?? PLACEHOLDER_EMPTY }) : undefined}
				/>
				{members.map((m) => (
					<PeopleRow
						key={`${m.userId}-${m.role}`}
						roleLabel={roleText(m.role)}
						name={m.name ?? m.userId}
						main={m.role === "executor"}
						onRemind={onRemind ? () => onRemind({ id: m.userId, name: m.name ?? m.userId }) : undefined}
						onRemove={
							canManage
								? () =>
										onRemove({
											userId: m.userId,
											role: m.role as "participant" | "executor",
											name: m.name ?? m.userId,
										})
								: undefined
						}
						removing={removing}
					/>
				))}
				{members.length === 0 ? (
					<li className="py-3 text-sm text-muted-foreground">还没有其他人。加人后他们能答复动作、参与讨论。</li>
				) : null}
			</ul>
		</section>
	);
}

/**
 * 参与人块里的一行 —— 左侧角色标签 + 右侧人名;`onRemove` 非空时显式给「移出」按钮。
 *
 * 头像与「评论与回复」`TaskComments` 的 `Avatar` **同色**:`bg-primary` + `text-primary-foreground`
 * (品牌蓝底 + 浅字)—— 同一个人在两处长得一样,不额外给主执行人染色。
 * 「主执行」这个身份靠**角色标签**(页面上传的是 `主执行`)+ 名字加粗来区分,不靠颜色。
 *
 * 用 `bg-primary/85` + `text-paper`(`--ink` 底、反白首字同族的墨底圆牌,深色模式自动翻转);
 * **不要写 `bg-accent`** —— 它在本项目是浅灰面 `#f8fafc`,白字压上去直接看不见
 * (原型里的 `--color-accent` 是品牌蓝,与本项目的 `--accent` 同名不同物)。
 *
 * `roleLabel` 不是 HTML `role` 属性 —— prop 名刻意避开 ARIA 关键字,免得 biome 把
 * 「创建人/主执行」之类的中文字面误判成 ARIA role。
 */
function PeopleRow({
	roleLabel,
	name,
	main,
	onRemind,
	onRemove,
	removing,
}: {
	roleLabel: string;
	name: string;
	main: boolean;
	onRemind?: () => void;
	onRemove?: () => void;
	removing?: boolean;
}) {
	return (
		<li className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-hover">
			<span className="w-14 shrink-0 text-xs text-muted-foreground">{roleLabel}</span>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{/* 圆牌:墨底反白首字(与评论头像同款,就地内联 —— badge 合流层已拆) */}
				<span
					aria-hidden
					className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-primary/85 text-xs font-heading font-bold leading-none text-paper"
				>
					{name.slice(0, 1)}
				</span>
				<span className={cn("truncate text-sm text-foreground", main && "font-semibold")}>{name}</span>
			</div>
			{onRemind && (
				<ActionButton aria-label={`提醒${name}`} onClick={onRemind}>
					提醒
				</ActionButton>
			)}
			{onRemove ? (
				<Button variant="ghost" size="icon-sm" aria-label="移出成员" disabled={removing} onClick={onRemove}>
					<Trash2 className="size-3.5" />
				</Button>
			) : null}
		</li>
	);
}
