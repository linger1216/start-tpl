import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { desc } from "drizzle-orm";
import { Database } from "lucide-react";
import { type FormEvent, useState } from "react";

import { EmptyState } from "#/components/layout/empty-state";
import { PageHeader } from "#/components/layout/page-header";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { JsonBlock } from "#/components/ui/json-block";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { db } from "#/db/index";
import { todos } from "#/db/schema";
import { formatLocalMinute } from "#/lib/time";

type TodoRow = { id: number; title: string; createdAt: Date | null };
/** 读失败也作为正常返回值:模板的 DATABASE_URL 是占位符,连不上不该整页崩。 */
type LoadResult = { ok: true; todos: TodoRow[] } | { ok: false; error: string };

const getTodos = createServerFn({ method: "GET" }).handler(async (): Promise<LoadResult> => {
	try {
		const rows = await db.select().from(todos).orderBy(desc(todos.createdAt)).limit(20);
		return { ok: true, todos: rows };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
});

/** 校验用 `.validator()` —— `.inputValidator()` 已弃用。 */
const createTodo = createServerFn({ method: "POST" })
	.validator((data: { title: string }) => data)
	.handler(async ({ data }) => {
		await db.insert(todos).values({ title: data.title });
	});

export const Route = createFileRoute("/(main)/demo/drizzle")({
	component: DemoDrizzle,
	loader: () => getTodos(),
});

function DemoDrizzle() {
	const router = useRouter();
	const result = Route.useLoaderData();
	const [title, setTitle] = useState("");
	const [saving, setSaving] = useState(false);
	const [writeError, setWriteError] = useState("");

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const value = title.trim();
		if (value.length === 0) return;
		setSaving(true);
		setWriteError("");
		try {
			await createTodo({ data: { title: value } });
			setTitle("");
			await router.invalidate();
		} catch (error) {
			setWriteError(error instanceof Error ? error.message : "写入失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-8">
			<PageHeader title="Drizzle ORM" description="MySQL + drizzle-orm/mysql2,读写都经 server function。" />

			<Card>
				<CardHeader>
					<CardTitle>todos</CardTitle>
					<CardDescription>src/db/schema.ts 里唯一的一张示例表,演示 select / insert。</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{result.ok ? (
						<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{result.todos.map((todo: TodoRow) => (
								<li key={todo.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
									<span className="text-[14px]">{todo.title}</span>
									<span className="font-mono text-muted-foreground">{formatLocalMinute(todo.createdAt)}</span>
								</li>
							))}
						</ul>
					) : (
						<EmptyState
							className="py-8"
							icon={<Database className="size-5" />}
							title={result.ok ? "还没有记录" : "数据库不可用"}
							description={result.ok ? "用下面的输入框写入第一条 todo。" : "配好 DATABASE_URL 后跑 pnpm db:push。"}
						/>
					)}

					{!result.ok && <JsonBlock value={result.error} />}

					<form onSubmit={handleSubmit} className="flex items-end gap-2">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="drizzle-todo-title">新增 todo</Label>
							<Input
								id="drizzle-todo-title"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="今天要做的事"
							/>
						</div>
						<Button type="submit" disabled={saving || title.trim().length === 0}>
							{saving && <Spinner size="sm" />}
							添加
						</Button>
					</form>

					{writeError && <p className="text-[13px] text-destructive">{writeError}</p>}
				</CardContent>
			</Card>
		</div>
	);
}
