import { Skeleton } from "#/components/ui/skeleton";
import { TableCell, TableRow } from "#/components/ui/table";
import { cn } from "#/lib/utils";

/** 统计卡加载骨架（grid 由调用方控制列数） */
export function StatCardsSkeleton({
	count = 4,
	cols = 4,
	className,
	compact = false,
}: {
	count?: number;
	cols?: 3 | 4;
	className?: string;
	compact?: boolean;
}) {
	return (
		<div
			className={cn(
				compact ? "grid grid-cols-2 gap-2 lg:flex lg:flex-wrap" : "grid grid-cols-1 gap-4 sm:grid-cols-2",
				!compact && (cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"),
				className,
			)}
		>
			{Array.from({ length: count }).map((_, i) => (
				<div
					key={i}
					className={cn(
						compact
							? "flex h-16 w-full items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 shadow-none lg:w-44"
							: "rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card)",
					)}
				>
					{compact ? (
						<>
							<Skeleton className="size-7 shrink-0 rounded-lg" />
							<div className="min-w-0 flex-1 space-y-1">
								<Skeleton className="h-3 w-12" />
								<Skeleton className="h-3 w-20" />
							</div>
							<Skeleton className="h-5 w-10 shrink-0" />
						</>
					) : (
						<>
							<div className="flex items-center justify-between">
								<Skeleton className="h-3 w-16" />
								<Skeleton className="size-9 rounded-xl" />
							</div>
							<Skeleton className="mt-3 h-8 w-24" />
							<Skeleton className="mt-2.5 h-3 w-28" />
						</>
					)}
				</div>
			))}
		</div>
	);
}

/** 表格加载骨架行（替换“加载中…”占位） */
export function TableSkeleton({
	rows = 5,
	cols = 1,
	cellClassName,
}: {
	rows?: number;
	cols?: number;
	cellClassName?: string;
}) {
	return (
		<>
			{Array.from({ length: rows }).map((_, r) => (
				<TableRow key={r}>
					<TableCell colSpan={cols} className="py-2.5">
						<Skeleton className={cn("h-4 w-full", cellClassName)} />
					</TableCell>
				</TableRow>
			))}
		</>
	);
}
