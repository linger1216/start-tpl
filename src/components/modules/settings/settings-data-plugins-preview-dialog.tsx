import { useQuery } from "@tanstack/react-query";
import type { PluginRow } from "#/components/modules/settings/settings-data-plugins-table";
import { PolicyContextBlock } from "#/components/modules/shared/policy-context-block";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { RefreshButton } from "#/components/ui/refresh-button";
import { useTRPC } from "#/integrations/trpc/react";
import { toApiError } from "#/lib/api/error";

/**
 * 「预览值域」弹窗 —— 拿**当前登录人**真算一次,把取到的值原样列出来。
 *
 * 为什么单独成文件:它与数据范围那两个弹窗是同一类东西(一个只读的试算口),数据范围那份
 * (`settings-data-scope-preview-dialog.tsx`)早就单独成文件 —— 内联在页面里会让页面
 * 一半是台账、一半是弹窗版面。
 *
 * 想换人就用系统的"切换身份",这里不另开通道(预览值域的"按谁的算"始终是当前人)。
 * 插件写错只会"一条都取不到",这里能当场看见;取不到值说明配置有问题,不是"这个人恰好没有"。
 */
export function SettingsDataPluginsPreviewDialog({
	row,
	open,
	onOpenChange,
}: {
	row: PluginRow | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const testQuery = useQuery({
		...trpc.dataPlugin.test.queryOptions({ pluginKey: row?.pluginKey ?? "" }),
		enabled: open,
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>预览值域 · {row?.label ?? ""}</DialogTitle>
					<DialogDescription>
						这就是这个插件**当前身份**取到的值 —— 拿真实的人算,不是模拟。取不到值说明配置有问题,不是"这个人恰好没有"。
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<DetailRow label="插件标识">
						<span translate="no" className="font-mono text-xs">
							{row?.pluginKey}
						</span>
					</DetailRow>

					{/* 当前上下文(谁) */}
					<div className="flex flex-col gap-1.5">
						<p className="text-xs text-muted-foreground">当前上下文</p>
						{testQuery.data ? (
							<PolicyContextBlock
								userName={testQuery.data.userName}
								isMe={testQuery.data.isMe}
								roles={testQuery.data.roles}
								ancestors={testQuery.data.ancestors}
								departmentChildren={testQuery.data.children}
								density="compact"
							/>
						) : (
							<div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground">
								正在算…
							</div>
						)}
					</div>

					{/* 输出值(插件取到的) —— 一列:原始对象,是什么显示什么,不查名字(m18546);v1.4 m18655 起返对象数组,这里 JSON 化贴出 */}
					<div className="flex flex-col gap-1.5">
						<p className="text-xs text-muted-foreground">输出值(原始对象)</p>
						<div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
							{testQuery.isFetching ? (
								<p className="text-muted-foreground">算着呢…</p>
							) : testQuery.error ? (
								<p className="text-destructive">{toApiError(testQuery.error).message}</p>
							) : testQuery.data ? (
								<div className="flex flex-col gap-1">
									<p className="text-foreground">
										取到 <span className="font-semibold tabular-nums">{testQuery.data.rows.length}</span> 行
										{testQuery.data.message ? (
											<span className="text-muted-foreground"> · {testQuery.data.message}</span>
										) : null}
									</p>
									{testQuery.data.rows.length > 0 ? (
										<pre className="code-block max-h-48 rounded bg-background p-2 leading-relaxed break-all text-foreground/90">
											{testQuery.data.rows.map((item) => JSON.stringify(item)).join("\n")}
										</pre>
									) : null}
								</div>
							) : (
								<p className="text-muted-foreground">正在算…</p>
							)}
						</div>
					</div>
				</div>
				<DialogFooter>
					<RefreshButton busy={testQuery.isFetching} onClick={() => void testQuery.refetch()} />
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
