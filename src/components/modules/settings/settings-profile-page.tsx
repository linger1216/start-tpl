import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { BadgeCheck, MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageFrame } from "#/components/layout/page-frame";
import { PageHeader } from "#/components/layout/page-header";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { DetailRow } from "#/components/ui/detail-row";
import { Input } from "#/components/ui/input";
import { Tag } from "#/components/ui/tag";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { authClient } from "#/lib/auth-client";
import { formatLocalMinute } from "#/lib/time";

/**
 * 系统设置 ▸ 个人资料 —— **任何登录者都能进自己的这一页**。
 *
 * 页面刻意**不挂菜单授权**(`doc/界面约定.md` 的"不在菜单表里的页面只要求登录"):
 * 入口在顶栏用户菜单里,不是侧边栏 —— "改自己密码"不该要求先被授予"系统设置"菜单。
 *
 * 四块内容,分属两条通道(这是本页最需要注意的地方):
 *  - **读**:`user.profile`(tRPC,SQL 按 `ctx.user.id` 自限);
 *  - **写**:姓名 / 密码 / 邮箱全是 **BA 的表** ⇒ 走 BA 客户端接口(`authClient.*`),不走 tRPC。
 *    理由:密码哈希、邮箱唯一性、会话吊销都是 BA 的职责;自己 update 只会写出一个登不进去的账号
 *    (与 `routers/user.ts` 建账号绕到 BA 是同一个理由)。
 *
 * 改邮箱是**邮件往返**(BA 默认这么做):提交后要给新邮箱发确认信才真的换 —— 所以按钮文案
 * 是「发确认邮件」而不是「保存」。开发态那封信打在服务端终端(见 `lib/mailer.ts`)。
 */
export function SettingsProfilePage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();

	const profileQuery = useQuery(trpc.user.profile.queryOptions());
	const profile = profileQuery.data;

	// 姓名
	const [name, setName] = useState("");
	const [savingName, setSavingName] = useState(false);
	// 密码
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [savingPassword, setSavingPassword] = useState(false);
	// 邮箱
	const [newEmail, setNewEmail] = useState("");
	const [mailing, setMailing] = useState(false);

	/** 改姓名 —— BA 的 `updateUser`,只动 `sys_user.name` */
	const handleSaveName = async () => {
		const next = name.trim();
		if (!next) {
			toast.error("姓名不能为空");
			return;
		}
		setSavingName(true);
		try {
			const { error } = await authClient.updateUser({ name: next });
			if (error) {
				toast.error(error.message ?? "保存失败");
				return;
			}
			await queryClient.invalidateQueries(trpc.user.pathFilter());
			// 顶栏的姓名来自路由上下文(服务端 beforeLoad 读的会话),所以改名后要重跑一次
			await router.invalidate();
			setName("");
			toast.success("姓名已更新");
		} catch (error) {
			toastApiError(error);
		} finally {
			setSavingName(false);
		}
	};

	/** 改密码 —— 必须给旧密码;`revokeOtherSessions` 让其它设备上的会话立刻失效 */
	const handleSavePassword = async () => {
		if (newPassword.length < 8) {
			toast.error("新密码至少 8 位");
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error("两次输入的新密码不一致");
			return;
		}
		setSavingPassword(true);
		try {
			const { error } = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
			});
			if (error) {
				toast.error(error.message ?? "修改失败");
				return;
			}
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			toast.success("密码已修改", { description: "其它设备上的登录已失效" });
		} catch (error) {
			toastApiError(error);
		} finally {
			setSavingPassword(false);
		}
	};

	/** 重发验证邮件 —— 收件人固定为当前账号的邮箱(BA 自己取会话里的 user) */
	const handleSendVerification = async () => {
		if (!profile) return;
		setMailing(true);
		try {
			const { error } = await authClient.sendVerificationEmail({
				email: profile.email,
				callbackURL: "/settings/profile",
			});
			if (error) {
				toast.error(error.message ?? "发送失败");
				return;
			}
			toast.success("验证邮件已发送", { description: "开发态请到运行 `pnpm dev` 的终端里取链接" });
		} catch (error) {
			toastApiError(error);
		} finally {
			setMailing(false);
		}
	};

	/** 改邮箱 —— BA 发确认信到**新**邮箱,点链接后才真的换 */
	const handleChangeEmail = async () => {
		const next = newEmail.trim();
		if (!next || next === profile?.email) {
			toast.error("请填一个不同的邮箱地址");
			return;
		}
		setMailing(true);
		try {
			const { error } = await authClient.changeEmail({ newEmail: next, callbackURL: "/settings/profile" });
			if (error) {
				toast.error(error.message ?? "发送失败");
				return;
			}
			setNewEmail("");
			toast.success("确认邮件已发出", {
				description: `点开寄到 ${next} 的那封信里的链接,邮箱才会真的换掉`,
			});
		} catch (error) {
			toastApiError(error);
		} finally {
			setMailing(false);
		}
	};

	return (
		<PageFrame className="mx-auto w-full max-w-3xl">
			<PageHeader title="个人资料" description="查看自己的账号信息,修改姓名、密码与邮箱。" />

			<Card>
				<CardHeader>
					<CardTitle>账号信息</CardTitle>
					<CardDescription>邮箱、角色与部门由管理员在用户台账里维护。</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					{profileQuery.isPending ? (
						<div className="py-6 text-center text-sm text-muted-foreground">加载中…</div>
					) : !profile ? (
						<div className="py-6 text-center text-sm text-muted-foreground">读不到账号信息</div>
					) : (
						<>
							<DetailRow label="姓名">{profile.name || "(未填姓名)"}</DetailRow>
							<DetailRow label="邮箱">
								<span className="mr-2">{profile.email}</span>
								{profile.emailVerified ? (
									<Tag variant="secondary" className="gap-1">
										<BadgeCheck className="size-3" />
										已验证
									</Tag>
								) : (
									<Tag variant="outline" className="gap-1 text-muted-foreground">
										<MailWarning className="size-3" />
										未验证
									</Tag>
								)}
							</DetailRow>
							<DetailRow label="角色">
								{profile.roles.length === 0 ? (
									<span className="text-muted-foreground">(没有角色)</span>
								) : (
									<span>{profile.roles.map((role) => role.name).join("、")}</span>
								)}
							</DetailRow>
							<DetailRow label="所属部门">
								{profile.depts.length === 0 ? (
									<span className="text-muted-foreground">(没有部门)</span>
								) : (
									<span>{profile.depts.map((dept) => dept.name).join("、")}</span>
								)}
							</DetailRow>
							<DetailRow label="创建时间">{formatLocalMinute(profile.createTime) || "—"}</DetailRow>
						</>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>修改姓名</CardTitle>
					<CardDescription>只改显示名;登录邮箱见下一张卡。</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 pt-0 sm:flex-row sm:items-end">
					<Input
						aria-label="新姓名"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={profile?.name || "输入新姓名"}
					/>
					<Button onClick={() => void handleSaveName()} disabled={savingName || name.trim() === ""}>
						保存
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>修改密码</CardTitle>
					<CardDescription>需要先验证当前密码;改完其它设备上的登录会立刻失效。</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 pt-0">
					<Input
						type="password"
						aria-label="当前密码"
						autoComplete="current-password"
						value={currentPassword}
						onChange={(event) => setCurrentPassword(event.target.value)}
						placeholder="当前密码"
					/>
					<Input
						type="password"
						aria-label="新密码"
						autoComplete="new-password"
						value={newPassword}
						onChange={(event) => setNewPassword(event.target.value)}
						placeholder="新密码(至少 8 位)"
					/>
					<Input
						type="password"
						aria-label="确认新密码"
						autoComplete="new-password"
						value={confirmPassword}
						onChange={(event) => setConfirmPassword(event.target.value)}
						placeholder="再输一次新密码"
					/>
					<div>
						<Button
							onClick={() => void handleSavePassword()}
							disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
						>
							修改密码
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>邮箱验证与换邮箱</CardTitle>
					<CardDescription>
						这两步都要点邮件里的链接才算数 —— 开发态邮件不会真发,链接打在运行 <code>pnpm dev</code> 的终端里。
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 pt-0">
					<div className="flex flex-wrap items-center gap-2">
						<Button variant="outline" onClick={() => void handleSendVerification()} disabled={mailing || !profile}>
							{profile?.emailVerified ? "重新发送验证邮件" : "发送验证邮件"}
						</Button>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
						<Input
							type="email"
							aria-label="新邮箱"
							value={newEmail}
							onChange={(event) => setNewEmail(event.target.value)}
							placeholder="换成新邮箱,例如 you@example.com"
						/>
						<Button
							variant="outline"
							onClick={() => void handleChangeEmail()}
							disabled={mailing || newEmail.trim() === ""}
						>
							发确认邮件
						</Button>
					</div>
				</CardContent>
			</Card>
		</PageFrame>
	);
}
