import { Columns3, GripVertical, Lock } from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import type { MockRow, useAppTable } from "#/lib/table";
import { cn } from "#/lib/utils";

/**
 * 列显示开关 —— 台账表格「显示哪些字段、按什么顺序」的入口,和搜索框一起放在**卡片外面**的工具条里。
 *
 * 三件事都在这里:
 *  1. **勾选 / 取消**某列(取消后**表头和数据一起消失**,由 `DataTable` 的 `getVisibleCells` 保证);
 *  2. **拖动排序**(行首那个把手;HTML5 拖放,和树用的是同一套原生行为);
 *  3. 把结果**回调出去**,由页面写进 `sys_para` 的 `page.columns`(见 `hooks/use-column-prefs.ts`)——
 *     组件本身不认识 tRPC,这样它才能在工作台里当纯展示件用。
 *
 * 为什么用 Popover 而不是 DropdownMenu:菜单项是"点一下就走"的语义,而这里要在浮层里**持续拖动**,
 * 还需要一行说明文字 —— 气泡更贴合。
 *
 * 列来源是 TanStack Table 的 `getAllLeafColumns()`,**不手写第二份列清单**:
 * 所以列定义加一列,这个开关自动多一项,不会漂移。
 * `getCanHide() === false` 的列(操作列 / 勾选列)显示一把锁,不给隐藏。
 */
export function ColumnToggle<TRow extends MockRow>({
	table,
	onPersist,
}: {
	table: ReturnType<typeof useAppTable<TRow>>;
	/** 顺序 / 隐藏变化后回调(页面用它写进 `page.columns`);不传就是纯内存态(工作台示例用) */
	onPersist?: (next: { order: string[]; hidden: string[] }) => void;
}) {
	const columns = table.getAllLeafColumns();
	const [dragId, setDragId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);

	// 没有可操作的列就不渲染 —— 省得出现一个点开是空的假开关
	if (columns.length === 0) return null;

	const currentOrder = columns.map((column) => column.id);

	/** 隐藏列 id 列表(可带一个"刚刚切换"的覆盖值 —— state 更新是异步的,不能马上读回来) */
	const hiddenIds = (override?: { id: string; visible: boolean }) =>
		columns
			.filter((column) => (override && column.id === override.id ? !override.visible : !column.getIsVisible()))
			.map((column) => column.id);

	function commit(next?: { order?: string[]; toggle?: { id: string; visible: boolean } }) {
		onPersist?.({ order: next?.order ?? currentOrder, hidden: hiddenIds(next?.toggle) });
	}

	function toggle(id: string, visible: boolean) {
		table.getColumn(id)?.toggleVisibility(visible);
		commit({ toggle: { id, visible } });
	}

	function move(from: string, to: string) {
		const fromIndex = currentOrder.indexOf(from);
		const toIndex = currentOrder.indexOf(to);
		if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
		const next = [...currentOrder];
		next.splice(fromIndex, 1);
		next.splice(toIndex, 0, from);
		table.setColumnOrder(next);
		commit({ order: next });
	}

	return (
		<Popover>
			<PopoverTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
				<Columns3 className="size-3.5" />列
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 p-0">
				<div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">拖动排序 · 勾选显示</div>
				<div className="max-h-72 overflow-y-auto p-1">
					{columns.map((column) => {
						const label = typeof column.columnDef.header === "string" ? column.columnDef.header : column.id;
						const canHide = column.getCanHide();
						const isOver = overId === column.id && dragId !== null && dragId !== column.id;
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: 整行只承载拖放(HTML5 DnD);真正可操作的是行首把手与复选框
							<div
								key={column.id}
								draggable
								onDragStart={() => setDragId(column.id)}
								onDragEnd={() => {
									setDragId(null);
									setOverId(null);
								}}
								onDragOver={(event) => {
									event.preventDefault();
									setOverId(column.id);
								}}
								onDrop={(event) => {
									event.preventDefault();
									if (dragId) move(dragId, column.id);
									setDragId(null);
									setOverId(null);
								}}
								className={cn(
									"flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60",
									isOver && "bg-brand-faint ring-1 ring-primary/40",
									dragId === column.id && "opacity-50",
								)}
							>
								<GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
								{canHide ? (
									<Checkbox
										aria-label={`显示「${label}」列`}
										checked={column.getIsVisible()}
										onCheckedChange={(checked) => toggle(column.id, checked === true)}
									/>
								) : (
									<Lock className="size-3.5 shrink-0 text-muted-foreground/40" aria-hidden="true" />
								)}
								<span className={cn("min-w-0 flex-1 truncate", !column.getIsVisible() && "text-muted-foreground")}>
									{label}
								</span>
							</div>
						);
					})}
				</div>
				<div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
					<span className="text-xs text-muted-foreground">锁定的列不可隐藏</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-xs"
						onClick={() => {
							table.setColumnVisibility({});
							table.setColumnOrder(currentOrder);
							// 重置:顺序保持现状,隐藏列表清空
							onPersist?.({ order: currentOrder, hidden: [] });
						}}
					>
						全部显示
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
