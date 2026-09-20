import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseBlocksPage } from "#/components/modules/showcase/showcase-blocks-page";

export const Route = createFileRoute("/(main)/showcase/blocks")({
	component: ShowcaseBlocksPage,
});
