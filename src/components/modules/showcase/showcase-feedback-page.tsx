import { useState } from "react";
import { toast } from "sonner";
import { PropTable, ShowcaseItem, ShowcasePage, ShowcaseSection, ShowcaseTag } from "#/components/layout/showcase";
import { FailureList, ResultCounts, ResultDialog, type RowFailure } from "#/components/modules/shared/op-result";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Reveal } from "#/components/ui/reveal";
import { Skeleton } from "#/components/ui/skeleton";
import { StatCardsSkeleton, TableSkeleton } from "#/components/ui/skeleton-blocks";
import { Spinner } from "#/components/ui/spinner";

/** 失败明细的示例数据 —— 真实场景由导入 / 同步的返回结果给出 */
const SAMPLE_FAILURES: RowFailure[] = [
	{ row: 12, keyValue: "91310101MA1FL2XXXX", message: "必填列「名称」为空", cells: { 名称: "", 编码: "E-1024" } },
	{ row: 37, keyValue: "91310101MA1FL3YYYY", message: "统一社会信用代码长度不是 18 位" },
	{ row: 58, keyValue: "", message: "业务主键列为空" },
];

/**
 * 反馈与交互展示页 —— 确认弹窗、操作结果、滚动入场、加载指示、toast。
 *
 * 这一层的共同点:**不持久化任何视觉状态**(由调用方持有),只是把交互形状收口,
 * 让 40+ 个弹窗 / 加载态不至于每页各写一份。
 */

export function ShowcaseFeedbackPage() {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmPositive, setConfirmPositive] = useState(false);
	const [resultOpen, setResultOpen] = useState(false);

	return (
		<ShowcasePage
			title="反馈与交互"
			description="确认弹窗、滚动入场、加载指示、toast —— 不持久化视觉状态,把交互形状收口。"
			toc={[
				["confirm", "确认弹窗"],
				["op-result", "操作结果反馈"],
				["reveal", "滚动入场"],
				["spinner", "加载指示"],
				["skeleton", "骨架屏"],
				["toast", "消息提示"],
				["api", "API 速查"],
			]}
		>
			<ShowcaseSection
				id="confirm"
				title="确认弹窗"
				description="删除 / 批量删除 / 二次确认都走它;正向操作换 confirmVariant 避免红按钮写「保存中…」。"
			>
				<ShowcaseItem
					name="ConfirmDialog"
					summary="危险操作 + 正向操作 共用弹窗"
					source="ui/confirm-dialog.tsx"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								variant="destructive"
								onClick={() => {
									setConfirmPositive(false);
									setConfirmOpen(true);
								}}
							>
								触发删除确认
							</Button>
							<Button
								size="sm"
								onClick={() => {
									setConfirmPositive(true);
									setConfirmOpen(true);
								}}
							>
								触发二次确认(默认按钮)
							</Button>
							<ConfirmDialog
								open={confirmOpen}
								onOpenChange={setConfirmOpen}
								title={confirmPositive ? "确认发布?" : "确认删除?"}
								description={
									confirmPositive ? "发布后所有订阅者会立刻收到通知。" : "该操作不可撤销 —— 删除后无法恢复。"
								}
								confirmText={confirmPositive ? "发布" : "删除"}
								confirmVariant={confirmPositive ? "default" : "destructive"}
								onConfirm={() => setConfirmOpen(false)}
							/>
						</div>
					}
					code={`<ConfirmDialog
  open={open}
  onOpenChange={setOpen}
  title="确认删除?"
  description="该操作不可撤销。"
  confirmText="删除"
  confirmVariant="destructive"
  onConfirm={handleDelete}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="reveal"
				title="滚动入场"
				description="列表项错峰入场;prefers-reduced-motion 下复位,不会逼视障用户看不动的视觉。"
			>
				<ShowcaseItem
					name="Reveal"
					summary="IntersectionObserver 触发的入场动画"
					source="ui/reveal.tsx"
					dense
					demo={
						<div className="space-y-2">
							{[0, 1, 2, 3].map((i) => (
								<Reveal
									key={i}
									delay={i * 80}
									className="rounded-lg border border-border bg-card px-3 py-2 text-[13px]"
								>
									第 {i + 1} 项(延迟 {i * 80}ms 入场)
								</Reveal>
							))}
						</div>
					}
					code={`<Reveal delay={i * 40}>…</Reveal>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="spinner" title="加载指示" description="三档尺寸;有 label 时 inline 展示文字。">
				<ShowcaseItem
					name="Spinner"
					summary="行内加载指示(sm / md / lg)"
					source="ui/spinner.tsx"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-6">
							<Spinner size="sm" />
							<Spinner size="md" />
							<Spinner size="lg" />
							<Spinner size="sm" label="正在保存" className="text-[13px] text-muted-foreground" />
						</div>
					}
					code={`<Spinner size="sm" />            // 行内
<Spinner size="sm" label="正在保存" />  // 带文字`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="skeleton"
				title="骨架屏"
				description="**仅在首屏无数据时**用。已有数据的重查询请改用 TableLoadingShell —— 换骨架会让高度塌陷、滚动位置跳。"
			>
				<ShowcaseItem
					name="StatCardsSkeleton · TableSkeleton · Skeleton"
					summary="指标条骨架 + 表格骨架 + 基础块"
					source="ui/skeleton-blocks.tsx · ui/skeleton.tsx"
					dense
					demo={
						<div className="space-y-4">
							<div>
								<div className="mb-1.5 text-[11px] text-muted-foreground">StatCardsSkeleton</div>
								<StatCardsSkeleton count={4} compact />
							</div>
							<div>
								<div className="mb-1.5 text-[11px] text-muted-foreground">Skeleton 基础块</div>
								<div className="flex items-center gap-3">
									<Skeleton className="size-9 rounded-lg" />
									<div className="space-y-1.5">
										<Skeleton className="h-3 w-32" />
										<Skeleton className="h-3 w-20" />
									</div>
								</div>
							</div>
							<div>
								<div className="mb-1.5 text-[11px] text-muted-foreground">TableSkeleton</div>
								<div className="overflow-hidden rounded-lg border border-border">
									<Card size="sm">
										<CardContent className="space-y-2 p-2">
											<TableSkeleton rows={3} cols={3} />
										</CardContent>
									</Card>
								</div>
							</div>
						</div>
					}
					code={`<StatCardsSkeleton count={4} compact />
<Skeleton className="h-3 w-32" />
<TableSkeleton rows={5} cols={4} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="toast"
				title="消息提示"
				description="sonner 的 toast —— 成功 / 失败 / 信息三类。失败会显示「重试」按钮。"
			>
				<ShowcaseItem
					name="toast"
					summary="sonner 的三种用途"
					source="lib/demo-store.tsx"
					note={
						<>
							toast 不是模板自带的 UI 组件,而是 <code className="font-mono">sonner</code> 的封装。 失败 toast
							的「重试」按钮见 <code className="font-mono">lib/demo-store.ts</code>。
						</>
					}
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => toast.success("已保存", { description: "改动 1 分钟内生效" })}
							>
								成功
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => toast.error("导入失败", { description: "第 12 行缺必填列「名称」" })}
							>
								失败
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => toast.info("提示", { description: "本批操作不会写库,只是预演" })}
							>
								信息
							</Button>
						</div>
					}
					code={`toast.success("已保存", { description: "…" });
toast.error("导入失败", {
  description: "第 12 行缺必填列「名称」",
  action: { label: "重试", onClick: () => retry() },
});
toast.info("提示");`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="op-result"
				title="操作结果反馈"
				description="导入 / 同步 / 批处理这类耗时操作的收尾:计数块 + 失败明细 + 错误报告下载。三种操作的形状一致,所以只做一套。"
			>
				<ShowcaseItem
					name="ResultCounts · FailureList"
					summary="计数块 + 失败明细(内嵌在向导里用这两个)"
					source="shared/op-result.tsx"
					note={
						<>
							<code className="font-mono">FailureList</code> 的「下载错误报告」会把失败行连同**原始列**导成 xlsx
							(用户能直接对照原表改完重导);同步这类没有原始行的场景自动退回三列兜底。
						</>
					}
					demo={
						<div className="space-y-4">
							<ResultCounts
								counts={[
									{ label: "总行数", value: 128 },
									{ label: "新增", value: 96 },
									{ label: "更新", value: 29 },
									{ label: "失败", value: 3 },
								]}
							/>
							<FailureList failures={SAMPLE_FAILURES} reportFileName="企业信息-导入" />
						</div>
					}
					code={`<ResultCounts counts={[
  { label: "总行数", value: 128 },
  { label: "新增", value: 96 },
  { label: "失败", value: 3 },
]} />
<FailureList failures={failures} reportFileName="企业信息-导入" />`}
				/>
				<ShowcaseItem
					name="ResultDialog"
					summary="把上面两块装进弹窗(独立触发的操作用)"
					source="shared/op-result.tsx"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<Button size="sm" variant="outline" onClick={() => setResultOpen(true)}>
								打开结果弹窗
							</Button>
							<span className="text-[12px] text-muted-foreground">
								导入这类「嵌在向导里」的场景直接用上面两块,不套弹窗。
							</span>
							<ResultDialog
								open={resultOpen}
								onOpenChange={setResultOpen}
								result={{
									title: "同步完成 · 企业信息",
									summary: "本次同步 128 行,3 行因必填列缺失被跳过。",
									counts: [
										{ label: "总行数", value: 128 },
										{ label: "新增", value: 96 },
										{ label: "更新", value: 29 },
										{ label: "失败", value: 3 },
									],
									failures: SAMPLE_FAILURES,
									reportFileName: "企业信息-同步",
								}}
							/>
						</div>
					}
					code={`<ResultDialog open={open} onOpenChange={setOpen} result={result} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="api" title="API 速查">
				<PropTable
					rows={[
						{
							name: "ConfirmDialog.confirmVariant",
							type: '"destructive" | "default" | "outline"',
							note: "正向操作务必传 default,避免红按钮写「保存中…」",
						},
						{ name: "ConfirmDialog.pendingText", type: "string", note: "默认「删除中…」;二次确认场景要改成动作语义" },
						{ name: "Reveal.delay", type: "number(ms)", note: "超过 400ms 会显得迟钝;列表项错峰用 i * 40" },
						{ name: "Skeleton.className", type: "string", note: "高宽都走 className(size-* w-* h-*)" },
						{ name: "toast.action", type: "{ label, onClick }", note: "失败 toast 可挂重试;成功一般不挂" },
					]}
				/>
				<ShowcaseItem
					name="本节组件计数"
					summary="本展示页覆盖的反馈件"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-2">
							<ShowcaseTag variant="secondary">ConfirmDialog</ShowcaseTag>
							<ShowcaseTag variant="secondary">Reveal</ShowcaseTag>
							<ShowcaseTag variant="secondary">Spinner</ShowcaseTag>
							<ShowcaseTag variant="secondary">Skeleton</ShowcaseTag>
							<ShowcaseTag variant="secondary">StatCardsSkeleton</ShowcaseTag>
							<ShowcaseTag variant="secondary">TableSkeleton</ShowcaseTag>
							<ShowcaseTag variant="secondary">toast</ShowcaseTag>
						</div>
					}
				/>
			</ShowcaseSection>
		</ShowcasePage>
	);
}
