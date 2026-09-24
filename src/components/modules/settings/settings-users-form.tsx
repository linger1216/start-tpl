import { useEffect, useState } from "react";
import type { UserRow } from "#/components/modules/settings/settings-users-table";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { MultiSelect, type MultiSelectOption } from "#/components/modules/shared/multi-select";
import { DetailRow } from "#/components/ui/detail-row";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

export type UserFormPayload = {
	name: string;
	email: string;
	/** 只有新建时有意义;编辑时改密码走 Better Auth 自己的流程 */
	password: string;
	image: string;
	emailVerified: boolean;
	roleIds: string[];
	departmentIds: string[];
};

/**
 * 用户表单(新建 / 编辑)—— **三个 tab**:基本信息 / 部门 / 角色。
 *
 * 版式规矩(三个编辑界面统一,见 AGENTS「三个编辑界面:tab 化」):
 *  - **宽度固定 `sm:max-w-3xl`** —— 三个界面同一个宽度,不宽窄不一;
 *  - **高度固定 `h-[52vh]`**:tab 之间内容多寡不同,不锁高度切 tab 会**抖**;
 *    锁住之后由**内容区自己滚**(滚动条在 tab 内部,动作行钉在底部);
 *  - **每个 tab 自己带 `[取消] [保存]`**;对话框页脚只放**创建·更新时间**;
 *  - **切 tab 不丢已填内容** —— 字段状态都在本组件里,与 tab 挂载无关(Base UI 只挂载当前面板,
 *    所以千万别把字段的 state 放进 tab 里)。
 *
 * 新建时**没有**「部门 / 角色」两个 tab:账号还没建出来,没什么可分配的
 * (`signUpEmail` 只能建账号;建完在「编辑」里分配)。说明文案里写清楚,免得人以为"建的时候漏了"。
 */
export function SettingsUsersForm({
	user,
	creating,
	open,
	pending,
	roles,
	departments,
	onOpenChange,
	onSubmit,
}: {
	/** 编辑哪一行(creating 时忽略) */
	user: UserRow | null;
	creating: boolean;
	open: boolean;
	pending: boolean;
	/** 可分配的全局角色(来自 `role.list`) */
	roles: MultiSelectOption[];
	/** 可加入的部门(来自 `department.tree`) */
	departments: MultiSelectOption[];
	onOpenChange: (next: boolean) => void;
	onSubmit: (payload: UserFormPayload) => void;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [image, setImage] = useState("");
	const [emailVerified, setEmailVerified] = useState(false);
	const [roleIds, setRoleIds] = useState<string[]>([]);
	const [departmentIds, setDepartmentIds] = useState<string[]>([]);
	const [tab, setTab] = useState("basic");

	// 打开时把当前值灌进来(关掉不清,免得关闭动画期间闪一下空值);顺便把 tab 复位 —— 免得上次停在"角色"上
	useEffect(() => {
		if (!open) return;
		setName(user?.name ?? "");
		setEmail(user?.email ?? "");
		setPassword("");
		setImage(user?.image ?? "");
		setEmailVerified(user?.emailVerified ?? false);
		setRoleIds(user?.roleIds ?? []);
		setDepartmentIds(user?.departmentIds ?? []);
		setTab("basic");
	}, [open, user]);

	const invalid = name.trim().length === 0 || email.trim().length === 0 || (creating && password.length < 8);

	function submit() {
		onSubmit({
			name: name.trim(),
			email: email.trim(),
			password,
			image: image.trim(),
			emailVerified,
			roleIds,
			departmentIds,
		});
	}

	/** 每个 tab 底部都长这样:左「取消」、右该 tab 的动作(三个 tab 共用一个提交 —— 都是同一张表的字段) */
	const actions = (
		<div className="flex shrink-0 items-center justify-end gap-2 pt-3">
			<Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
				取消
			</Button>
			<Button disabled={pending || invalid} onClick={submit}>
				{pending ? "保存中…" : creating ? "创建账号" : "保存"}
			</Button>
		</div>
	);

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="flex h-[52vh] flex-col sm:max-w-2xl">
				<DialogHeader className="shrink-0">
					<DialogTitle>{creating ? "新建用户" : `编辑用户 · ${user?.name ?? ""}`}</DialogTitle>
					<DialogDescription>
						{creating
							? "账号体系归 Better Auth(密码哈希 / 会话 / 登录都由它管),这里只是替人开个账号 —— 建完还没有角色,看不到任何菜单,建好后在「编辑」里分配部门与角色。"
							: "改姓名 / 邮箱 / 头像 / 邮箱验证状态 / 部门 / 角色。密码走 Better Auth 自己的流程(要本人或邮件往返),不在这里代改。"}
					</DialogDescription>
				</DialogHeader>

				<Tabs variant="card" value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
					<TabsList className="shrink-0">
						<TabsTrigger value="basic">基本信息</TabsTrigger>
						{/* 新建时账号还没建出来,这两个 tab 里没有任何可分配内容 —— 直接不显示(不是禁用) */}
						{creating ? null : (
							<TabsTrigger value="departments" count={departmentIds.length}>
								部门
							</TabsTrigger>
						)}
						{creating ? null : (
							<TabsTrigger value="roles" count={roleIds.length}>
								角色
							</TabsTrigger>
						)}
					</TabsList>

					{/* ── 基本信息 ─────────────────────────────────────────── */}
					<TabsContent value="basic" className="flex min-h-0 flex-1 flex-col">
						{/* 两列紧凑排:字段区要在 ~214px 里装下,否则它会自己出滚动条(与角色编辑同形) */}
						<div className="grid min-h-0 flex-1 content-start gap-x-3 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2">
							<DetailRow label="姓名" htmlFor="user-form-name">
								<Input
									id="user-form-name"
									value={name}
									placeholder="如:张三"
									className="h-8 text-[13px]"
									onChange={(event) => setName(event.target.value)}
								/>
							</DetailRow>
							<DetailRow label="邮箱(登录名)" htmlFor="user-form-email">
								<Input
									id="user-form-email"
									type="email"
									value={email}
									placeholder="name@example.com"
									className="h-8 text-[13px]"
									onChange={(event) => setEmail(event.target.value)}
								/>
							</DetailRow>
							{creating ? (
								<div className="space-y-1 sm:col-span-2">
									<Label htmlFor="user-form-password" className="text-[12px]">
										初始密码(至少 8 位)
									</Label>
									<Input
										id="user-form-password"
										type="password"
										value={password}
										placeholder="交给本人后让他自己改"
										className="h-8 text-[13px]"
										onChange={(event) => setPassword(event.target.value)}
									/>
								</div>
							) : (
								<>
									<DetailRow label={<>头像 URL<span className="ml-1 font-normal text-muted-foreground">留空 = 没有头像</span></>} htmlFor="user-form-image">
										<Input
											id="user-form-image"
											value={image}
											placeholder="https://…"
											className="h-8 text-[13px]"
											onChange={(event) => setImage(event.target.value)}
										/>
									</DetailRow>
									<div className="flex items-center justify-between gap-3 self-start rounded-xl border border-border px-3 py-1.5">
										<div className="space-y-0.5">
											<Label className="text-[12px]">邮箱已验证</Label>
											<p className="text-[11px] text-muted-foreground">替人开账号时通常勾上</p>
										</div>
										<Switch aria-label="邮箱已验证" checked={emailVerified} onCheckedChange={setEmailVerified} />
									</div>
								</>
							)}
						</div>
						{actions}
					</TabsContent>

					{/* ── 部门(组织架构,不影响权限)─────────────────────────── */}
					<TabsContent value="departments" className="flex min-h-0 flex-1 flex-col">
						<div className="flex min-h-0 flex-1 flex-col gap-1">
							<Label className="text-[12px]">
								部门
								<span className="ml-1 font-normal text-muted-foreground">
									组织架构,一个人可以同时属于多个部门(不影响权限)
								</span>
							</Label>
							<MultiSelect
								options={departments}
								value={departmentIds}
								onChange={setDepartmentIds}
								placeholder="搜索部门名…"
								emptyText="没有匹配的部门"
								maxRender={30}
								fill
							/>
						</div>
						{actions}
					</TabsContent>

					{/* ── 角色(全局,决定看得到哪些菜单)───────────────────── */}
					<TabsContent value="roles" className="flex min-h-0 flex-1 flex-col">
						<div className="flex min-h-0 flex-1 flex-col gap-1">
							<Label className="text-[12px]">
								角色(全局)
								<span className="ml-1 font-normal text-muted-foreground">决定能看见哪些菜单,多个角色取并集</span>
							</Label>
							<MultiSelect
								options={roles}
								value={roleIds}
								onChange={setRoleIds}
								placeholder="搜索角色名…"
								emptyText="还没有角色 —— 先去「角色管理」建一个"
								fill
							/>
						</div>
						{actions}
					</TabsContent>
				</Tabs>

				{/* 页脚只放时间行;**没有时间可显示就整条不渲染**(新建时它是空的,白占 70px) */}
				{user ? (
					<DialogFooter className="mt-0">
						<DetailMeta meta={{ createdAt: user.createdAt, updatedAt: user.updatedAt }} />
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
