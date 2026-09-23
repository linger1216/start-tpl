import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { ActionButton } from "#/components/ui/action-button";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

/**
 * 台账工具栏 —— 跨域共用件(见 `doc/前端结构与组件约定.md` §5.4)。
 *
 * 版式不变式(此前 52 个页面各写一遍,只有部分页面记住了这两条):
 *  1. **选中态并入同一行**:勾选行时在右侧"同一位置替换"操作组,行高固定 `h-8`,
 *     表格与工具栏纹丝不动,不出现视觉跳动;
 *  2. **右侧容器宽度固定**(`min-w-72` + 右对齐),左侧搜索框吃掉剩余宽度(`flex-1 min-w-80`),
 *     所以选中前后搜索框宽度也不变。
 *
 * 边界:只负责这一行的版式。表格、列定义、数据订阅、增删改写操作仍留在各业务页
 * (§0 第 3 条:不做表格封装),这里通过 `actions` / 回调把它们接进来。
 */
export function LedgerToolbar({
	search,
	onSearchChange,
	searchPlaceholder,
	selectedCount = 0,
	onClearSelection,
	onBulkDelete,
	selectionUnit = "条",
	actions,
	className,
}: {
	/** 受控搜索词(通常就是 `table.state.globalFilter`) */
	search: string;
	/** 搜索词变化;调用方在这里把页码回到第一页 */
	onSearchChange: (value: string) => void;
	searchPlaceholder?: string;
	/** 当前选中条数(0 时右侧显示 `actions`) */
	selectedCount?: number;
	onClearSelection?: () => void;
	/** 批量删除:调用方负责弹确认框 */
	onBulkDelete?: () => void;
	selectionUnit?: string;
	/** 未选中时右侧的操作按钮(新增 / 导入 / 导出 …) */
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
				<button
					type="button"
					aria-label="清除搜索"
					title="清除搜索"
					disabled={!search}
					onClick={() => onSearchChange("")}
					className="absolute top-1/2 right-2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors disabled:cursor-default disabled:opacity-35 enabled:cursor-pointer enabled:hover:bg-muted enabled:hover:text-foreground"
				>
					<X className="size-3.5" />
				</button>
			</div>

			<div className="ml-auto flex min-h-8 min-w-72 flex-wrap items-center justify-end gap-2">
				{selectedCount > 0 ? (
					<>
						<span className="flex h-8 items-center rounded-lg bg-primary/5 px-2.5 text-[12.5px] whitespace-nowrap text-foreground">
							已选 <span className="px-1 font-medium tabular-nums">{selectedCount}</span> {selectionUnit}
						</span>
						<ActionButton onClick={onClearSelection}>取消选择</ActionButton>
						<ActionButton tone="danger" onClick={onBulkDelete}>
							批量删除
						</ActionButton>
					</>
				) : (
					actions
				)}
			</div>
		</div>
	);
}
