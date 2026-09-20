import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseTablePage } from "#/components/modules/showcase/showcase-table-page";

export const Route = createFileRoute("/(main)/showcase/table")({
	component: ShowcaseTablePage,
});
