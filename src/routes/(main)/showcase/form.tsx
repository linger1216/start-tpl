import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseFormPage } from "#/components/modules/showcase/showcase-form-page";

export const Route = createFileRoute("/(main)/showcase/form")({
	component: ShowcaseFormPage,
});
