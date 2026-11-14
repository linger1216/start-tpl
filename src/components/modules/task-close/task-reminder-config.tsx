import { useState } from "react";
import { ActionButton } from "#/components/ui/action-button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import type { TaskReminderConfig } from "#/lib/task/reminder-spec";

const CHANNELS = [
	["in_app", "站内"],
	["email", "邮件"],
	["sms", "短信"],
] as const;
const UNITS = [
	{ value: "1", label: "分钟" },
	{ value: "60", label: "小时" },
	{ value: "1440", label: "天" },
];

function formatOffset(minutes: number) {
	if (minutes === 0) return "截止时";
	if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
	if (minutes % 60 === 0) return `${minutes / 60} 小时`;
	return `${minutes} 分钟`;
}

function ReminderRule({
	title,
	kind,
	value,
	onChange,
}: {
	title: string;
	kind: "executor" | "node";
	value: TaskReminderConfig["node"];
	onChange: (value: TaskReminderConfig["node"]) => void;
}) {
	const [amount, setAmount] = useState("1");
	const [unit, setUnit] = useState("60");
	const offset = Number(amount) * Number(unit);
	const valid =
		amount.trim() !== "" &&
		Number.isInteger(offset) &&
		offset >= (kind === "executor" ? 0 : 1) &&
		offset <= 525600 &&
		!value.offsets.includes(offset) &&
		value.offsets.length < 10;
	return (
		<fieldset className="grid gap-2">
			<legend className="mb-2 text-sm font-medium">{title}</legend>
			<p className="text-xs text-muted-foreground">
				{kind === "executor"
					? "截止前提醒；可设置 0 分钟在截止时提醒。未设置截止时间时暂不安排。"
					: "节点激活后仍未查看时提醒。"}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{value.offsets.map((item) => (
					<span key={item} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
						{formatOffset(item)}
						<ActionButton
							onClick={() => onChange({ ...value, offsets: value.offsets.filter((entry) => entry !== item) })}
						>
							移除
						</ActionButton>
					</span>
				))}
				{value.offsets.length === 0 && <span className="text-xs text-muted-foreground">未设置时间点，提醒已关闭</span>}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					aria-label={`${title}时间`}
					type="number"
					min={kind === "executor" ? 0 : 1}
					step={1}
					className="h-8 w-24"
					value={amount}
					onChange={(event) => setAmount(event.target.value)}
				/>
				<Select
					value={unit}
					onValueChange={(next) => {
						if (next) setUnit(next);
					}}
					items={UNITS}
				>
					<SelectTrigger className="h-8 w-24">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{UNITS.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<ActionButton disabled={!valid} onClick={() => onChange({ ...value, offsets: [...value.offsets, offset] })}>
					添加时间点
				</ActionButton>
			</div>
			<p className="text-xs text-muted-foreground">最多 10 个不重复时间点，最长 365 天。</p>
			<div className="flex flex-wrap items-center gap-4 text-sm">
				<span>提醒方式</span>
				{CHANNELS.map(([channel, label]) => (
					<label key={channel} htmlFor={`${kind}-${channel}`} className="flex items-center gap-1.5">
						<Checkbox
							id={`${kind}-${channel}`}
							checked={value.channels.includes(channel)}
							onCheckedChange={(checked) =>
								onChange({
									...value,
									channels: checked ? [...value.channels, channel] : value.channels.filter((item) => item !== channel),
								})
							}
						/>
						{label}
					</label>
				))}
			</div>
			{value.offsets.length > 0 && value.channels.length === 0 && (
				<p className="text-xs text-destructive">请至少选择一种提醒方式。</p>
			)}
		</fieldset>
	);
}

export function TaskReminderConfigEditor({
	value,
	onChange,
}: {
	value: TaskReminderConfig;
	onChange: (value: TaskReminderConfig) => void;
}) {
	return (
		<div className="grid gap-5">
			<ReminderRule
				title="执行人截止提醒"
				kind="executor"
				value={value.executor}
				onChange={(executor) => onChange({ ...value, executor })}
			/>
			<ReminderRule
				title="节点处理人未查看提醒"
				kind="node"
				value={value.node}
				onChange={(node) => onChange({ ...value, node })}
			/>
		</div>
	);
}
