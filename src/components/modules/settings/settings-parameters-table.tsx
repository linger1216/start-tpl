import { Pencil } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";

export type ParameterRow = {
	key: string;
	value: string;
	defaultValue: string;
	type: "int" | "bool" | "string";
	group: string;
	remark: string;
	editable: boolean;
	overridden: boolean;
	updatedAt: string | null;
};

const TYPE_LABEL: Record<string, string> = { int: "整数", bool: "开关", string: "文本" };

/**
 * 参数清单 —— 每一行**自带说明**(参数最容易变成"不敢改的谜")。
 * 「来源」列区分"默认值"与"已改过",免得人分不清哪个是代码内置、哪个是自己调的。
 */
export function SettingsParametersTable({
	rows,
	onEdit,
}: {
	rows: readonly ParameterRow[];
	onEdit: (row: ParameterRow) => void;
}) {
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="min-w-[14rem]">参数名</TableHead>
						<TableHead className="min-w-[8rem]">分组</TableHead>
						<TableHead className="min-w-[8rem]">当前值</TableHead>
						<TableHead className="min-w-[6rem]">类型</TableHead>
						<TableHead className="min-w-[22rem]">说明</TableHead>
						<TableHead className="min-w-[7rem]">来源</TableHead>
						<TableHead className="min-w-[6rem]">操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
								没有参数。跑一次 <span translate="no">pnpm db:seed:configs</span> 会把内置参数落到库里。
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<TableRow key={row.key}>
								<TableCell translate="no" className="font-mono text-[12px] text-foreground">
									{row.key}
								</TableCell>
								<TableCell>
									<Badge variant="secondary" className="text-[11.5px]">
										{row.group}
									</Badge>
								</TableCell>
								<TableCell translate="no" className="font-mono text-[12.5px] font-medium text-foreground">
									{row.value}
								</TableCell>
								<TableCell className="text-[12px] text-muted-foreground">{TYPE_LABEL[row.type] ?? row.type}</TableCell>
								<TableCell className="text-[12px] text-muted-foreground">{row.remark}</TableCell>
								<TableCell>
									{row.overridden ? (
										<Badge variant="outline" className="text-[11px]">
											已改过
										</Badge>
									) : (
										<Badge variant="outline" className="text-[11px] text-muted-foreground">
											默认值
										</Badge>
									)}
								</TableCell>
								<TableCell>
									<Button
										variant="outline"
										size="xs"
										disabled={!row.editable}
										aria-label={`修改参数 ${row.key}`}
										className="text-muted-foreground hover:text-foreground"
										onClick={() => onEdit(row)}
									>
										<Pencil className="size-3" />
										修改
									</Button>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
