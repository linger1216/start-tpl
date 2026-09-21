import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { CONFIG_TYPE_META, type ConfigType, validateConfigValue } from "#/lib/config-spec";
import type { ParameterRow } from "./settings-parameters-table";

export type ParameterFormPayload = {
	key: string;
	value: string;
	type?: ConfigType;
	group?: string;
	remark?: string;
};

const TYPES: ConfigType[] = ["string", "int", "bool", "json", "array", "map"];

/**
 * 参数表单 —— 同时服务「修改」(key 锁定,只改值)与「新增」(key / 类型 / 分组 / 说明都能填)。
 * 类型在保存前就校验(路由里再校验一次,双保险);
 * json / array / map 三类用多行文本框录入(JSON 文本),其余用单行输入框。
 */
export function SettingsParametersForm({
	row,
	creating,
	open,
	pending,
	onOpenChange,
	onSubmit,
}: {
	row: ParameterRow | null;
	creating: boolean;
	open: boolean;
	pending: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (payload: ParameterFormPayload) => void;
}) {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [type, setType] = useState<ConfigType>("string");
	const [group, setGroup] = useState("");
	const [remark, setRemark] = useState("");

	useEffect(() => {
		if (!open) return;
		if (creating) {
			setKey("");
			setValue("");
			setType("string");
			setGroup("");
			setRemark("");
		} else if (row) {
			setKey(row.key);
			setValue(row.value);
			setType(row.type);
			setGroup(row.group);
			setRemark(row.remark);
		}
	}, [open, creating, row]);

	const effectiveType = creating ? type : (row?.type ?? "string");
	const problem = validateConfigValue(effectiveType, value);
	const isJsonLike = effectiveType === "json" || effectiveType === "array" || effectiveType === "map";

	function handleSubmit() {
		if (problem) return;
		onSubmit(
			creating
				? {
						key: key.trim(),
						value: value.trim(),
						type,
						group: group.trim() || undefined,
						remark: remark.trim() || undefined,
					}
				: { key: row?.key ?? key.trim(), value: value.trim() },
		);
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{creating ? "新增参数" : "修改参数"}</DialogTitle>
					<DialogDescription translate="no" className="font-mono text-[12px]">
						{creating ? "新建一个系统参数" : (row?.key ?? "")}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					{!creating ? (
						<p className="rounded-lg bg-[color:var(--secondary)] px-3 py-2 text-[12px] text-muted-foreground">
							{row?.remark}
							<span className="ml-1">
								(类型 {CONFIG_TYPE_META[effectiveType].label},默认值{" "}
								<span translate="no" className="font-mono">
									{row?.defaultValue}
								</span>
								)
							</span>
						</p>
					) : null}

					{creating ? (
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="cfg-key" className="text-[12px]">
									参数名
								</Label>
								<Input
									id="cfg-key"
									value={key}
									translate="no"
									spellCheck={false}
									placeholder="如 app.title"
									className="font-mono text-[12px]"
									onChange={(event) => setKey(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="cfg-type" className="text-[12px]">
									类型
								</Label>
								<Select value={type} onValueChange={(next) => setType(next as ConfigType)}>
									<SelectTrigger id="cfg-type" size="sm" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TYPES.map((t) => (
											<SelectItem key={t} value={t}>
												{CONFIG_TYPE_META[t].label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					) : null}

					<div className="space-y-1.5">
						<Label htmlFor="cfg-value" className="text-[12px]">
							参数值
						</Label>
						{isJsonLike ? (
							<Textarea
								id="cfg-value"
								value={value}
								translate="no"
								spellCheck={false}
								rows={5}
								placeholder={
									effectiveType === "array" ? '["a","b"]' : effectiveType === "map" ? '{"k":"v"}' : '{"a":1}'
								}
								className={`font-mono text-[12px] ${problem ? "border-destructive/60" : ""}`}
								onChange={(event) => setValue(event.target.value)}
							/>
						) : (
							<Input
								id="cfg-value"
								value={value}
								translate="no"
								spellCheck={false}
								className={`font-mono text-[12px] ${problem ? "border-destructive/60" : ""}`}
								onChange={(event) => setValue(event.target.value)}
							/>
						)}
						{problem ? (
							<p className="text-[11.5px] text-destructive">{problem}</p>
						) : (
							<p className="text-[11.5px] text-muted-foreground">{CONFIG_TYPE_META[effectiveType].hint}</p>
						)}
					</div>

					{creating ? (
						<>
							<div className="space-y-1.5">
								<Label htmlFor="cfg-group" className="text-[12px]">
									分组
								</Label>
								<Input
									id="cfg-group"
									value={group}
									placeholder="如 业务配置(可空)"
									className="text-[12px]"
									onChange={(event) => setGroup(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="cfg-remark" className="text-[12px]">
									说明
								</Label>
								<Input
									id="cfg-remark"
									value={remark}
									placeholder="给人看的参数说明"
									className="text-[12px]"
									onChange={(event) => setRemark(event.target.value)}
								/>
							</div>
						</>
					) : null}
				</div>

				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						disabled={pending || Boolean(problem) || (creating && key.trim().length === 0)}
						onClick={handleSubmit}
					>
						{pending ? "保存中…" : creating ? "创建" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
