/**
 * 顶栏「切换用户」—— 运维 / 排障时**不用登出登录**就能以某个人的身份看一遍界面。
 *
 * ## 为什么是 Popover 而不是 DropdownMenu
 *
 * 这个面板里有一个**搜索框**。Base UI 的 `DropdownMenu` 是 menu 语义:里面的输入会被它抢焦点、
 * 交互一下就关掉;`Popover` 没有这层语义,才放得住"输入 + 长列表"。
 *
 * ## 可见性**不是安全边界**
 *
 * 这里靠 `useHasPerm("sys:user:impersonate")` 决定**显不显示**;真正的拦截在服务端
 * (`lib/auth-debug.ts` 的端点会再查一遍同一份权限集合,没权限直接 403)。
 * 所以就算有人手工 POST 那个接口,也一样过不去。
 *
 * ## 切完记住"从谁来的"
 *
 * 记录写在 `sessionStorage`(只影响当前标签页):顶栏据此常驻一个「切换身份中」徽章。
 * **原身份就在候选名单里**(正常一项),点它就切回去了 —— 不再单列「切回原本身份」那一项。
 *
 * ## 为什么切换到别人之后还能继续切
 *
 * 切换本身就要求**原身份**有 `sys:user:impersonate`;所以「继续切」沿用的是**原身份的授权**,
 * 凭据是服务端那份**签过名的原身份 cookie**。这不是提权:原身份被撤权后就只剩「切回原身」这一条例外。
 */
import { useQuery } from "@tanstack/react-query";
import { UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { Tag } from "#/components/ui/tag";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toastApiError } from "#/lib/api/error";
import { authClient } from "#/lib/auth-client";
import { ADMIN_ROLE_NAME, IMPERSONATE_PERM } from "#/lib/menu-spec";

/** 记录"从哪个身份切过来的"(只存当前标签页,关掉就没了) */
const FROM_KEY = "__impersonate_from";

type SwitchedFrom = { id: string; name: string };

function readFrom(): SwitchedFrom | null {
	try {
		const raw = sessionStorage.getItem(FROM_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as SwitchedFrom;
		return parsed?.id ? parsed : null;
	} catch {
		// 私密模式 / 存储被禁 / 脏值 —— 都按"没有记录"处理,不影响切换本身
		return null;
	}
}

export function UserSwitcher({ currentUser }: { currentUser: { id: string; name: string } }) {
	const canSwitch = useHasPerm(IMPERSONATE_PERM);
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [keyword, setKeyword] = useState("");
	const [pending, setPending] = useState(false);
	/** "从谁来的"(原身);SSR 阶段没有 sessionStorage,挂载后才读 */
	const [from, setFrom] = useState<SwitchedFrom | null>(null);
	// 挂载后判断"当前是不是在别人的身份里":
	//  ① sessionStorage 有记录(同标签页里切的,最快);
	//  ② 没有就**问服务端**(新标签页 / 存储被清时靠它 —— 否则入口会消失,人被卡在没权限的身份里)。
	useEffect(() => {
		const local = readFrom();
		if (local) {
			setFrom(local);
			return;
		}
		void (async () => {
			try {
				const result = (await authClient.$fetch("/debug/impersonator", { method: "GET" })) as {
					impersonator: { id: string; name: string } | null;
				};
				if (result?.impersonator) setFrom(result.impersonator);
			} catch {
				// 没登录 / 认不到原身 —— 都按"没有"处理,不影响正常切换
			}
		})();
	}, []);

	// 只要「当前身份有权限」**或**「正在以别人的身份浏览」就能取列表 ——
	// 后者由服务端按**原身份的签名 cookie**放行(它本来就有权限才能切过来,不是提权)。
	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: canSwitch || !!from });

	/** 按部门分组(按人的顺序,**不重排部门**)—— 管理员排最前,所以它那一组自然在最上面 */
	const groups = useMemo(() => {
		const kw = keyword.trim().toLowerCase();
		const rows = (usersQuery.data ?? [])
			.filter((user) => !kw || `${user.name} ${user.email}`.toLowerCase().includes(kw))
			.slice()
			.sort((left, right) => {
				const adminDiff =
					Number(!left.roleNames.includes(ADMIN_ROLE_NAME)) - Number(!right.roleNames.includes(ADMIN_ROLE_NAME));
				return adminDiff || (left.name || left.email).localeCompare(right.name || right.email, "zh-Hans-CN");
			});
		const map = new Map<string, typeof rows>();
		for (const user of rows) {
			const key = user.departmentNames[0] ?? "未加入部门";
			const bucket = map.get(key);
			if (bucket) bucket.push(user);
			else map.set(key, [user]);
		}
		return [...map.entries()];
	}, [usersQuery.data, keyword]);

	// ⚠️ `from` 存在时**即使没有切换权限也要显示** —— 一旦切到一个没有权限的人,
	// 那个新身份必须还能"切回原身",否则人就被困在别人身份里了(实测踩到过)。
	if (!canSwitch && !from) return null;

	async function switchTo(userId: string) {
		setPending(true);
		try {
			await authClient.$fetch("/debug/switch-user", { method: "POST", body: { userId } });
			try {
				if (userId === from?.id) {
					// 切回原身 → 把标记清掉(否则徽章会一直挂着,下次进来还以为自己是别人)
					sessionStorage.removeItem(FROM_KEY);
				} else if (!from) {
					// 只在"第一次切"时记原身 —— 连续切的时候别把中间那个身份当成原身
					sessionStorage.setItem(FROM_KEY, JSON.stringify({ id: currentUser.id, name: currentUser.name }));
				}
			} catch {
				// 存不进去(私密模式)也能切,只是没有"切回"的快捷入口
			}
			// 整页重载最稳:守卫、SSR loader、菜单可见性、所有缓存都会按新 cookie 重算
			window.location.reload();
		} catch (error) {
			toastApiError(error);
			setPending(false);
		}
	}

	return (
		<div className="flex items-center gap-1">
			{from ? (
				<Tag variant="outline" title={`原本身份:${from.name}`}>
					切换身份中
				</Tag>
			) : null}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={<Button variant="ghost" size="icon" aria-label="切换用户" title="切换用户" className="size-8" />}
				>
					<UserCog className="size-4" />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-80 p-0">
					<div className="space-y-2 p-2">
						{canSwitch || from ? (
							<Input
								value={keyword}
								onChange={(event) => setKeyword(event.target.value)}
								placeholder="搜索姓名或邮箱…"
								aria-label="搜索用户"
								className="h-8 text-sm"
							/>
						) : null}
					</div>

					<div className="max-h-[60vh] overflow-y-auto border-t border-border p-1">
						{usersQuery.isLoading ? (
							<p className="px-2 py-3 text-xs text-muted-foreground">加载中…</p>
						) : groups.length === 0 ? (
							<p className="px-2 py-3 text-xs text-muted-foreground">没有匹配的用户</p>
						) : (
							groups.map(([department, rows]) => (
								<div key={department} className="mb-1">
									<div className="px-2 py-1 text-xs font-medium text-muted-foreground">{department}</div>
									{rows.map((user) => {
										const isSelf = user.id === currentUser.id;
										return (
											<button
												type="button"
												key={user.id}
												disabled={pending || isSelf}
												onClick={() => void switchTo(user.id)}
												className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover disabled:cursor-default disabled:opacity-60"
											>
												<span className="min-w-0 flex-1 truncate text-sm">{user.name || user.email}</span>
												{isSelf ? <Tag variant="outline">当前</Tag> : null}
												{/* 姓名 + 角色,同一行;不要邮箱 */}
												<span className="shrink-0 truncate text-xs text-muted-foreground">
													{user.roleNames.join(" / ") || "未分配角色"}
												</span>
											</button>
										);
									})}
								</div>
							))
						)}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
