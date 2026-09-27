import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageHeader } from "#/components/layout/page-header";

export const Route = createFileRoute("/(main)/blank")({
	component: BlankPage,
});

/** 预留的空白页:标题 + 描述 + 空态。替换为你的业务模块即可。 */
function BlankPage() {
	return (
		<div>
			<PageHeader title="空白页" description="这是一个预留的空白页面,替换为你的业务模块即可。" />
			<EmptyState
				title="功能开发中"
				description="该模块已预留路由,等待业务逻辑接入。"
				icon={<FileText className="size-5" />}
			/>
		</div>
	);
}
