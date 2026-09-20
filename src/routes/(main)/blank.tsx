import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { StubPage } from "#/components/layout/stub-page";

export const Route = createFileRoute("/(main)/blank")({
	component: BlankPage,
});

function BlankPage() {
	return (
		<StubPage
			title="空白页"
			description="这是一个预留的空白页面,替换为你的业务模块即可。"
			icon={<FileText className="size-5" />}
		/>
	);
}
