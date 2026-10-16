import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { PageHeader } from "#/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Tag } from "#/components/ui/tag";
import { selectFullName, store } from "#/lib/demo-store";

export const Route = createFileRoute("/(main)/demo/store")({
	component: DemoStore,
});

function DemoStore() {
	const firstName = useStore(store, (state) => state.firstName);
	const lastName = useStore(store, (state) => state.lastName);
	const fullName = useStore(store, selectFullName);

	return (
		<div className="mx-auto w-full max-w-2xl space-y-6 p-6">
			<PageHeader
				title="TanStack Store"
				description="全局 store 的最小用法:useStore 订阅字段,setState 更新。"
				actions={<Tag variant="secondary">@tanstack/store</Tag>}
			/>

			<Card>
				<CardHeader>
					<CardTitle>用户信息</CardTitle>
					<CardDescription>改动输入框会立刻反映到下方的派生值。</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="first-name">First name</Label>
						<Input
							id="first-name"
							value={firstName}
							onChange={(event) => store.setState((state) => ({ ...state, firstName: event.target.value }))}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="last-name">Last name</Label>
						<Input
							id="last-name"
							value={lastName}
							onChange={(event) => store.setState((state) => ({ ...state, lastName: event.target.value }))}
						/>
					</div>
				</CardContent>
			</Card>

			<Card size="sm">
				<CardHeader>
					<CardTitle>派生值</CardTitle>
					<CardDescription>selectFullName(store.state) —— 普通函数,不需要额外的 store。</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="font-heading text-xl font-semibold text-foreground">{fullName}</p>
				</CardContent>
			</Card>
		</div>
	);
}
