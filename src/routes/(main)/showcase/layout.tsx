import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseLayoutPage } from "#/components/modules/showcase/showcase-layout-page";

export const Route = createFileRoute("/(main)/showcase/layout")({
	component: ShowcaseLayoutPage,
});
