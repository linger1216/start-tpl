import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageHeader } from "#/components/layout/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/(main)/demo/trpc-todo")({
	component: TRPCTodos,
	loader: async ({ context }) => {
		await context.queryClient.prefetchQuery(context.trpc.todos.list.queryOptions());
	},
});

/**
 * tRPC v11 headless 模式的用法:
 *   1. `useTRPC()` 拿到类型安全的代理(没有 api.useUtils() / proc.useMutation())
 *   2. `useQuery(trpc.x.queryOptions())` / `useMutation(trpc.x.mutationOptions())`
 *   3. 失效用 TanStack Query 自己的 queryClient,key 由 `trpc.x.queryKey()` 提供
 */
function TRPCTodos() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");

	const { data, isPending } = useQuery(trpc.todos.list.queryOptions());

	const addTodo = useMutation(
		trpc.todos.add.mutationOptions({
			onSuccess: async () => {
				setName("");
				await queryClient.invalidateQueries({ queryKey: trpc.todos.list.queryKey() });
			},
		}),
	);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed.length === 0) return;
		addTodo.mutate({ name: trimmed });
	};

	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-8">
			<PageHeader title="tRPC" description="服务端 procedure 直连,类型从 router 推导到组件,无需手写接口层。" />

			<Card>
				<CardHeader>
					<CardTitle>todos</CardTitle>
					<CardDescription>
						数据存在服务端内存里(见 <code>src/integrations/trpc/router.ts</code>),重启即清空。
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{isPending ? (
						<Spinner label="加载中…" />
					) : data && data.length > 0 ? (
						<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{data.map((todo) => (
								<li key={todo.id} className="flex items-center gap-3 px-3 py-2.5">
									<Badge variant="secondary">#{todo.id}</Badge>
									<span className="text-[14px]">{todo.name}</span>
								</li>
							))}
						</ul>
					) : (
						<EmptyState
							className="py-8"
							title="还没有待办"
							description="用下面的输入框添加第一条,列表会通过 invalidateQueries 自动更新。"
						/>
					)}

					<form onSubmit={handleSubmit} className="flex items-end gap-2">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="trpc-todo-name">新增待办</Label>
							<Input
								id="trpc-todo-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="例如:读完模板 AGENTS.md"
							/>
						</div>
						<Button type="submit" disabled={addTodo.isPending || name.trim().length === 0}>
							{addTodo.isPending && <Spinner size="sm" />}
							添加
						</Button>
					</form>

					{addTodo.isError && (
						<p className="text-[13px] text-destructive">
							{addTodo.error instanceof Error ? addTodo.error.message : "添加失败"}
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
