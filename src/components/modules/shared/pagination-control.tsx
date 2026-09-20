import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "#/components/ui/button";
import { PAGE_SIZES } from "#/lib/constants";
import { cn } from "#/lib/utils";

/**
 * 列表分页器(公共控件):
 * - 左:每页条数[10/20/50/100] 一排按钮 + 共 X 条
 * - 右:上一页 / 页码 / 下一页(active 用 bg-primary text-primary-foreground)
 *
 * ponytail: 每页条数固定 4 档,用按钮组比 Select 更直观、
 * 避免 base-ui Select 的滚动箭头交互。
 */
export function PaginationControl({
	page,
	pageSize,
	total,
	onPageChange,
	onPageSizeChange,
}: {
	page: number;
	pageSize: number;
	total: number;
	onPageChange: (next: number) => void;
	onPageSizeChange: (next: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.min(page, totalPages);

	// 最多展示 7 个页码:当前页居中,首尾补全
	const pages = buildPageList(safePage, totalPages);

	return (
		<div className="flex flex-wrap items-center justify-between gap-2 pt-3">
			<div className="flex items-center gap-3 text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<span>每页</span>
					<div className="flex items-center rounded-lg bg-secondary p-0.5">
						{PAGE_SIZES.map((n) => {
							const active = n === pageSize;
							return (
								<button
									key={n}
									type="button"
									onClick={() => onPageSizeChange(n)}
									className={cn(
										"h-6 rounded-md px-2.5 text-xs font-medium transition-colors",
										active
											? "bg-card text-foreground shadow-(--shadow-card)"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{n}
								</button>
							);
						})}
					</div>
				</div>
				<span>共 {total.toLocaleString()} 条</span>
			</div>

			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={safePage <= 1}
					onClick={() => onPageChange(Math.max(1, safePage - 1))}
					aria-label="上一页"
				>
					<ChevronLeft className="size-4" />
				</Button>
				{pages.map((p, i) =>
					p === "..." ? (
						<span key={`gap-${pages[i - 1] ?? "start"}`} className="px-1 text-xs text-muted-foreground">
							…
						</span>
					) : (
						<button
							key={p}
							type="button"
							onClick={() => onPageChange(p)}
							className={cn(
								"inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-2.5 text-xs font-medium transition-colors",
								p === safePage ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
							)}
						>
							{p}
						</button>
					),
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={safePage >= totalPages}
					onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
					aria-label="下一页"
				>
					<ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function buildPageList(current: number, total: number): Array<number | "..."> {
	if (total <= 7) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}
	const list: Array<number | "..."> = [];
	const window = 1;
	const left = Math.max(2, current - window);
	const right = Math.min(total - 1, current + window);
	list.push(1);
	if (left > 2) list.push("...");
	for (let i = left; i <= right; i++) list.push(i);
	if (right < total - 1) list.push("...");
	list.push(total);
	return list;
}
