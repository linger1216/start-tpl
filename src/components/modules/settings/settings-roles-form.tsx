import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { RoleRow } from "#/components/modules/settings/settings-roles-table";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { MemberZone } from "#/components/modules/shared/member-zone";
import { type PermissionNode, PermissionPicker } from "#/components/modules/shared/permission-tree";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/** 数据范围五档 —— 文案就是文档里的说法(`up` 那档旁边再填层号) */
/** 数据范围五档 */
export const SCOPE_ITEMS = [
	{ value: "all", label: "全部数据" },
	{ value: "self", label: "仅本人" },
	{ value: "dept", label: "本部门" },
	{ value: "dept_below", label: "本部门及以下" },
	{ value: "up", label: "往上到指定层级及以下" },
];

export type RoleFormPayload = {
	code: string;
	name: string;
	/** 留空 = 自动排到最后(只有编辑时才是必填的数值) */
	sort?: number;
	status: boolean;
	remark: string | null;
	/** 数据范围 —— 见 lib/data-scope.ts(all / self / dept / dept_below / up:N) */
	dataScope: string;
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
 * 版式规矩(三个编辑界面统一,见 AGENTS「三个编辑界面:tab 化」):
 *  - **宽度固定 `sm:max-w-3xl`**(新建 / 编辑同一个宽度 —— 别随内容宽窄变化);
 *  - **高度固定 `h-[52vh]`**:三个 tab 内容多寡差很多(菜单树很高),不锁高度切 tab 会**抖**;
 *  - **每个 tab 自己带 `[取消] [该 tab 的动作]`**;对话框页脚只放**创建·更新时间**;
 *  - **切 tab 不丢已填内容** —— 字段状态都在本组件里,与 tab 挂载无关。
 *
 * 两个 tab 的动作**不进基本信息的保存**:用户区是**点一下立刻落库**,菜单区有它自己的「保存权限」——
 * 它们动的是两张关联表。看每个 tab 右下角的按钮文案就知道这一下会保存什么。
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
	const [code, setCode] = useState("");
	const [remark, setRemark] = useState("");
	const [sort, setSort] = useState("0");
	const [status, setStatus] = useState(true);
	/** 数据范围:四档词 + 一个"往上到第几层"(拼成 `up:N` 存进同一列) */
	const [scopeKind, setScopeKind] = useState<"all" | "self" | "dept" | "dept_below" | "up">("all");
	const [scopeLevel, setScopeLevel] = useState("1");
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
			onSuccess: async (outcome) => {
				await queryClient.invalidateQueries(trpc.role.pathFilter());
				setDraft(null);
				toast.success(`已保存「${role?.name ?? ""}」的权限(${outcome.count} 项,含自动补全的上级菜单)`);
			},
			onError: (error) => toast.error(toApiError(error).message),
		}),
	);

	// 打开时把当前值灌进来(关掉不清,免得关闭动画期间闪一下空值);tab 复位到调用方要求的那一个
	useEffect(() => {
		if (!open) return;
		setName(role?.name ?? "");
		setCode(role?.code ?? "");
		setRemark(role?.remark ?? "");
		setStatus(role ? role.status !== 0 : true);
		setSort(role ? String(role.sort ?? 0) : "");
		setTab(initialTab);
		setDraft(null);
	}, [open, role, initialTab]);

	const invalid = name.trim().length === 0 || code.trim().length === 0;
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
			<DialogContent className="flex h-[52vh] flex-col sm:max-w-2xl">
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
						{/* 新增时角色还没有 id,这两个 tab 里没有可操作的内容 —— 不显示(与用户编辑同一口径) */}
						{editing ? (
							<TabsTrigger value="users" count={members.length}>
								用户
							</TabsTrigger>
						) : null}
						{editing ? (
							<TabsTrigger value="menus" count={effectiveMenuIds.length}>
								菜单
							</TabsTrigger>
						) : null}
					</TabsList>

					{/* ── 基本信息 ─────────────────────────────────────────── */}
					<TabsContent value="basic" className="flex min-h-0 flex-1 flex-col">
						{/* 两列紧凑排(5 个字段压成 3 行):字段区要在 214px 里装下,否则它会自己出滚动条 */}
						<div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
							<DetailRow label="角色名" htmlFor="role-name">
								<Input
									id="role-name"
									value={name}
									placeholder="如:部门主管"
									className="h-8 text-sm"
									onChange={(event) => setName(event.target.value)}
								/>
							</DetailRow>
							<DetailRow label="标识" htmlFor="role-code">
								<Input
									id="role-code"
									value={code}
									placeholder="如:dept_manager"
									className="h-8 font-mono text-xs"
									onChange={(event) => setCode(event.target.value)}
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
							<DetailRow label="数据范围">
								<Select
									items={SCOPE_ITEMS}
									value={scopeKind}
									onValueChange={(next) => setScopeKind(next as typeof scopeKind)}
								>
									<SelectTrigger id="role-scope" size="sm" className="w-full">
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
							{scopeKind === "up" ? (
								<DetailRow label="往上到第几层" htmlFor="role-scope-level">
									<Input
										id="role-scope-level"
										className="h-8 text-sm"
										value={scopeLevel}
										onChange={(e) => setScopeLevel(e.target.value)}
										placeholder="1"
									/>
									<span className="mt-1 block text-xs text-muted-foreground">
										从根(第 0 层)往下数;例:区 → 街镇(1) → 部门(2),填 1 就是「本街镇及以下」
									</span>
								</DetailRow>
							) : null}
							<DetailRow label="启用">
								<Switch aria-label="启用" checked={status} onCheckedChange={setStatus} />
							</DetailRow>
						</div>
						{actions(
							<Button
								disabled={pending || invalid}
								onClick={() =>
									onSubmit({
										dataScope: scopeKind === "up" ? `up:${scopeLevel.trim() || "1"}` : scopeKind,
										name: name.trim(),
										code: code.trim(),
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
							<div className="flex min-h-0 flex-1 flex-col">
								<MemberZone
									title="用户"
									emptyText="还没有人拿到这个角色"
									members={members}
									userOptions={userOptions}
									loading={membersLoading}
									pending={membersPending}
									badgeValues={(member) => member.departmentNames}
									badgeEmpty="未加入部门"
									onAddMembers={onAddMembers}
									onRemoveMember={onRemoveMember}
								/>
							</div>
							{actions(null)}
						</TabsContent>
					) : null}

					{/* ── 菜单(它自己的「保存权限」)─────────────────────────── */}
					{editing ? (
						<TabsContent value="menus" className="flex min-h-0 flex-1 flex-col">
							<div className="flex min-h-0 flex-1 flex-col gap-3">
								<p className="text-xs text-muted-foreground">
									勾中的菜单会出现在侧边栏;勾中的**按钮**决定页里那些操作按钮是否可见(前端 `useHasPerm` 认它)。
									保存时服务端会自动补全上级菜单。
								</p>
								<div className="min-h-0 flex-1 overflow-y-auto">
									<PermissionPicker
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
						<DetailMeta meta={{ createdAt: role.createTime, updatedAt: role.updateTime }} />
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
