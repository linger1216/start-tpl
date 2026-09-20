import type { ReactNode } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageHeader } from "#/components/layout/page-header";

/**
 * 通用占位页面：标题 + 描述 + 空态。
 * 等真实业务接入后替换此组件。
 */
export function StubPage({
	title,
	description,
	icon,
	hint,
	actions,
}: {
	title: string;
	description: string;
	icon?: ReactNode;
	hint?: string;
	actions?: ReactNode;
}) {
	return (
		<div>
			<PageHeader title={title} description={description} actions={actions} />
			<EmptyState
				title={hint ?? "功能开发中"}
				description="该模块已预留路由，等待业务逻辑接入。"
				icon={icon}
				actions={actions}
			/>
		</div>
	);
}
