import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { PAGE_SIZES } from "#/lib/constants";
import { cn } from "#/lib/utils";

/**
 * 列表分页器(公共控件):
 * - 左:每页条数[10/20/50/100] 一排按钮(选中态是会滑动过去的胶囊)+ 共 X 条
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

	/**
	 * 每页条数那一组:选中态是一枚**会滑过去的胶囊**,而不是"某个按钮换个底色"。
	 *
	 * 位置得量(4 个按钮不等宽:10 / 20 / 50 / 100),量完用 `transform` 平移 ——
	 * 用 `left` 会触发重排,用 `transform` 才是合成层动画(和全站动效口径一致)。
	 * `useLayoutEffect` 保证在浏览器绘制前就量好,不会先看到它从 0 滑过来。
	 */
	const sizeGroupRef = useRef<HTMLDivElement | null>(null);
	const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只跟 pageSize 走(按钮宽度由字号与 padding 决定,不随渲染变化)
	useLayoutEffect(() => {
		const group = sizeGroupRef.current;
		if (!group) return;
		const active = group.querySelector<HTMLElement>('[data-active="true"]');
		if (!active) return;
		setPill({ x: active.offsetLeft, w: active.offsetWidth });
	}, [pageSize]);

	// 最多展示 7 个页码:当前页居中,首尾补全
	const pages = buildPageList(safePage, totalPages);

	return (
		<div className="flex flex-wrap items-center justify-between gap-2 pt-3">
			<div className="flex items-center gap-3 text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<span>每页</span>
					<div ref={sizeGroupRef} className="relative flex items-center rounded-lg bg-secondary p-0.5">
						{pill ? (
							<span
								aria-hidden="true"
								className="pointer-events-none absolute inset-y-0.5 left-0 rounded-md bg-card shadow-card transition-[transform,width] duration-200 ease-brand"
								style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
							/>
						) : null}
						{PAGE_SIZES.map((n) => {
							const active = n === pageSize;
							return (
								<button
									key={n}
									type="button"
									data-active={active}
									onClick={() => onPageSizeChange(n)}
									className={cn(
										"relative z-10 h-6 rounded-md px-2.5 text-xs font-medium transition-colors",
										active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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
