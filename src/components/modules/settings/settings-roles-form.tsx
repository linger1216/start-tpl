import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RoleRow } from "#/components/modules/settings/settings-roles-table";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { type PermissionNode, PermissionSelect } from "#/components/modules/shared/permission-select";
import { Button } from "#/components/ui/button";
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
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { TagList } from "#/components/ui/tag-list";
import { Textarea } from "#/components/ui/textarea";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";
// 真源在 `lib/menu-spec.ts`(client-safe) —— 不能从 server-only 的 `#/lib/casbin` 拉(见 menu-spec.ts 注释)。
import { ADMIN_ROLE_NAME } from "#/lib/menu-spec";

export type RoleFormPayload = {
	name: string;
	/** 留空 = 自动排到最后(只有编辑时才是必填的数值) */
	sort?: number;
	status: boolean;
	remark: string | null;
};

type RoleUserRow = {
	id: string;
	userId: string;
	userName: string;
	userEmail: string;
	/** 这个人的部门(角色是全局的,只靠姓名没法消歧) */
	departmentNames: string[];
};

/** 三个 tab 的键;外部可以要求"打开时直接落在那一个"(如表格行的「菜单权限」) */
export type RoleFormTab = "basic" | "users" | "menus";

/**
 * 角色表单(新增 / 编辑)—— **三个 tab**:基本信息 / 用户 / 菜单。
 *
 * 版式规矩(编辑弹窗统一,见 `doc/界面约定.md`):
 *  - **宽度不动**(`sm:max-w-2xl`,新建 / 编辑同一个宽度);
 *  - **高度随内容长、封顶 `max-h-[85vh]`**:弹窗本体不出滚动条,内容区(`DialogBody`)自己滚,header / footer 钉住;
 *  - **每个 tab 自己带 `[取消] [该 tab 的动作]`**;对话框页脚只放**创建·更新时间**;
 *  - **切 tab 不丢已填内容** —— 字段状态都在本组件里,与 tab 挂载无关。
 *
 * 「用户」区是**点一下立刻落库**,「菜单」区有它自己的「保存权限」—— 它们动的是两张关联表,
 * 看 tab 右下角的按钮文案就知道这一下会保存什么。
 * 「系统管理员」角色的权限由系统授予(身份级 bypass),**不给它显示「菜单」tab**。
 *
 * 新增时后两个 tab 里没有内容(角色还没有 id) → 直接不显示(与用户编辑同一口径)。
 */
export function SettingsRolesForm({
	role,
	creating,
	open,
	pending,
	initialTab = "basic",
	permTree,
	members,
	userOptions,
	membersLoading,
	membersPending,
	onOpenChange,
	onSubmit,
	onAddMembers,
	onRemoveMember,
}: {
	role: RoleRow | null;
	creating: boolean;
	open: boolean;
	pending: boolean;
	/** 打开时落在哪个 tab(默认基本信息);表格行的「菜单权限」会传 `menus` */
	initialTab?: RoleFormTab;
	/** 权限树(菜单 + 按钮) */
	permTree: PermissionNode[];
	members: RoleUserRow[];
	userOptions: Array<{ id: string; name: string; email: string }>;
	membersLoading: boolean;
	/** 加人 / 移出进行中(与字段区的 `pending` 分开:两个区的忙碌状态互不相干) */
	membersPending: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (payload: RoleFormPayload) => void;
	/** 一次可以加多个(内部逐条幂等提交) */
	onAddMembers: (userIds: string[]) => void;
	onRemoveMember: (userId: string) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [remark, setRemark] = useState("");
	const [sort, setSort] = useState("0");
	const [status, setStatus] = useState(true);
	const [tab, setTab] = useState<RoleFormTab>("basic");

	// ── 菜单权限(与基本信息各自保存)─────────────────────────────
	const menuIdsQuery = useQuery({
		...trpc.role.menuIds.queryOptions({ roleId: role?.id ?? "" }),
		enabled: open && Boolean(role) && !creating,
	});
	/** 本地勾选态;`null` = 还没动过(用接口返回的) */
	const [draft, setDraft] = useState<string[] | null>(null);
	const effectiveMenuIds = draft ?? menuIdsQuery.data ?? [];
	const saveMenusMutation = useMutation(
		trpc.role.setMenus.mutationOptions({
			onSuccess: writeSuccess(() => queryClient.invalidateQueries(trpc.role.pathFilter()), {
				close: () => setDraft(null),
				message: (o) => `已保存「${role?.name ?? ""}」的权限(${o.count} 项,含自动补全的上级菜单)`,
			}),
			onError: writeError,
		}),
	);

	/** 已持此角色的人 = 候选名单里要排除的那一拨 */
	const addableOptions = useMemo(() => {
		const taken = new Set(members.map((member) => member.userId));
		return userOptions
			.filter((user) => !taken.has(user.id))
			.map((user) => ({ value: user.id, label: user.name || user.email, hint: user.email }));
	}, [members, userOptions]);

	/** 已选 chip 文案:「姓名 · 部门」;未入部门显示「未加入部门」,看一眼能消歧(角色是全局的) */
	const memberChip = (member: RoleUserRow) => {
		const name = member.userName || member.userEmail;
		const dept = member.departmentNames[0] ?? "未加入部门";
		return `${name} · ${dept}`;
	};

	// 打开时把当前值灌进来(关掉不清,免得关闭动画期间闪一下空值);tab 复位到调用方要求的那一个
	useEffect(() => {
		if (!open) return;
		setName(role?.name ?? "");
		setRemark(role?.remark ?? "");
		setStatus(role ? role.status !== 0 : true);
		setSort(role ? String(role.sort ?? 0) : "");
		setTab(initialTab);
		setDraft(null);
	}, [open, role, initialTab]);

	const invalid = name.trim().length === 0;
	// 新增时还没有角色 id,谈不上"谁有这个角色" / "授了哪些菜单" —— 后两个 tab 只在编辑时出现
	const editing = Boolean(role) && !creating;

	/** 每个 tab 底部的动作行:左「取消」、右该 tab 自己的动作 */
	const actions = (right: React.ReactNode) => (
		<div className="flex shrink-0 items-center justify-end gap-2 pt-3">
			<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
				取消
			</Button>
			{right}
		</div>
	);

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{creating ? "新增角色" : `编辑角色 · ${role?.name ?? ""}`}</DialogTitle>
					<DialogDescription>
						角色是**全局定义**的(谁有哪个角色记在「用户 → 角色」上)—— 所以这里不会因为部门变多而复制出一堆角色。
					</DialogDescription>
				</DialogHeader>

				<Tabs
					variant="card"
					value={tab}
					onValueChange={(next) => setTab(next as RoleFormTab)}
					className="flex min-h-0 flex-1 flex-col"
				>
					<TabsList className="shrink-0">
						<TabsTrigger value="basic">基本信息</TabsTrigger>
						{/* 新增时角色还没有 id,「用户」tab 里没有可操作的内容 —— 不显示(与用户编辑同一口径) */}
						{editing ? (
							<TabsTrigger value="users" count={members.length}>
								用户
							</TabsTrigger>
						) : null}
						{/* 「系统管理员」角色的权限由系统授予(身份级 bypass),不给它显示「菜单」tab */}
						{editing && role?.name !== ADMIN_ROLE_NAME ? (
							<TabsTrigger value="menus" count={effectiveMenuIds.length}>
								菜单
							</TabsTrigger>
						) : null}
					</TabsList>

					{/* ── 基本信息 ─────────────────────────────────────────── */}
					<TabsContent value="basic" className="flex min-h-0 flex-1 flex-col">
						{/* 字段区自己滚(DialogBody):弹窗本体不出滚动条,高度随内容长、封顶 85vh */}
						<DialogBody className="flex flex-col pr-1">
							<DetailRow label="角色名" htmlFor="role-name">
								<Input
									id="role-name"
									value={name}
									placeholder="如:部门主管"
									className="h-8 text-sm"
									onChange={(event) => setName(event.target.value)}
								/>
							</DetailRow>
							<DetailRow label="说明" htmlFor="role-remark">
								<Textarea
									id="role-remark"
									value={remark}
									rows={2}
									placeholder="给人看的说明"
									className="text-xs"
									onChange={(event) => setRemark(event.target.value)}
								/>
							</DetailRow>
							<DetailRow label="排序" htmlFor="role-sort">
								<Input
									id="role-sort"
									type="number"
									value={sort}
									placeholder="0"
									className="h-8 text-sm"
									onChange={(event) => setSort(event.target.value)}
								/>
							</DetailRow>
							<DetailRow label="启用">
								<Switch aria-label="启用" checked={status} onCheckedChange={setStatus} />
							</DetailRow>
						</DialogBody>
						{actions(
							<Button
								disabled={pending || invalid}
								onClick={() =>
									onSubmit({
										name: name.trim(),
										sort: sort.trim() === "" ? undefined : Number(sort),
										status,
										remark: remark.trim() || null,
									})
								}
							>
								<Save className="size-3.5" />
								{pending ? "保存中…" : creating ? "创建" : "保存"}
							</Button>,
						)}
					</TabsContent>

					{/* ── 用户(点一下立刻落库,所以这里没有"保存")──────────────── */}
					{editing ? (
						<TabsContent value="users" className="flex min-h-0 flex-1 flex-col">
							<div className="flex min-h-0 flex-1 flex-col gap-3">
								<p className="text-xs text-muted-foreground">
									已有 <span className="font-medium text-foreground">{members.length}</span> 人持此角色。
									搜索点选加入,点胶囊的 × 移出 —— 即时生效,不用保存。
								</p>
								<RoleUserAdder options={addableOptions} pending={membersPending} onAdd={onAddMembers} />
								{membersLoading ? (
									<p className="text-xs text-muted-foreground">加载中…</p>
								) : members.length === 0 ? (
									<p className="text-xs text-muted-foreground">还没有人拿到这个角色</p>
								) : (
									/** 已选区:一行胶囊,「姓名 · 部门」作 chip,点 × 走 `onRemoveMember`。
									 * 与 `MultiSelect` 内部已选 chip 同款(用户管理里部门 / 角色 tab 即此形)。 */
									<TagList
										values={members.map(memberChip)}
										layout="wrap"
										justify="start"
										onRemove={(index) => {
											const member = members[index];
											if (member) onRemoveMember(member.userId);
										}}
									/>
								)}
							</div>
							{actions(null)}
						</TabsContent>
					) : null}

					{/* ── 菜单(它自己的「保存权限」;系统管理员不显示此 tab)───────────── */}
					{editing && role?.name !== ADMIN_ROLE_NAME ? (
						<TabsContent value="menus" className="flex min-h-0 flex-1 flex-col">
							<div className="flex min-h-0 flex-1 flex-col gap-3">
								<p className="text-xs text-muted-foreground">
									勾中的菜单会出现在侧边栏;勾中的「按钮」决定页里那些操作按钮是否可见(前端 `useHasPerm` 认它)。
									保存时服务端会自动补全上级菜单。
								</p>
								<PermissionSelect
									nodes={permTree}
									selected={effectiveMenuIds}
									title="菜单与按钮"
									placeholder="搜索菜单 / 按钮,如 角色 / 导出…"
									onToggle={(ids, on) => {
										const next = new Set(effectiveMenuIds);
										for (const id of ids) {
											if (on) next.add(id);
											else next.delete(id);
										}
										setDraft([...next]);
									}}
								/>
							</div>
							{actions(
								<Button
									disabled={saveMenusMutation.isPending}
									onClick={() => role && saveMenusMutation.mutate({ roleId: role.id, menuIds: effectiveMenuIds })}
								>
									{saveMenusMutation.isPending ? "保存中…" : "保存权限"}
								</Button>,
							)}
						</TabsContent>
					) : null}
				</Tabs>

				{/* 页脚只放时间行;**没有时间可显示就整条不渲染** */}
				{role ? (
					<DialogFooter className="mt-0">
						<DetailMeta meta={{ id: role.id, createdAt: role.createTime, updatedAt: role.updateTime }} />
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/**
 * 「加人」小控件 —— 搜索 + 候选列表,点一行就把那一行的人提交上去。
 *
 * 不复用 `MultiSelect`:`MultiSelect` 是「全量 value 双向绑」,而这里 value 应该是后端的真值
 * (members),点一行只触发 onAdd([id]),不存本地 state。两套语义不混 —— 自己写一个十几行的即可。
 */
function RoleUserAdder({
	options,
	pending,
	onAdd,
}: {
	options: Array<{ value: string; label: string; hint?: string }>;
	pending: boolean;
	onAdd: (ids: string[]) => void;
}) {
	const [keyword, setKeyword] = useState("");
	const filtered = useMemo(() => {
		const kw = keyword.trim().toLowerCase();
		if (!kw) return options;
		return options.filter(
			(option) => option.label.toLowerCase().includes(kw) || (option.hint ?? "").toLowerCase().includes(kw),
		);
	}, [options, keyword]);

	return (
		<div className="flex min-h-40 flex-1 flex-col gap-2">
			<Input
				value={keyword}
				onChange={(event) => setKeyword(event.target.value)}
				placeholder="搜索姓名或邮箱,点中即加入…"
				disabled={pending}
				className="h-8 text-sm"
			/>
			<div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
				{filtered.length === 0 ? (
					<p className="px-3 py-2 text-xs text-muted-foreground">
						{options.length === 0 ? "没有可加入的人了" : "没有匹配的用户"}
					</p>
				) : (
					<ul className="divide-y divide-border">
						{filtered.map((option) => (
							<li key={option.value}>
								<button
									type="button"
									disabled={pending}
									onClick={() => onAdd([option.value])}
									className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
								>
									<span className="truncate">{option.label}</span>
									{option.hint ? <span className="truncate text-xs text-muted-foreground">{option.hint}</span> : null}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
