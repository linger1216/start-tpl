import { useEffect, useState } from "react";

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

export type GridFormPayload = {
	name: string;
	townId: string | null;
	townName: string | null;
	ownerId: string | null;
	ownerName: string | null;
	duty: string | null;
	remark: string | null;
};

export type Option = { value: string; label: string };

/**
 * 网格的新建 / 编辑。
 *
 * 字段就这几个(方案里定的"不用建那么多"):**所属街镇** + **网格名称(=片区)** 是主字段,
 * 另加**负责人**(指派给哪个系统账号)、Excel 里的**网格长姓名**、职务、备注。
 */
export function GridForm({
	open,
	onOpenChange,
	pending,
	editing,
	townOptions,
	userOptions,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	editing: {
		id: string;
		name: string;
		townId: string | null;
		townName: string | null;
		ownerId: string | null;
		ownerName: string | null;
		duty: string | null;
		remark: string | null;
	} | null;
	townOptions: Option[];
	userOptions: Option[];
	onSubmit: (payload: GridFormPayload) => void;
}) {
	const [name, setName] = useState("");
	const [townId, setTownId] = useState("");
	const [ownerId, setOwnerId] = useState("");
	const [ownerName, setOwnerName] = useState("");
	const [duty, setDuty] = useState("");
	const [remark, setRemark] = useState("");

	// 打开时用编辑对象回填(新建则清空)
	useEffect(() => {
		if (!open) return;
		setName(editing?.name ?? "");
		setTownId(editing?.townId ?? "");
		setOwnerId(editing?.ownerId ?? "");
		setOwnerName(editing?.ownerName ?? "");
		setDuty(editing?.duty ?? "");
		setRemark(editing?.remark ?? "");
	}, [open, editing]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{editing ? "编辑网格" : "新增网格"}</DialogTitle>
					<DialogDescription>
						「所属街镇」决定**队长**看得到哪些(**本部门及以下**);「负责人」决定**队员**看得到哪些(只看自己负责的)。
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="space-y-1 py-1">
					<DetailRow label="所属街镇">
						<Select
							items={townOptions}
							value={townId || null}
							onValueChange={(next) => setTownId(next ? String(next) : "")}
						>
							<SelectTrigger id="grid-town" size="sm" className="w-full">
								<SelectValue placeholder="请选择所属街镇" />
							</SelectTrigger>
							<SelectContent>
								{townOptions.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>
					<DetailRow label="网格名称(片区)" htmlFor="grid-name">
						<Input
							id="grid-name"
							className="h-8 text-sm"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="如:中春片区"
						/>
					</DetailRow>
					<DetailRow label="负责人(系统账号)">
						<Select
							items={userOptions}
							value={ownerId || null}
							onValueChange={(next) => setOwnerId(next ? String(next) : "")}
						>
							<SelectTrigger id="grid-owner" size="sm" className="w-full">
								<SelectValue placeholder="未指定(指定后队员才看得到)" />
							</SelectTrigger>
							<SelectContent>
								{userOptions.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>
					<DetailRow label="网格长姓名(Excel 原样)" htmlFor="grid-owner-name">
						<Input
							id="grid-owner-name"
							className="h-8 text-sm"
							value={ownerName}
							onChange={(e) => setOwnerName(e.target.value)}
							placeholder="如:沈佳梅"
						/>
					</DetailRow>
					<DetailRow label="工作职务" htmlFor="grid-duty">
						<Input
							id="grid-duty"
							className="h-8 text-sm"
							value={duty}
							onChange={(e) => setDuty(e.target.value)}
							placeholder="如:党委副书记(党群)"
						/>
					</DetailRow>
					<DetailRow label="备注" htmlFor="grid-remark">
						<Input
							id="grid-remark"
							className="h-8 text-sm"
							value={remark}
							onChange={(e) => setRemark(e.target.value)}
						/>
					</DetailRow>
				</DialogBody>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
						取消
					</Button>
					<Button
						onClick={() =>
							onSubmit({
								name: name.trim(),
								townId: townId || null,
								townName: townOptions.find((t) => t.value === townId)?.label ?? null,
								ownerId: ownerId || null,
								ownerName: ownerName.trim() || null,
								duty: duty.trim() || null,
								remark: remark.trim() || null,
							})
						}
						disabled={pending || !name.trim()}
					>
						{pending ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
