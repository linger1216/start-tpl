import { useEffect, useState } from "react";
import type { ParameterRow } from "#/components/modules/settings/settings-parameters-table";
import { Badge } from "#/components/ui/badge";
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

/**
 * 改一个参数值。**只改值,不改名** —— 参数名是代码里的契约,改名等于换了个参数。
 * 类型在保存前就校验(路由里再校验一次,双保险)。
 */
export function SettingsParametersForm({
	row,
	open,
	pending,
	onOpenChange,
	onSubmit,
}: {
	row: ParameterRow | null;
	open: boolean;
	pending: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (key: string, value: string) => void;
}) {
	const [value, setValue] = useState("");

	useEffect(() => {
		if (open && row) setValue(row.value);
	}, [open, row]);

	const problem =
		row?.type === "int" && !/^-?\d+$/.test(value.trim())
			? "这个参数要填整数"
			: row?.type === "bool" && !["true", "false"].includes(value.trim())
				? "这个参数只能填 true / false"
				: null;

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>修改参数</DialogTitle>
					<DialogDescription translate="no" className="font-mono text-[12px]">
						{row?.key ?? ""}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<p className="rounded-lg bg-[color:var(--secondary)] px-3 py-2 text-[12px] text-muted-foreground">
						{row?.remark}
						<span className="ml-1">
							(类型 {row?.type === "int" ? "整数" : row?.type === "bool" ? "true/false" : "文本"},默认值{" "}
							<span translate="no" className="font-mono">
								{row?.defaultValue}
							</span>
							)
						</span>
					</p>
					<div className="space-y-1.5">
						<Label htmlFor="cfg-value" className="text-[12px]">
							参数值
						</Label>
						<Input
							id="cfg-value"
							value={value}
							translate="no"
							spellCheck={false}
							className={problem ? "font-mono text-[12px] border-destructive/60" : "font-mono text-[12px]"}
							onChange={(event) => setValue(event.target.value)}
						/>
						{problem ? <p className="text-[11.5px] text-destructive">{problem}</p> : null}
					</div>
					{row?.type === "bool" ? (
						<div className="flex items-center gap-1.5">
							<Badge variant="outline" className="text-[11px]">
								提示
							</Badge>
							<span className="text-[11.5px] text-muted-foreground">同步开关默认关闭:先把某个源手动跑通再打开。</span>
						</div>
					) : null}
					{row?.key.startsWith("raw.retention") ? (
						<p className="text-[11.5px] text-muted-foreground">
							保留策略只对**已抽取**的数据生效;未抽取 / 失败的行永不清理。
						</p>
					) : null}
				</div>

				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={pending || Boolean(problem) || !row} onClick={() => row && onSubmit(row.key, value.trim())}>
						{pending ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
