import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Switch } from "#/components/ui/switch";
import { PLUGIN_ITEM_KEY_MAX, PLUGIN_ITEM_VALUE_MAX, PLUGIN_ITEMS_MAX } from "#/lib/data-scope-spec";
import type { PluginRow } from "./settings-data-plugins-table";

/**
 * v2 (m20034) 起,新建插件的入参 —— 用户只能建「指定清单」类插件,**必须**给一份
 * `outputValues`(`{ key, value }[]`),引擎把它当成这个插件的输出。
 *
 * `pluginKey` 由用户手填(`/^[A-Za-z_][A-Za-z0-9_]*$/`)。`status` 编辑时才用 —— 新建默认 1。
 */
export type PluginFormPayload = {
	pluginKey: string;
	label: string;
	outputValues: Array<{ key: string; value: string }>;
	remark?: string;
	status?: number;
};

/**
 * 值域插件表单 —— v2 (m20034) 起只支持**指定清单**。
 *
 * 「输出值」是一张 `{key,value}` 表格(增减行 + 双文本框):
 *  - `key` 可以填列名(`town_id` / `risk_level` / `owner_id` …),也可以填任意字符串当分类用;
 *  - `value` 是真值,与「规则.列」设定的 `column` 配对,引擎会按 `row[column]` 取值再 `in (...)`。
 *
 * 与「数据范围规则」的分工 —— 输出值在**插件**里,不在规则里:
 *  - 数据范围规则不存 `outputValues`,只引用 `plugin_key`(改插件的清单**不会**让规则变 draft);
 *  - 一个插件一份清单,可以给多列复用;
 *  - 同一个插件的不同规则拿到的值一致 —— 不存在"这条规则的清单是 5 项,那条是 3 项"的歧义。
 *
 * 保存权限走 rbac 权限点(`sys:plugin:add` / `sys:plugin:edit`),不再有额外的超管门槛。
 */
export function SettingsDataPluginsForm({
	row,
	creating,
	open,
	onOpenChange,
	onSubmit,
	pending = false,
}: {
	row: PluginRow | null;
	creating: boolean;
	open: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (payload: PluginFormPayload) => void;
	pending?: boolean;
}) {
	const [pluginKey, setPluginKey] = useState("");
	const [label, setLabel] = useState("");
	const [items, setItems] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
	const [remark, setRemark] = useState("");
	const [status, setStatus] = useState(1);

	useEffect(() => {
		if (!open) return;
		if (creating || !row) {
			setPluginKey("");
			setLabel("");
			setItems([{ key: "", value: "" }]);
			setRemark("");
			setStatus(1);
			return;
		}
		setPluginKey(row.pluginKey);
		setLabel(row.label);
		setItems(
			row.outputValues.length > 0
				? row.outputValues.map((it) => ({ key: it.key, value: it.value }))
				: [{ key: "", value: "" }],
		);
		setRemark(row.remark);
		setStatus(Number(row.status) === 1 ? 1 : 0);
	}, [open, creating, row]);

	const validItems = items.filter((it) => it.key.trim() !== "" && it.value !== "");

	const submitProblem = (() => {
		if (!pluginKey.trim()) return "标识不能为空(只允许字母 / 数字 / 下划线,且不能以数字开头)";
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pluginKey.trim())) {
			return "标识只能是字母、数字、下划线,且不能以数字开头";
		}
		if (!label.trim()) return "名字不能为空";
		if (validItems.length === 0) return "「指定清单」至少要填一行(key + value 都不能空)";
		if (validItems.length > PLUGIN_ITEMS_MAX) return `「指定清单」最多 ${PLUGIN_ITEMS_MAX} 行`;
		for (const it of validItems) {
			if (it.key.length > PLUGIN_ITEM_KEY_MAX) return `key 太长(最多 ${PLUGIN_ITEM_KEY_MAX} 字符)`;
			if (it.value.length > PLUGIN_ITEM_VALUE_MAX) return `value 太长(最多 ${PLUGIN_ITEM_VALUE_MAX} 字符)`;
		}
		return null;
	})();

	function handleSubmit() {
		if (submitProblem) return;
		onSubmit({
			pluginKey: pluginKey.trim(),
			label: label.trim(),
			outputValues: validItems,
			remark: remark || undefined,
			status,
		});
	}

	function addItem() {
		setItems((prev) => {
			if (prev.length >= PLUGIN_ITEMS_MAX) return prev;
			return [...prev, { key: "", value: "" }];
		});
	}

	function removeItem(idx: number) {
		setItems((prev) => prev.filter((_, i) => i !== idx));
	}

	function patchItem(idx: number, patch: Partial<{ key: string; value: string }>) {
		setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader className="shrink-0">
					<DialogTitle>{creating ? "新增值域插件" : "修改值域插件"}</DialogTitle>
					<DialogDescription>
						插件回答的是「对**这个人**,哪些值算他的」—— 输出一串「{"{key, value}"}」,规则再按 `column` 取 `row[column]`
						拼成 SQL `column in (...)`。规则只引用插件的标识,所以标识建好之后不能改。
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="flex flex-col gap-3">
					<DetailRow label="标识" htmlFor="plugin-key">
						<div className="flex flex-col gap-1">
							<Input
								id="plugin-key"
								value={pluginKey}
								disabled={!creating}
								translate="no"
								spellCheck={false}
								placeholder="如 my_towns"
								className="font-mono text-xs"
								onChange={(event) => setPluginKey(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								{creating
									? "只允许字母、数字、下划线,且不能以数字开头 —— 规则行是拿它引用插件的。"
									: "标识建好之后不能改(改了已有规则会静默失效)。要换标识就删了重建。"}
							</p>
						</div>
					</DetailRow>

					<DetailRow label="名字" htmlFor="plugin-label">
						<Input
							id="plugin-label"
							value={label}
							maxLength={64}
							placeholder="如 我管辖的街镇"
							onChange={(event) => setLabel(event.target.value)}
						/>
					</DetailRow>

					<DetailRow label="输出值" htmlFor="plugin-output-values">
						<div className="flex flex-col gap-2">
							<div className="flex flex-col gap-1.5 rounded-md border border-border/60">
								<div className="grid grid-cols-[1fr_1fr_2.25rem] items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
									<span>key(类别)</span>
									<span>value(真值)</span>
									<span />
								</div>
								{items.map((it, idx) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: 行号即身份(key+value 有拼接排序的边界,见 `data-scope.ts:router` 的 `sameItems`)
										key={`item-row-${idx}`}
										className="grid grid-cols-[1fr_1fr_2.25rem] items-center gap-1.5 px-2 py-1"
									>
										<Input
											value={it.key}
											translate="no"
											spellCheck={false}
											maxLength={PLUGIN_ITEM_KEY_MAX}
											placeholder="如 town_id"
											className="font-mono text-xs"
											onChange={(event) => patchItem(idx, { key: event.target.value })}
										/>
										<Input
											value={it.value}
											translate="no"
											spellCheck={false}
											maxLength={PLUGIN_ITEM_VALUE_MAX}
											placeholder="如 七宝镇"
											className="font-mono text-xs"
											onChange={(event) => patchItem(idx, { value: event.target.value })}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="size-7"
											aria-label="删除这一行"
											onClick={() => removeItem(idx)}
										>
											<Trash2 className="size-3.5" />
										</Button>
									</div>
								))}
							</div>
							<div className="flex items-center justify-between">
								<p className="text-xs text-muted-foreground">
									「{validItems.length} / {PLUGIN_ITEMS_MAX} 行」—— key 与 value 都填才算数;留空行会在提交时被忽略。
								</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={items.length >= PLUGIN_ITEMS_MAX}
									onClick={addItem}
								>
									<Plus className="size-3.5" />
									加一行
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">
								最常见的写法:key 填「列名」、value 填「真值」,规则端再按「列」取 `row[column]`。一行就是 SQL 里 `column
								in (…)` 的一项。
							</p>
						</div>
					</DetailRow>

					<DetailRow label="说明" htmlFor="plugin-remark">
						<Input
							id="plugin-remark"
							value={remark}
							maxLength={255}
							placeholder="这个插件解决什么场景"
							onChange={(event) => setRemark(event.target.value)}
						/>
					</DetailRow>

					<DetailRow label="状态">
						<div className="flex items-center gap-2">
							<Switch checked={status === 1} onCheckedChange={(next) => setStatus(next ? 1 : 0)} />
							<span className="text-xs text-muted-foreground">
								{status === 1 ? "启用" : "停用(用了它的规则会变成一行也看不到)"}
							</span>
						</div>
					</DetailRow>
				</DialogBody>

				{submitProblem ? <p className="text-xs text-destructive">{submitProblem}</p> : null}
				{creating ? null : <DetailMeta meta={{ createdAt: row?.createdAt, updatedAt: row?.updatedAt }} />}

				<DialogFooter>
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button type="button" disabled={Boolean(submitProblem) || pending} onClick={handleSubmit}>
						{pending ? "保存中…" : creating ? "新增" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
