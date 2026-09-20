import { EmptyState } from "#/components/layout/empty-state";
import { PageHeader } from "#/components/layout/page-header";
import { Badge } from "#/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

/**
 * 带 tab 的占位页面 —— 用于「同一交互形态、多个数据域」的合并页
 * (例如:同一交互形态下的多个数据对象、多类任务)。
 *
 * 与 `StubPage` 同层级:页面骨架未定时用,接入真实业务后替换。
 */
export type StubTab = {
	/** tab 标签,配合菜单命名约定控制在 8 个汉字内 */
	label: string;
	/** 该 tab 的完整名称 */
	title: string;
	/** 该 tab 的说明文案 */
	description: string;
	/** 来源编号(需求单 / 设计稿序号),有值时在空态里显示一个徽章 */
	sourceNo?: number;
};

export function TabbedStubPage({ title, description, tabs }: { title: string; description?: string; tabs: StubTab[] }) {
	return (
		<div className="space-y-5">
			<PageHeader title={title} description={description} />

			<Tabs defaultValue={tabs[0]?.label ?? ""}>
				<TabsList>
					{tabs.map((tab) => (
						<TabsTrigger key={tab.label} value={tab.label}>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>

				{tabs.map((tab) => (
					<TabsContent key={tab.label} value={tab.label} className="pt-1">
						<EmptyState
							title={tab.title}
							description={tab.description}
							actions={tab.sourceNo ? <Badge variant="secondary">来源 #{tab.sourceNo}</Badge> : undefined}
						/>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
