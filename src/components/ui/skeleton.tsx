import { TableCell, TableRow } from "#/components/ui/table";
import { cn } from "#/lib/utils";

/**
 * 骨架屏 —— 三件套都在这里:`Skeleton`(基础块)+ `SkeletonCards` / `SkeletonTable`(现成的组合)。
 *
 * 为什么合并成一个文件:它们本来就是同一件事(占位形状),此前拆成 `skeleton` + `skeleton-blocks`
 * 两个文件、两个 import 路径,调用方还得记住"哪个在哪"。合并后一个路径拿全。
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("skeleton-shimmer rounded-md bg-muted text-foreground", className)}
			{...props}
		/>
	);
}

/** 统计卡加载骨架（数量由调用方控制） */
export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
	return (
		<div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className="rounded-xl border border-border bg-background px-3 py-2.5">
					<div className="flex items-center justify-between">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="size-7 rounded-lg" />
					</div>
					<Skeleton className="mt-3 h-8 w-24" />
					<Skeleton className="mt-2.5 h-3 w-28" />
				</div>
			))}
		</div>
	);
}

/** 表格加载骨架行（替换“加载中…”占位） */
export function SkeletonTable() {
	return (
		<>
			{Array.from({ length: 5 }).map((_, r) => (
				<TableRow key={r}>
					<TableCell colSpan={1} className="py-2.5">
						<Skeleton className="h-4 w-full" />
					</TableCell>
				</TableRow>
			))}
		</>
	);
}

export { Skeleton };
