import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseDataPage } from "#/components/modules/showcase/showcase-data-page";

export const Route = createFileRoute("/(main)/showcase/data")({
	component: ShowcaseDataPage,
});
