import { createFileRoute } from "@tanstack/react-router";
import { SettingsSchedulerPage } from "#/components/modules/settings/settings-scheduler-page";
import { ensurePageSize } from "#/hooks/use-para-prefs";

export const Route = createFileRoute("/(main)/settings/scheduler")({
	loader: ({ context }) =>
		Promise.all([
			ensurePageSize(context),
			context.queryClient.ensureQueryData(context.trpc.scheduler.list.queryOptions()),
		]),
	component: SettingsSchedulerPage,
});
