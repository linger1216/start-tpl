import { useEffect, useState } from "react";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { PARA_TYPE, PARA_TYPE_META, PARA_TYPES, type ParaType, validateParaValue } from "#/lib/para-spec";
import type { ParameterRow } from "./settings-parameters-table";

export type ParameterFormPayload = {
	key: string;
	value: string;
	type?: ParaType;
	group?: string;
	remark?: string;
	/** 1 启用 / 0 停用(表里的 `status`,列表有这一列) */
	status?: number;
	/** 1 允许在界面修改 / 0 锁定(表里的 `editable`) */
	editable?: number;
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
	const [status, setStatus] = useState(true);
	const [editable, setEditable] = useState(true);

	/**
	 * 类型下拉的 `{ value, label }` 列表 —— **同一份**同时喂给 `<Select items>` 和 `<SelectItem>`。
	 *
	 * ⚠️ `items` 不能省:Base UI **不会**从 `<SelectItem>` 子元素收集 label(Radix / shadcn 才会),
	 * 没有 `items` 时触发器兜底画**原始 value**(实测这里画的是 `"3"` 而不是"文本")。
	 */
	const typeItems = PARA_TYPES.map((code) => ({ value: String(code), label: PARA_TYPE_META[code].label }));

	useEffect(() => {
		if (!open) return;
		if (creating) {
			setKey("");
			setValue("");
			setType(PARA_TYPE.STRING);
			setGroup("");
			setRemark("");
			setStatus(true);
			setEditable(true);
		} else if (row) {
			setKey(row.key);
			setValue(row.value);
			setType(row.type);
			setGroup(row.group);
			setRemark(row.remark);
			setStatus(row.status === 1);
			setEditable(row.editable);
		}
	}, [open, creating, row]);

	const effectiveType = creating ? type : (row?.type ?? PARA_TYPE.STRING);
	const effectiveRowId = row?.id ?? null;
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
						status: status ? 1 : 0,
						editable: editable ? 1 : 0,
					}
				: {
						key: row?.key ?? key.trim(),
						value: value.trim(),
						group: group.trim(),
						remark: remark.trim(),
						status: status ? 1 : 0,
						editable: editable ? 1 : 0,
					},
		);
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader>
					<DialogTitle>{creating ? "新增参数" : "修改参数"}</DialogTitle>
					<DialogDescription translate="no" className="min-w-0 font-mono text-xs">
						{creating ? "新建一个系统参数" : (row?.key ?? "")}
					</DialogDescription>
				</DialogHeader>

				<DialogBody>
					{!creating ? (
						// 只展示表里真有的东西:说明(remark)+ 类型码(para_type)。
						// 「默认值」是代码内置值、不是表里的列,已从这里去掉(见 data-base-schema.ts)。
						<p className="rounded-lg bg-secondary min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-xs text-muted-foreground">
							{row?.remark}
							<span className="ml-1">(类型 {PARA_TYPE_META[effectiveType].label})</span>
						</p>
					) : null}

					{creating ? (
						<div className="flex min-w-0 flex-col gap-3">
							<DetailRow label="参数名" htmlFor="cfg-key">
								<Input
									id="cfg-key"
									value={key}
									translate="no"
									spellCheck={false}
									placeholder="如 app.title"
									className="font-mono text-xs"
									onChange={(event) => setKey(event.target.value)}
								/>
							</DetailRow>
							<DetailRow label="类型" htmlFor="cfg-type">
								<Select
									items={typeItems}
									value={String(type)}
									// 换类型时给一个该类型合法的默认值(如 bool → "true"、int → "1"),
									// 否则旧值直接挂在新的校验上,保存键就会一直灰着
									onValueChange={(next) => {
										const nextType = Number(next) as ParaType;
										setType(nextType);
										if (validateParaValue(nextType, value) !== null) {
											setValue(nextType === PARA_TYPE.BOOL ? "true" : nextType === PARA_TYPE.INT ? "1" : "");
										}
									}}
								>
									<SelectTrigger id="cfg-type" size="sm" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{typeItems.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</DetailRow>
						</div>
					) : null}

					<DetailRow label="参数值" htmlFor="cfg-value" hint={problem ? undefined : PARA_TYPE_META[effectiveType].hint}>
						{effectiveType === PARA_TYPE.BOOL ? (
							// 布尔参数:开关,不是打字 —— 要改的只有 true / false 两个可能
							<Switch
								aria-label="参数值(布尔)"
								checked={value === "true"}
								onCheckedChange={(checked) => setValue(checked ? "true" : "false")}
							/>
						) : effectiveType === PARA_TYPE.INT ? (
							// 整数参数:数字输入 —— 键盘上/下步进 + 浏览器只收数字
							<Input
								id="cfg-value"
								type="number"
								inputMode="numeric"
								min={0}
								step={1}
								value={value}
								translate="no"
								spellCheck={false}
								className={`font-mono text-xs ${problem ? "border-destructive/60" : ""}`}
								onChange={(event) => setValue(event.target.value)}
							/>
						) : isJsonLike ? (
							<Textarea
								id="cfg-value"
								value={value}
								translate="no"
								spellCheck={false}
								rows={5}
								placeholder={'{"a":1} 或 ["a","b"]'}
								className={`min-w-0 break-all font-mono text-xs ${problem ? "border-destructive/60" : ""}`}
								onChange={(event) => setValue(event.target.value)}
							/>
						) : (
							<Input
								id="cfg-value"
								value={value}
								translate="no"
								spellCheck={false}
								className={`font-mono text-xs ${problem ? "border-destructive/60" : ""}`}
								onChange={(event) => setValue(event.target.value)}
							/>
						)}
						{problem ? <p className="text-xs text-destructive">{problem}</p> : null}
					</DetailRow>

					<DetailRow label="分组" htmlFor="cfg-group">
						<Input
							id="cfg-group"
							value={group}
							placeholder="如 业务配置(可空)"
							className="text-xs"
							onChange={(event) => setGroup(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label="说明" htmlFor="cfg-remark">
						<Input
							id="cfg-remark"
							value={remark}
							placeholder="给人看的参数说明"
							className="text-xs"
							onChange={(event) => setRemark(event.target.value)}
						/>
					</DetailRow>

					{/* 状态 / 可编辑是这个表的真实列(列表里都有),所以表单里也要能改 */}
					<div className="flex flex-col gap-1">
						<DetailRow label="启用">
							<Switch aria-label="启用" checked={status} onCheckedChange={setStatus} />
						</DetailRow>
						<DetailRow label="允许修改">
							<Switch aria-label="允许修改" checked={editable} onCheckedChange={setEditable} />
						</DetailRow>
					</div>
				</DialogBody>

				<DialogFooter>
					<DetailMeta
						meta={{ id: effectiveRowId, createdAt: row?.createdAt ?? null, updatedAt: row?.updatedAt ?? null }}
					/>
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
