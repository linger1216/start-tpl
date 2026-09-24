/**
 * 「一批人」的管理区 —— 部门成员 / 角色用户共用。
 *
 * 两处（`settings-departments-form` 与 `settings-roles-form`）此前是**同一段结构复制两遍**:
 * 搜索优先的多选加人 + 一次提交多人 + 成员列表 + 人多时的过滤 + 行内的「移出」。
 * 抽到这里之后两边各剩十来行调用，改一次两边一起变。
 *
 * ## 为什么它该是一个组件（而不是"薄封装"）
 *
 * 删掉它，两个调用点会各自重复**:多选加人的编排 + 批量提交 + 过滤 + 空/加载态 + 行长什么样** ——
 * 这是**结构**，不是别名转发（项目禁的是 `TagWrapper` 那种只换个名字的件，见 AGENTS「禁止薄封装」）。
 *
 * ## 两条被焊进来的规矩
 *
 * 1. **标题旁必须写着「加人 / 移出即时生效，不用保存」** —— 这一区直接写关联表，**不经过外层表单的保存**；
 *    不写明的话，人会以为"取消"能把刚加的人退掉（退不掉，那是两件事）。
 * 2. **候选里排除已经是成员的人** —— 已经在了就不该出现在"可加入"里。
 *
 * 徽章由调用方给（`badgeValues`）：部门那边显示**角色**、角色那边显示**部门** —— 都是"光看姓名不够用"时的消歧信息。
 */
import { Users } from "lucide-react";
import { useMemo, useState } from "react";

import { MultiSelect } from "#/components/modules/shared/multi-select";
import { ActionButton } from "#/components/ui/action-button";
import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

/** 一行"人"至少要有这些（各域自己的业务字段由 `badgeValues` 提供） */
type MemberZoneRow = {
	id: string;
	userId: string;
	userName: string;
	userEmail: string;
};

/** 列表长过这个数就多给一个过滤框（短列表加搜索框只会更吵） */
const FILTER_THRESHOLD = 6;

export function MemberZone<T extends MemberZoneRow>({
	title,
	emptyText,
	members,
	userOptions,
	loading,
	pending,
	badgeValues,
	badgeEmpty,
	onAddMembers,
	onRemoveMember,
}: {
	/** 这一区管的是什么人：「成员」（部门）/「用户」（角色） */
	title: string;
	/** 一个人都没有时说什么（每个域的措辞不一样） */
	emptyText: string;
	members: T[];
	userOptions: Array<{ id: string; name: string; email: string }>;
	loading: boolean;
	/** 加人 / 移出进行中（与外层表单的"保存中"互不相干） */
	pending: boolean;
	/** 行上显示哪个徽章（部门里显示角色、角色里显示部门） */
	badgeValues: (member: T) => string[];
	badgeEmpty: string;
	/** 一次可以加多个（内部逐条幂等提交） */
	onAddMembers: (userIds: string[]) => void;
	onRemoveMember: (userId: string) => void;
}) {
	const [pickedIds, setPickedIds] = useState<string[]>([]);
	const [keyword, setKeyword] = useState("");

	/** 可加入的人 = 还不在这一批里的 */
	const addableOptions = useMemo(() => {
		const memberIds = new Set(members.map((member) => member.userId));
		return userOptions
			.filter((user) => !memberIds.has(user.id))
			.map((user) => ({ value: user.id, label: user.name || user.email, hint: user.email }));
	}, [members, userOptions]);

	const filtered = useMemo(() => {
		const kw = keyword.trim().toLowerCase();
		if (!kw) return members;
		return members.filter((member) => `${member.userName} ${member.userEmail}`.toLowerCase().includes(kw));
	}, [members, keyword]);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 border-t border-border pt-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<Users className="size-3.5 text-muted-foreground" />
					<span className="text-[13px] font-medium">
						{title}({members.length})
					</span>
				</div>
				{/* 这一区不经过外层的"保存" —— 必须写出来(见文件头) */}
				<span className="text-[11.5px] text-muted-foreground">加人 / 移出即时生效,不用保存</span>
			</div>
			{/* 候选选择框:高度填满本区剩余空间;「加入」与搜索框同一行、靠最右 */}
			<div className="flex min-h-[160px] flex-1 flex-col">
				<MultiSelect
					options={addableOptions}
					value={pickedIds}
					onChange={setPickedIds}
					placeholder="搜索姓名或邮箱…"
					emptyText={`没有可加入的${title}了`}
					maxRender={30}
					disabled={pending}
					fill
					trailing={
						<Button
							size="sm"
							disabled={pending || pickedIds.length === 0}
							onClick={() => {
								onAddMembers(pickedIds);
								setPickedIds([]);
							}}
						>
							{pending ? "提交中…" : pickedIds.length > 0 ? `加入 ${pickedIds.length} 人` : "加入"}
						</Button>
					}
				/>
			</div>
			{loading ? (
				<p className="text-[12px] text-muted-foreground">加载中…</p>
			) : members.length === 0 ? (
				<p className="text-[12px] text-muted-foreground">{emptyText}</p>
			) : (
				<div className="min-h-0 space-y-2">
					{members.length > FILTER_THRESHOLD ? (
						<Input
							value={keyword}
							onChange={(event) => setKeyword(event.target.value)}
							placeholder={`在 ${members.length} 个${title}里过滤…`}
							aria-label={`过滤${title}`}
							className="h-7 text-[12.5px]"
						/>
					) : null}
					<ul className="max-h-40 space-y-1 overflow-y-auto">
						{filtered.length === 0 ? (
							<li className="px-1 text-[12px] text-muted-foreground">没有匹配的{title}</li>
						) : (
							filtered.map((member) => (
								<li
									key={member.id}
									className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5"
								>
									<div className="min-w-0 flex flex-wrap flex-1 items-center gap-3">
										<div className="truncate text-[11px]">{member.userName || member.userEmail}</div>
										<span className="truncate text-[11px] text-muted-foreground">{member.userEmail}</span>
										<BadgeList
											values={badgeValues(member)}
											layout="wrap"
											color="stable"
											emptyPlaceholder={badgeEmpty}
										/>
									</div>
									<ActionButton tone="danger" disabled={pending} onClick={() => onRemoveMember(member.userId)}>
										移出
									</ActionButton>
								</li>
							))
						)}
					</ul>
				</div>
			)}
		</div>
	);
}
