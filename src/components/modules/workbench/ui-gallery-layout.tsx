import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { cn } from "#/lib/utils";

/** 一格:标题 + 说明 + 渲染区。`wide` 让它在网格里跨满整行(内容宽的例子用) */
export function Cell({
	name,
	hint,
	wide = false,
	children,
}: {
	name: string;
	hint?: string;
	wide?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("min-w-0 rounded-xl border border-border bg-card p-3", wide && "md:col-span-2 xl:col-span-3")}>
			<div className="mb-2 flex items-baseline gap-2">
				<code className="font-mono text-xs text-foreground">{name}</code>
				{hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
			</div>
			<div className={cn(wide ? "space-y-2" : "flex flex-wrap items-center gap-2")}>{children}</div>
		</div>
	);
}

export function Group({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{title}</CardTitle>
				<CardDescription>{desc}</CardDescription>
			</CardHeader>
			<CardContent className="pt-0">
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
			</CardContent>
		</Card>
	);
}
