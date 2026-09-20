import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseUiPage } from "#/components/modules/showcase/showcase-ui-page";

export const Route = createFileRoute("/(main)/showcase/ui")({
	component: ShowcaseUiPage,
});
