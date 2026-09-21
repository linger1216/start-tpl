import { Info } from "lucide-react";

import { cn } from "#/lib/utils";

/**
 * 标准页面头部 —— 白底画布 + 底部 1px 分隔,与设计系统 §10 / §5.2 一致。
 *
 * 视觉规则:
 *   · 标题左侧一条 3px **品牌色**强调条 —— 导航层统一用一个强调色,
 *     不按模块换色(多色只留给数据展示:指标卡 / 分类标签 / 筛选 chip)
 *   · 标题 22px / 500 / -0.01em 字距(沿用 Haas Display 调性)
 *   · 描述默认收起 — 标题右侧 (i) trigger,hover / focus-within 弹出 popover
 *   · 想让描述常驻显示(短描述场景),传 `descriptionInline: true`
 *   · 左侧标题块 + 右侧 actions,中间空隙由 grow 占位
 */
export function PageHeader({
	title,
	description,
	actions,
	className,
	descriptionInline = false,
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
	/** 默认 false —— 描述藏在 (i) trigger 的 popover 里;true 时直接渲染在标题下 */
	descriptionInline?: boolean;
}) {
	const hasDescription = description !== undefined && description !== null;
	return (
		<section className={cn("page-head", className)}>
			<div className="page-head-row">
				<div className="flex min-w-0 items-start gap-2.5">
					{/* mt 对齐标题首行中线:标题 22px/1.25 ⇒ 首行高约 27.5px,18px 的条放在 4.5px 处居中 */}
					<span aria-hidden className="mt-[5px] h-[18px] w-[3px] shrink-0 rounded-full bg-primary" />
					<div className="page-title-group">
						{title && <h1 className="page-title">{title}</h1>}
						{hasDescription && !descriptionInline ? (
							<button
								type="button"
								aria-label="页面说明"
								className="info-trigger"
								// 点击不导航,只切换显隐 —— 主要触发是 hover
								onClick={(e) => e.preventDefault()}
							>
								<Info className="size-3.5" aria-hidden="true" />
								<span className="sr-only">显示页面说明</span>
							</button>
						) : null}
						{hasDescription ? (
							<div className={cn("info-popover", descriptionInline && "is-inline")}>{description}</div>
						) : null}
					</div>
				</div>
				{actions && <div className="page-actions">{actions}</div>}
			</div>
			{hasDescription && descriptionInline ? <div className="page-sub">{description}</div> : null}
		</section>
	);
}
