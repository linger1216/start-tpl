import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { ActionIconButton } from "#/components/ui/action-button";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

/**
 * 台账工具栏 —— 跨域共用件(见 `doc/前端结构与组件约定.md` §5.4)。
 *
 * 版式不变式:
 *  1. **左侧搜索框吃掉剩余宽度**(`flex-1 min-w-80`),右侧操作组**宽度固定**(`min-w-72` + 右对齐),
 *     所以窗口变化时搜索框自己伸缩、按钮不跟着漂;
 *  2. 行高固定 `h-8`,和表格行高区分开(工具条不是数据行)。
 *
 * 边界:只负责这一行的版式。表格、列定义、数据订阅、增删改写操作仍留在各业务页
 * (§0 第 3 条:不做表格封装),这里通过 `actions` / 回调把它们接进来。
 */
export function LedgerToolbar({
	search,
	onSearchChange,
	searchPlaceholder,
	actions,
	className,
}: {
	/** 受控搜索词(通常就是 `table.state.globalFilter`) */
	search: string;
	/** 搜索词变化;调用方在这里把页码回到第一页 */
	onSearchChange: (value: string) => void;
	searchPlaceholder?: string;
	/** 右端的操作按钮(刷新 / 列 / 导出 / 新增 …) */
	actions?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			<div className="relative min-w-80 flex-1">
				<Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={search}
					onChange={(event) => onSearchChange(event.target.value)}
					placeholder={searchPlaceholder}
					className="h-8 pr-8 pl-8"
				/>
				{/* 清除搜索:常驻显示(输入为空时置灰禁用),避免图标一会儿有一会儿没有 */}
				<span className="absolute top-1/2 right-2 -translate-y-1/2">
					<ActionIconButton label="清除搜索" disabled={!search} onClick={() => onSearchChange("")}>
						<X className="size-3.5" />
					</ActionIconButton>
				</span>
			</div>

			<div className="ml-auto flex min-h-8 min-w-72 flex-wrap items-center justify-end gap-2">{actions}</div>
		</div>
	);
}
