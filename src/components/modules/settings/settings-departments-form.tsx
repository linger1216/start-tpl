import { Save, Undo2 } from "lucide-react";

import type { DeptTreeNode } from "#/components/modules/settings/settings-departments-tree";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { MemberZone } from "#/components/modules/shared/member-zone";
import { ActionButton } from "#/components/ui/action-button";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Tag } from "#/components/ui/tag.tsx";
import { Textarea } from "#/components/ui/textarea";

/** 详情表单的值(`parentId` 不在这里改,但保存时要原样带回去 —— 接口是整行覆盖) */
export type DeptFormValues = {
	name: string;
	parentId: string | null;
	status: boolean;
	remark: string;
};

export function deptFormValues(node: DeptTreeNode): DeptFormValues {
	return { name: node.name, parentId: node.parentId, status: node.status !== 0, remark: node.remark ?? "" };
}

type DeptMemberRow = {
	id: string;
	userId: string;
	userName: string;
	userEmail: string;
	/** 成员的角色名(全局角色,**只读展示** —— 分配在「用户管理」里做) */
	roleNames: string[];
};

/**
 * 右侧「部门详情」—— 面板分成**两个职责明确的区**,不要混在一起:
 *
 * ```
 * 字段区  名称 / 启停 / 备注  →  [保存] [还原]              (改了要保存)
 * ─────────────────────────────────────────────────
 * 成员区  加人 / 移出          →  即时生效,不用保存          (点一下就落库)
 * ```
 *
 * 为什么必须分开:以前「保存」那一行夹在字段和成员中间,而成员是**即时生效**的 ——
 * 视觉上像是在说"保存会把成员一起存",于是用户会去点一个根本不需要点的按钮。
 * 现在:**保存只属于字段区**(放在字段的最下面),成员区用分隔线 + 自己的说明划清界限,
 * 删除这种记录级危险动作挪到字段区最右,**离保存远远的**。
 *
 * **成员选择器是"搜索优先 + 可多选"**(`shared/multi-select`):用户上百上千时,
 * 一个普通下拉既搜不了、又会把上千条一次性塞进浮层。这里只渲染前 50 条 + 关键词过滤,
 * 选中的显示成可删标签,一次提交多人。
 *
 * 上级部门**不在这个面板里改**(用户要求去掉):树本身支持同级拖拽排序;换上级走
 * 「用户管理」不需要,而"移动节点"这个动作还没做 —— 见 AGENTS 的树那节。
 */
export function SettingsDepartmentsForm({
	node,
	values,
	dirty,
	pending,
	members,
	userOptions,
	membersLoading,
	membersPending,
	onChange,
	onSave,
	onReset,
	onDelete,
	onAddMembers,
	onRemoveMember,
}: {
	node: DeptTreeNode | null;
	values: DeptFormValues;
	dirty: boolean;
	pending: boolean;
	members: DeptMemberRow[];
	userOptions: Array<{ id: string; name: string; email: string }>;
	membersLoading: boolean;
	/** 加人 / 移出进行中(与字段区的 `pending` 分开 —— 两个区的忙碌状态互不相干) */
	membersPending: boolean;
	onChange: (next: DeptFormValues) => void;
	onSave: () => void;
	onReset: () => void;
	onDelete: () => void;
	/** 一次可以加多个(内部逐条幂等提交) */
	onAddMembers: (userIds: string[]) => void;
	onRemoveMember: (userId: string) => void;
}) {
	if (!node) {
		return (
			<div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
				左侧选一个部门,这里改它的名称 / 启停 / 备注,并管理成员
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col gap-4">
			{/* 标题:这一行只说明"现在改的是哪个部门",不放任何动作 */}
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0 gap-1">
					<div className="truncate text-sm font-medium text-foreground">{node.name}</div>
				</div>
				{dirty ? <span className="shrink-0 text-xs text-warn-fg">未保存</span> : null}
			</div>

			{/* 两个 tab:字段(要保存)/ 用户(即时生效)—— 形态与用户编辑、角色编辑一致(card) */}
			<Tabs variant="card" defaultValue="basic" className="flex min-h-0 flex-1 flex-col">
				<TabsList className="shrink-0">
					<TabsTrigger value="basic">基本信息</TabsTrigger>
					<TabsTrigger value="members" count={members.length}>
						用户
					</TabsTrigger>
				</TabsList>

				<TabsContent value="basic" className="flex min-h-0 flex-1 flex-col">
					<div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
						{/* ── 区 1:字段(要保存)──────────────────────────────── */}
						<div className="space-y-3">
							<DetailRow label="部门名">
								<Input
									value={values.name}
									aria-label="部门名"
									className="h-8 text-sm"
									onChange={(event) => onChange({ ...values, name: event.target.value })}
								/>
							</DetailRow>

							<DetailRow label="备注">
								<Textarea
									value={values.remark}
									aria-label="备注"
									rows={2}
									className="text-xs"
									onChange={(event) => onChange({ ...values, remark: event.target.value })}
								/>
							</DetailRow>

							<DetailRow label="启用">
								<Switch
									aria-label="启用"
									checked={values.status}
									onCheckedChange={(next) => onChange({ ...values, status: next })}
								/>
							</DetailRow>
						</div>

						{/* 时间行:与菜单 / 标签详情同序 —— 字段 → 时间 → 动作行 */}
						{node ? <DetailMeta meta={{ createdAt: node.createTime, updatedAt: node.updateTime , id: node.id}} /> : null}
					</div>

					{/* 动作行(三棵树统一):保存 / 还原在右,删除这种"记录级"危险动作推到最右、离保存远一点 */}
					<div className="flex shrink-0 items-center justify-end gap-2 pt-3">
						<Button size="sm" disabled={pending || !dirty} onClick={onSave}>
							<Save className="size-3.5" />
							{pending ? "保存中…" : "保存"}
						</Button>

						<Button variant="outline" size="sm" disabled={pending || !dirty} onClick={onReset}>
							<Undo2 className="size-3.5" />
							还原
						</Button>
					</div>
				</TabsContent>

				<TabsContent value="members" className="flex min-h-0 flex-1 flex-col">
					<div className="flex min-h-0 flex-1 flex-col">
						{/* ── 区 2:成员(即时生效,不用保存)──────────────────── */}
						<MemberZone
							title="成员"
							emptyText="这个部门还没有人"
							members={members}
							userOptions={userOptions}
							loading={membersLoading}
							pending={membersPending}
							badgeValues={(member) => member.roleNames}
							badgeEmpty="未分配角色"
							onAddMembers={onAddMembers}
							onRemoveMember={onRemoveMember}
						/>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
