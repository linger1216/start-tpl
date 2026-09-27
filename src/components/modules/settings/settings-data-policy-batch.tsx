import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import {
	ACTION_LABEL,
	EFFECT_LABEL,
	POLICY_ACTIONS,
	POLICY_EFFECTS,
	type PolicyAction,
	type PolicyEffect,
} from "#/lib/data-policy-spec";

/** 「不动这一项」的哨兵值(Base UI 的 Select 不认 `null`,所以用一个不可能撞上的串) */
const KEEP = "__keep__";

export type PolicyBatchPayload = {
	action?: PolicyAction;
	effect?: PolicyEffect;
	status?: number;
};

const ACTION_ITEMS = [
	{ value: KEEP, label: "不改动作" },
	...POLICY_ACTIONS.map((act) => ({ value: act, label: ACTION_LABEL[act] ?? act })),
];
const EFFECT_ITEMS = [
	{ value: KEEP, label: "不改效果" },
	...POLICY_EFFECTS.map((eft) => ({ value: eft, label: EFFECT_LABEL[eft] })),
];
const STATUS_ITEMS = [
	{ value: KEEP, label: "不改启用状态" },
	{ value: "1", label: "启用" },
	{ value: "0", label: "停用" },
];

/**
 * 批量修改规则 —— 台账里勾了 N 条之后,一次改掉**标量**字段(动作 / 效果 / 启用)。
 *
 * 为什么只改标量、不给"批量改资源":那等于把 N 条规则搬到同一个键上,`(v0,v1,v2)` 唯一键会让
 * 96% 的组合都撞库;真要那样请用「新增规则」的批量登记(一个主体 × 多类资源一次落完)。
 *
 * 三个下拉各有「不改」:只给要动的那一项,别的原样带过去。服务端**按传入顺序逐行**处理,
 * 改动作撞上已有键的那行会跳过并回报名单 —— 所以这里不预先拦,让引擎说了算。
 */
export function SettingsDataPolicyBatch({
	count,
	open,
	onOpenChange,
	pending,
	onSubmit,
}: {
	/** 勾了几条(只用于文案) */
	count: number;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	pending: boolean;
	onSubmit: (payload: PolicyBatchPayload) => void;
}) {
	const [action, setAction] = useState<string>(KEEP);
	const [effect, setEffect] = useState<string>(KEEP);
	const [status, setStatus] = useState<string>(KEEP);

	useEffect(() => {
		if (!open) return;
		// 每次打开都从"什么都不改"开始:批量改错一行就是改错一批,默认必须是空手
		setAction(KEEP);
		setEffect(KEEP);
		setStatus(KEEP);
	}, [open]);

	const untouched = action === KEEP && effect === KEEP && status === KEEP;

	function handleSubmit() {
		if (untouched) return;
		onSubmit({
			...(action === KEEP ? {} : { action: action as PolicyAction }),
			...(effect === KEEP ? {} : { effect: effect as PolicyEffect }),
			...(status === KEEP ? {} : { status: Number(status) }),
		});
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>批量修改 {count} 条规则</DialogTitle>
					<DialogDescription>
						只改选中的这一批。留「不改」的项原样带过去;改动作时如果目标键已存在(同一个主体 + 资源 +
						动作),那一行会跳过,其余照改。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<DetailRow label="动作" htmlFor="policy-batch-action">
						<Select items={ACTION_ITEMS} value={action} onValueChange={(next) => setAction(next ?? KEEP)}>
							<SelectTrigger id="policy-batch-action" size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ACTION_ITEMS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>

					<DetailRow label="效果" htmlFor="policy-batch-effect">
						<Select items={EFFECT_ITEMS} value={effect} onValueChange={(next) => setEffect(next ?? KEEP)}>
							<SelectTrigger id="policy-batch-effect" size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{EFFECT_ITEMS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>

					<DetailRow label="启用" htmlFor="policy-batch-status">
						<Select items={STATUS_ITEMS} value={status} onValueChange={(next) => setStatus(next ?? KEEP)}>
							<SelectTrigger id="policy-batch-status" size="sm" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{STATUS_ITEMS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailRow>

					{untouched ? <p className="text-xs text-muted-foreground">至少选一项要改的内容。</p> : null}
				</div>

				<DialogFooter className="gap-2">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={pending || untouched} onClick={handleSubmit}>
						{pending ? "保存中…" : "应用"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
