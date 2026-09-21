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
import { PLACEHOLDER_EMPTY } from "#/lib/constants";
import { type TagDimension, type TagItem, tagCountOfDimension } from "#/mocks/tags";

/**
 * 标签维度详情(只读弹窗)。
 *
 * 「标签数」与维度表列同源(按标签明细实时统计),不显示落库计数以免两处漂移。
 */
export function SettingsTagDimensionDetailDialog({
	open,
	onOpenChange,
	detail,
	tagCount,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: TagDimension | null;
	/** 该维度下的标签数(由编排壳从合同源算出;不传则按当前明细表算) */
	tagCount?: number;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>标签维度详情</DialogTitle>
					<DialogDescription>只读视图;维度维护的是"某一类数据对象上挂了哪一类标签"。</DialogDescription>
				</DialogHeader>

				{detail ? (
					<div className="max-h-[62vh] divide-y divide-border overflow-y-auto">
						<DetailRow label="维度">{detail.维度}</DetailRow>
						<DetailRow label="适用对象">{detail.适用对象}</DetailRow>
						<DetailRow label="来源">{detail.来源 || PLACEHOLDER_EMPTY}</DetailRow>
						<DetailRow label="标签数">{tagCount ?? tagCountOfDimension(detail.维度)} 个</DetailRow>
						<DetailRow label="备注">{detail.备注 || PLACEHOLDER_EMPTY}</DetailRow>
					</div>
				) : (
					<p className="text-[13px] text-muted-foreground">未选择维度。</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** 标签明细详情(只读弹窗):含义是原始需求给的解释,也用于各业务页的 tooltip */
export function SettingsTagsDetailDialog({
	open,
	onOpenChange,
	detail,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	detail: TagItem | null;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>标签详情</DialogTitle>
					<DialogDescription>只读视图。</DialogDescription>
				</DialogHeader>

				{detail ? (
					<div className="max-h-[62vh] divide-y divide-border overflow-y-auto">
						<DetailRow label="所属维度">{detail.维度}</DetailRow>
						<DetailRow label="标签">{detail.标签}</DetailRow>
						<DetailRow label="含义">{detail.含义 || PLACEHOLDER_EMPTY}</DetailRow>
					</div>
				) : (
					<p className="text-[13px] text-muted-foreground">未选择标签。</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
