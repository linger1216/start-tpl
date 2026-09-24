import { RefreshCw } from "lucide-react";

import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/**
 * 页面刷新按钮 —— **纯图标**,全站一个样子(放在页头右侧那排)。
 *
 * 为什么收成一个件:
 *  · 刷新是**每个页面都有的同一个动作**,以前各页手写,结果是"有的有、有的没有"(字典 / 菜单 / 部门三页漏了),
 *    而且写法不一(带文字的长按钮)。
 *  · `busy` 时**转起来 + 禁用**:这是"点到了 / 正在取数"的即时反馈 —— 手写时容易漏掉,漏了就变成
 *    "点了没反应"(得看页面别处才知道在加载)。
 *
 * 位置约定:**页头 `actions` 的最后一个动作按钮之前**(信息徽章 → 刷新 → 主操作 CTA)。
 * 数据在页内卡片上的额外刷新入口(比如台账工具条)也用这一个,免得又长出第二种刷新按钮。
 */
export function RefreshButton({ busy = false, onClick }: { busy?: boolean; onClick: () => void }) {
	return (
		<Button size="icon-sm" variant="outline" disabled={busy} aria-label="刷新" title="刷新" onClick={onClick}>
			<RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
		</Button>
	);
}
