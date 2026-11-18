import { PanelRightClose, Trash2, UserPlus } from "lucide-react";
import { BlockHeader } from "#/components/modules/task-close/block-header";
import { ActionButton } from "#/components/ui/action-button";
import { Avatar } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { roleLabelOf } from "#/lib/task/close-spec";
import { cn } from "#/lib/utils";

export function TaskMembers({
	creatorId,
	creatorName,
	executorId,
	executorName,
	members,
	canAddMember,
	canManage,
	removing,
	onAdd,
	onRemove,
	onRemind,
	onCollapse,
}: {
	creatorId: string;
	creatorName: string | null;
	/** 唯一执行人(至多一个);与创建人重复时只在创建人那行标注 */
	executorId: string | null;
	executorName: string | null;
	/** 参与者集合(不含创建人 / 执行人) */
	members: Array<{ userId: string; name: string | null }>;
	canAddMember: boolean;
	canManage: boolean;
	removing: boolean;
	onAdd: () => void;
	onRemove: (member: { userId: string; name: string }) => void;
	onRemind?: (person: { id: string; name: string }) => void;
	onCollapse?: () => void;
}) {
	/** fan-out 父任务的执行人就是创建人 —— 这时只在创建人那行标「创建人 · 执行者」,不重复一行 */
	const creatorIsExecutor = !!executorId && executorId === creatorId;
	const showExecutor = !!executorId && executorId !== creatorId;
	const total = new Set([creatorId, ...(executorId ? [executorId] : []), ...members.map((m) => m.userId)]).size;
	return (
		<section className="grid gap-2 p-3.5">
			<BlockHeader
				title="参与人"
				count={total}
				actions={
					<div className="flex items-center gap-1">
						{canAddMember ? (
							<Button size="icon-sm" variant="outline" aria-label="加成员" onClick={onAdd}>
								<UserPlus className="size-3.5" />
							</Button>
						) : null}
						{onCollapse ? (
							<Button
								size="xs"
								variant="ghost"
								className="size-6 p-0 text-muted-foreground"
								aria-label="收起右侧栏"
								title="收起右侧栏"
								onClick={onCollapse}
							>
								<PanelRightClose className="size-3.5" />
							</Button>
						) : null}
					</div>
				}
			/>
			<ul className="grid gap-0.5">
				<PeopleRow
					roleLabel={creatorIsExecutor ? `创建人 · ${roleLabelOf("executor")}` : "创建人"}
					name={creatorName ?? PLACEHOLDER_EMPTY}
					main={creatorIsExecutor}
					onRemind={onRemind ? () => onRemind({ id: creatorId, name: creatorName ?? PLACEHOLDER_EMPTY }) : undefined}
				/>
				{showExecutor ? (
					<PeopleRow
						roleLabel={roleLabelOf("executor")}
						name={executorName ?? executorId}
						main
						onRemind={onRemind ? () => onRemind({ id: executorId, name: executorName ?? executorId }) : undefined}
					/>
				) : null}
				{members.map((m) => (
					<PeopleRow
						key={m.userId}
						roleLabel={roleLabelOf("participant")}
						name={m.name ?? m.userId}
						main={false}
						onRemind={onRemind ? () => onRemind({ id: m.userId, name: m.name ?? m.userId }) : undefined}
						onRemove={canManage ? () => onRemove({ userId: m.userId, name: m.name ?? m.userId }) : undefined}
						removing={removing}
					/>
				))}
				{!showExecutor && members.length === 0 ? (
					<li className="py-3 text-sm text-muted-foreground">还没有其他人。加人后他们能答复动作、参与讨论。</li>
				) : null}
			</ul>
		</section>
	);
}

/**
 * 参与人块里的一行 —— 左侧角色标签 + 右侧人名;`onRemove` 非空时显式给「移出」按钮。
 *
 * 头像走 `ui/avatar` 的兜底(墨底 + 反白首字 + 宋体)—— 同一个人在卡片 / 评论 / 成员三处
 * 长得一样,不额外给主执行人染色。
 * 「执行」这个身份靠**角色标签** + 名字加粗来区分,不靠颜色。
 *
 * `roleLabel` 不是 HTML `role` 属性 —— prop 名刻意避开 ARIA 关键字,免得 biome 把
 * 「创建人/执行」之类的中文字面误判成 ARIA role。
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
				{/* 圆牌:首字 + 固定色(全站人像走 `ui/avatar`,大小走 size 档) */}
				<Avatar name={name} size="xs" aria-hidden />
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
