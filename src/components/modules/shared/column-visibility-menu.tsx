import { Columns3, GripVertical, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";

/**
 * **「列」选择器** —— 决定表格显示哪些列、以及它们的**显示顺序**,改动即持久化
 * (见 `use-column-visibility.ts`)。
 *
 * 为什么不用现成的下拉原语:这里要的是"多选 + 常驻勾选态 + 拖拽排序",
 * 自己用绝对定位面板实现最直接,也不会和 Popover 的焦点行为打架(点勾选不该关闭面板)。
 *
 * 拖拽用原生 HTML5(`draggable` + `onDragOver` + `onDrop`),不引第三方拖拽库 ——
 * 只是"把一行插到另一行前面"这一件事,不值得多一个依赖。
 */
export function ColumnVisibilityMenu({
	items,
	isVisible,
	onToggle,
	onMove,
	onShowAll,
	onInvert,
	onReset,
	visibleCount,
	totalCount,
}: {
	/** **按当前显示顺序**传进来(未按可见性过滤)—— 面板里拖动就是改这个顺序 */
	items: ReadonlyArray<{ key: string; label: string }>;
	isVisible: (key: string) => boolean;
	onToggle: (key: string) => void;
	/** 把 `fromKey` 拖到 `toKey` 的位置 */
	onMove: (fromKey: string, toKey: string) => void;
	onShowAll: () => void;
	onInvert: () => void;
	onReset: () => void;
	visibleCount: number;
	totalCount: number;
}) {
	const [open, setOpen] = useState(false);
	/** 正在被拖的那一行(`null` = 没在拖) */
	const [dragging, setDragging] = useState<string | null>(null);
	/** 当前悬停到哪一行(画一条插入线,给个"会落到这儿"的反馈) */
	const [over, setOver] = useState<string | null>(null);

	return (
		<div className="relative">
			<Button variant="outline" size="sm" aria-label="选择要显示的列" onClick={() => setOpen((prev) => !prev)}>
				<Columns3 className="size-3.5" />列
				<span className="ml-1 tabular-nums text-muted-foreground">
					{visibleCount}/{totalCount}
				</span>
			</Button>
			{open ? (
				<>
					{/* 点击面板外关闭 */}
					<button
						type="button"
						aria-label="关闭列选择"
						className="fixed inset-0 z-40 cursor-default"
						onClick={() => setOpen(false)}
					/>
					<div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2 shadow-md">
						<div className="flex items-center justify-between gap-1 pb-1.5">
							<span className="text-[11.5px] text-muted-foreground">
								显示 {visibleCount} / {totalCount} 列
							</span>
							<div className="flex items-center gap-0.5">
								<Button variant="ghost" size="xs" onClick={onShowAll}>
									全选
								</Button>
								<Button variant="ghost" size="xs" onClick={onInvert}>
									反选
								</Button>
								<Button variant="ghost" size="xs" onClick={onReset} aria-label="恢复默认列">
									<RotateCcw className="size-3" />
								</Button>
							</div>
						</div>
						<ul className="max-h-72 space-y-0.5 overflow-auto">
							{items.map((item) => (
								<li
									key={item.key}
									draggable
									onDragStart={() => setDragging(item.key)}
									onDragEnd={() => {
										setDragging(null);
										setOver(null);
									}}
									onDragOver={(event) => {
										// 必须 preventDefault,否则浏览器不认为这里是可放置区
										event.preventDefault();
										setOver(item.key);
									}}
									onDrop={(event) => {
										event.preventDefault();
										if (dragging) onMove(dragging, item.key);
										setDragging(null);
										setOver(null);
									}}
									className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-secondary ${
										dragging === item.key ? "opacity-40" : ""
									} ${over === item.key && dragging && dragging !== item.key ? "border-t-2 border-primary" : ""}`}
								>
									<GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
									<Checkbox
										checked={isVisible(item.key)}
										onCheckedChange={() => onToggle(item.key)}
										aria-label={`显示列 ${item.label}`}
									/>
									<span className="truncate">{item.label}</span>
								</li>
							))}
						</ul>
						<p className="px-1.5 pt-1.5 text-[11px] text-muted-foreground">拖动左侧手柄可调整列顺序</p>
					</div>
				</>
			) : null}
		</div>
	);
}
