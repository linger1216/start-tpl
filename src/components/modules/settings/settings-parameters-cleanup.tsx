import { Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";

/**
 * 「立即清理」—— 保留策略的手动入口。
 *
 * 本模板未启用定时清理任务(`cleanup.enabled` 默认 `false` —— 见
 * `lib/sys-config.ts`),所以这里只渲染一段**说明 + 占位按钮**,具体功能
 * 接好 `trpc.job.cleanupNow` 后恢复真实实现即可。
 */
export function SettingsParametersCleanup() {
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
			<span className="text-[12.5px] text-muted-foreground">
				raw 保留清理:模板未启用 ——
				<span className="ml-1 font-medium text-foreground">把清理任务接上后此按钮可用</span>
			</span>
			<Button variant="outline" size="xs" disabled title="清理任务尚未接入,详见 lib/sys-config.ts">
				<Trash2 className="size-3" />
				立即清理
			</Button>
			<span className="text-[11.5px] text-muted-foreground">只动「已抽取」;未抽取 / 失败的行永不清理。</span>
		</div>
	);
}
