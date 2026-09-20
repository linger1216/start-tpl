import { createFileRoute } from "@tanstack/react-router";

import { ShowcaseFeedbackPage } from "#/components/modules/showcase/showcase-feedback-page";

export const Route = createFileRoute("/(main)/showcase/feedback")({
	component: ShowcaseFeedbackPage,
});
