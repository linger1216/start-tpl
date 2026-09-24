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
 * 记录写在 `sessionStorage`(只影响当前标签页):顶栏据此常驻一个「切换身份中」徽章 +
 * 面板里的「切回原本身份」——**忘了切回来是这类功能最常见的翻车方式**。
 */
import { useQuery } from "@tanstack/react-query";
import { Check, UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { useHasPerm } from "#/hooks/use-perms";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";
import { authClient } from "#/lib/auth-client";
import { IMPERSONATE_PERM } from "#/lib/menu-spec";

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
	// 挂载后再读:SSR 阶段没有 sessionStorage,直接读会造成水合不一致
	const [from, setFrom] = useState<SwitchedFrom | null>(null);
	useEffect(() => setFrom(readFrom()), []);

	const usersQuery = useQuery({ ...trpc.user.list.queryOptions(), enabled: canSwitch });

	/** 按部门分组 —— 调试"某部门的人能看到什么"时,按部门找最顺手 */
	const groups = useMemo(() => {
		const kw = keyword.trim().toLowerCase();
		const rows = (usersQuery.data ?? []).filter(
			(user) => !kw || `${user.name} ${user.email}`.toLowerCase().includes(kw),
		);
		const map = new Map<string, typeof rows>();
		for (const user of rows) {
			const key = user.departmentNames[0] ?? "未加入部门";
			const bucket = map.get(key);
			if (bucket) bucket.push(user);
			else map.set(key, [user]);
		}
		return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0], "zh-Hans-CN"));
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
			toast.error(toApiError(error).message);
			setPending(false);
		}
	}

	return (
		<div className="flex items-center gap-1">
			{from ? (
				<Badge variant="outline" title={`原本身份:${from.name}`}>
					切换身份中
				</Badge>
			) : null}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={<Button variant="ghost" size="icon" aria-label="切换用户" title="切换用户" className="size-8" />}
				>
					<UserCog className="size-4" />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-[22rem] p-0">
					<div className="space-y-2 p-2">
						{canSwitch ? (
							<Input
								value={keyword}
								onChange={(event) => setKeyword(event.target.value)}
								placeholder="搜索姓名或邮箱…"
								aria-label="搜索用户"
								className="h-8 text-[13px]"
							/>
						) : null}
						{from ? (
							<button
								type="button"
								disabled={pending}
								onClick={() => void switchTo(from.id)}
								className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-[12.5px] transition-colors duration-150 hover:bg-hover disabled:opacity-60"
							>
								<Check className="size-3.5 shrink-0 text-primary" />
								切回原本身份({from.name})
							</button>
						) : null}
					</div>

					{!canSwitch ? (
						<p className="border-t border-border px-3 py-2.5 text-[12px] text-muted-foreground">
							当前身份没有切换他人的权限,但你可以切回原本身份。
						</p>
					) : (
						<div className="max-h-[60vh] overflow-y-auto border-t border-border p-1">
							{usersQuery.isLoading ? (
								<p className="px-2 py-3 text-[12px] text-muted-foreground">加载中…</p>
							) : groups.length === 0 ? (
								<p className="px-2 py-3 text-[12px] text-muted-foreground">没有匹配的用户</p>
							) : (
								groups.map(([department, rows]) => (
									<div key={department} className="mb-1">
										<div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{department}</div>
										{rows.map((user) => {
											const isSelf = user.id === currentUser.id;
											return (
												<button
													type="button"
													key={user.id}
													disabled={pending || isSelf}
													onClick={() => void switchTo(user.id)}
													className="flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover disabled:cursor-default disabled:opacity-60"
												>
													<span className="flex items-center gap-2">
														<span className="truncate text-[13px]">{user.name || user.email}</span>
														{isSelf ? <Badge variant="outline">当前</Badge> : null}
													</span>
													<span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
													<BadgeList
														values={user.roleNames}
														layout="wrap"
														color="stable"
														emptyPlaceholder="未分配角色"
													/>
												</button>
											);
										})}
									</div>
								))
							)}
						</div>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);
}
