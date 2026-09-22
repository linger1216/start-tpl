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
import { PARA_TYPE, PARA_TYPE_META, PARA_TYPES, type ParaType, validateParaValue } from "#/lib/para-spec";
import type { ParameterRow } from "./settings-parameters-table";

export type ParameterFormPayload = {
	key: string;
	value: string;
	type?: ParaType;
	group?: string;
	remark?: string;
};

/**
 * 参数表单 —— 同时服务「修改」(key 锁定,只改值)与「新增」(key / 类型 / 分组 / 说明都能填)。
 * 类型在保存前就校验(路由里再校验一次,双保险);
 * 类型码与 `sys_para.para_type` 一致(1 int / 2 bool / 3 string / 4 json),JSON 类用多行文本框。
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
	const [type, setType] = useState<ParaType>(PARA_TYPE.STRING);
	const [group, setGroup] = useState("");
	const [remark, setRemark] = useState("");

	useEffect(() => {
		if (!open) return;
		if (creating) {
			setKey("");
			setValue("");
			setType(PARA_TYPE.STRING);
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

	const effectiveType = creating ? type : (row?.type ?? PARA_TYPE.STRING);
	const problem = validateParaValue(effectiveType, value);
	const isJsonLike = effectiveType === PARA_TYPE.JSON;

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
						// 只展示表里真有的东西:说明(remark)+ 类型码(para_type)。
						// 「默认值」是代码内置值、不是表里的列,已从这里去掉(见 data-base-schema.ts)。
						<p className="rounded-lg bg-secondary px-3 py-2 text-[12px] text-muted-foreground">
							{row?.remark}
							<span className="ml-1">(类型 {PARA_TYPE_META[effectiveType].label})</span>
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
								<Select value={String(type)} onValueChange={(next) => setType(Number(next) as ParaType)}>
									<SelectTrigger id="cfg-type" size="sm" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PARA_TYPES.map((t) => (
											<SelectItem key={t} value={String(t)}>
												{PARA_TYPE_META[t].label}
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
								placeholder={'{"a":1} 或 ["a","b"]'}
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
							<p className="text-[11.5px] text-muted-foreground">{PARA_TYPE_META[effectiveType].hint}</p>
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
