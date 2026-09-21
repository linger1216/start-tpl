import { Construction } from "lucide-react";

import { StubPage } from "#/components/layout/stub-page";

/**
 * 系统设置里**尚未接入数据源**的页面 —— 用户管理 / 用户组管理 / 角色管理三页共用这一份。
 *
 * 为什么是空的:这三页原来跑的是内存 mock(`mocks/settings.ts`,791 行种子数据),
 * 看上去能增删改查,实际刷新就回到种子、和真实库毫无关系 —— 容易被当成"已经实现"。
 * 本轮把 mock 整体删掉了,所以这里不再摆任何假数据,只留路由 + 一句"该做什么"。
 *
 * 接真实数据源时:按 `doc/前端结构与组件约定.md` 的页角色(`-page` / `-table` / `-form` /
 * `-form-mappers` / `-detail` / `-stats`)在本域重建,数据走 tRPC procedure。
 */
export function SettingsStubPage({ title, summary }: { title: string; summary: string }) {
	return (
		<StubPage
			title={title}
			description={`系统设置 ▸ ${title}:${summary}`}
			icon={<Construction className="size-5" />}
			hint="功能待实现(数据源尚未接入)"
		/>
	);
}
