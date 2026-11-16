import { PageHeader } from "#/components/layout/page-header";
import { UiGallery } from "./ui-gallery";

export function WorkbenchPage() {
	return (
		<div className="page-enter space-y-6">
			<PageHeader title="工作台" description="按类别浏览和体验项目中的 UI 组件。" />
			<UiGallery />
		</div>
	);
}
