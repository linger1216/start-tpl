import { createFileRoute } from "@tanstack/react-router";

import { WorkbenchPage } from "#/components/modules/workbench/workbench-page";

export const Route = createFileRoute("/(main)/")({
	component: WorkbenchPage,
});
