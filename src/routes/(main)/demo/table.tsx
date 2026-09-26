import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";

import { PageHeader } from "#/components/layout/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { createAppColumnHelper, useAppTable } from "#/lib/table";

export const Route = createFileRoute("/(main)/demo/table")({
	component: TableDemo,
});

type User = {
	id: number;
	name: string;
	email: string;
	role: "管理员" | "编辑" | "访客";
	status: "启用" | "邀请中" | "停用";
};

const ROLES = ["管理员", "编辑", "访客"] as const;
const STATUSES = ["启用", "邀请中", "停用"] as const;

/** 固定假数据,便于肉眼对照排序 / 筛选 / 分页是否真的生效 */
const USERS: Array<User> = Array.from({ length: 37 }, (_, i) => ({
	id: i + 1,
	name: `用户 ${String(i + 1).padStart(2, "0")}`,
	email: `user${i + 1}@example.com`,
	role: ROLES[i % ROLES.length],
	status: STATUSES[i % STATUSES.length],
}));

const STATUS_VARIANT: Record<User["status"], "default" | "secondary" | "destructive"> = {
	启用: "default",
	邀请中: "secondary",
	停用: "destructive",
};

// 列定义全部走 lib/table.ts 的 app column helper。
// `sortFn: "text"` 用的是字符串名 —— 它由 lib/table.ts 里注册的 sortFns 提供。
const columnHelper = createAppColumnHelper<User>();

const columns = columnHelper.columns([
	columnHelper.accessor("id", { header: "ID" }),
	columnHelper.accessor("name", { header: "姓名", sortFn: "text" }),
	columnHelper.accessor("email", { header: "邮箱", sortFn: "text" }),
	columnHelper.accessor("role", { header: "角色" }),
	columnHelper.accessor("status", {
		header: "状态",
		cell: (ctx) => <Badge variant={STATUS_VARIANT[ctx.getValue()]}>{ctx.getValue()}</Badge>,
	}),
]);

function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
	if (dir === "asc") return <ArrowUp className="size-3.5" />;
	if (dir === "desc") return <ArrowDown className="size-3.5" />;
	return <ChevronsUpDown className="size-3.5 opacity-40" />;
}

function TableDemo() {
	// 不传第二个 selector 参数 = 订阅全部已注册的 state 分片,
	// 因此排序 / 筛选 / 翻页都会触发重渲染。
	const table = useAppTable({
		columns,
		data: USERS,
		globalFilterFn: "includesString",
	});

	const rows = table.getRowModel().rows;
	const { pageIndex, pageSize } = table.state.pagination;
	const pageCount = table.getPageCount();
	const matched = table.getFilteredRowModel().rows.length;

	return (
		<div className="space-y-6">
			<PageHeader
				title="数据表格"
				description="TanStack Table v9 + lib/table.ts 的统一 app hook,配合 components/ui/table 原语渲染。"
			/>

			<Card>
				<CardContent className="space-y-4 pt-5">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="relative">
							<Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={table.state.globalFilter}
								onChange={(e) => table.setGlobalFilter(e.target.value)}
								placeholder="搜索姓名 / 邮箱…"
								className="h-8 w-64 pl-8"
							/>
						</div>
						<p className="text-sm text-muted-foreground">
							匹配 {matched} 条 · 共 {pageCount} 页
						</p>
					</div>

					<Table>
						<TableHeader>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id}>
									{headerGroup.headers.map((header) => {
										const dir = header.column.getIsSorted();
										return (
											<TableHead key={header.id}>
												{header.isPlaceholder ? null : header.column.getCanSort() ? (
													<button
														type="button"
														onClick={header.column.getToggleSortingHandler()}
														className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
													>
														<table.FlexRender header={header} />
														<SortIcon dir={dir} />
													</button>
												) : (
													<table.FlexRender header={header} />
												)}
											</TableHead>
										);
									})}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{rows.length === 0 ? (
								<TableRow>
									<TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
										没有匹配的数据
									</TableCell>
								</TableRow>
							) : (
								rows.map((row) => (
									<TableRow key={row.id}>
										{row.getAllCells().map((cell) => (
											<TableCell key={cell.id}>
												<table.FlexRender cell={cell} />
											</TableCell>
										))}
									</TableRow>
								))
							)}
						</TableBody>
					</Table>

					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm text-muted-foreground">
							第 {pageIndex + 1} / {Math.max(pageCount, 1)} 页 · 每页 {pageSize} 条
						</p>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => table.previousPage()}
								disabled={!table.getCanPreviousPage()}
							>
								上一页
							</Button>
							<Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
								下一页
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
