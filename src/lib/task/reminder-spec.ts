import { z } from "zod";

const channels = z
	.array(z.enum(["in_app", "sms", "email"]))
	.max(3)
	.refine((values) => new Set(values).size === values.length);
const rule = (min: number) =>
	z
		.object({
			offsets: z
				.array(z.number().int().min(min).max(525600))
				.max(10)
				.refine((values) => new Set(values).size === values.length),
			channels,
		})
		.refine((value) => value.offsets.length === 0 || value.channels.length > 0, { message: "请至少选择一种提醒方式" });

export const DEFAULT_TASK_REMINDERS = {
	executor: { offsets: [], channels: [] },
	node: { offsets: [60, 180], channels: ["in_app"] },
} as const;
export const taskReminderConfigSchema = z
	.object({ executor: rule(0), node: rule(1) })
	.default({ executor: { offsets: [], channels: [] }, node: { offsets: [60, 180], channels: ["in_app"] } });
export type TaskReminderConfig = z.infer<typeof taskReminderConfigSchema>;

export function reminderEvents(
	config: TaskReminderConfig,
	kind: "executor" | "node",
	anchor: Date,
	now: Date,
): Array<{ at: Date; offset: number }> {
	return config[kind].offsets
		.map((offset) => ({ at: new Date(anchor.getTime() + (kind === "executor" ? -1 : 1) * offset * 60000), offset }))
		.filter((event) => event.at.getTime() > now.getTime())
		.sort((a, b) => a.at.getTime() - b.at.getTime());
}
