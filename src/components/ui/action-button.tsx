import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils";

/**
 * **操作按钮** —— 表格行内 / 树节点 / 工具条 / 详情卡里那些"针对某条数据的小动作"。
 *
 * 与 `Button` 的分工(改了这里请同步看那条边界):
 *  - **操作按钮(本组件)**:详情 / 编辑 / 删除 / 启用停用 / 移出 / 上移下移 / 新增子节点 /
 *    批量删除 / 取消选择 / 全选清空 / 下载模板 / 刷新 —— 这些位置**空间都很窄**
 *    (一行要并排 3~5 个),所以:**纯文字、不要图标、悬停才出下划线**。
 *    图标按钮在这里既挤又重,而且只能靠悬浮提示才知道是什么(还得额外写 `aria-label`)。
 *  - **`Button`**:主操作与对话框动作(新增 / 保存 / 提交 / 导入 / 确定 / 取消 / 关闭),
 *    以及外壳图标按钮(通知 / 主题 / 分页箭头)—— 它们是"按钮"而不是"操作链接",
 *    图标在那里是识别线索(保存配对勾、新增配加号),不要一起改掉。
 *
 * **文案口径**(统一用词,避免同一件事在各页叫不同名字):
 *   详情 · 编辑 · 删除 · 启用 / 停用 · 移出 · 上移 / 下移 · 新增子节点 · 批量删除 · 取消选择 · 刷新
 * 一句话原则:**动词开头、不带"按钮/操作/点击"这类废话**;删除类动作统一 `tone="danger"`。
 *
 * 为什么 `children` 只收字符串:这条就是"纯文字"的落地方式 —— 想让谁塞个图标进来,
 * 类型上就先过不去(要加图标就该想想它是不是该用 `Button`)。
 */
const actionButtonVariants = cva(
	"inline-flex items-center whitespace-nowrap rounded-sm text-xs leading-none underline-offset-2 transition-colors duration-150 ease-brand outline-none select-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-45 disabled:no-underline",
	{
		variants: {
			tone: {
				/**
				 * 普通动作:静置是次级文字色,hover 转前景色 + 下划线。
				 *
				 * 为什么是 foreground 而不是 primary:与表格里既有的写法定一致
				 * (`settings-*-table.tsx` 的 `text-muted-foreground hover:text-foreground`、
				 * `ui-gallery-table.tsx` 批量条里那个原生按钮)—— 一行里并排 3 个蓝色文字会太吵。
				 */
				default: "text-muted-foreground hover:text-foreground",
				/** 破坏性动作(删除 / 移出 / 批量删除):静置就是警示色,让人下得去手之前先看清 */
				danger: "text-destructive hover:text-destructive",
			},
		},
		defaultVariants: { tone: "default" },
	},
);

export function ActionButton({
	tone,
	className,
	children,
	type = "button",
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof actionButtonVariants> & {
		/** **只传文字** —— 操作按钮不带图标(见文件头说明) */
		children: string;
	}) {
	return (
		<button type={type} data-slot="action-button" className={cn(actionButtonVariants({ tone, className }))} {...props}>
			{children}
		</button>
	);
}

export { actionButtonVariants };

/**
 * **图标操作按钮** —— 只给"空间极窄的行内"用(目前唯一场景:**树的行尾**,一行还要放名称/徽章)。
 *
 * 与 `ActionButton`(纯文字)是同一族的两种形态:
 *  - 表格行内 / 工具条 / 详情卡 → `ActionButton`(文字,hover 下划线);
 *  - 树的行尾 → 本组件(图标,20px 方,hover 变色底)。
 *
 * ⚠️ **`label` 是必填**:图标按钮没有可见文字,不给 `aria-label` / `title` 的话,
 * 用户只能靠悬浮猜、读屏软件也读不出来。这是这个组件唯一"必须交代"的参数。
 */
export function ActionIconButton({
	label,
	tone,
	disabled,
	onClick,
	children,
}: {
	/** 必填:既要给读屏软件(`aria-label`),也要给鼠标悬浮提示(`title`) */
	label: string;
	tone?: "default" | "danger";
	disabled?: boolean;
	onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
	/** 图标元素(如 `<Plus className="size-3.5" />`) */
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			data-slot="action-icon-button"
			className={cn(
				"enabled:cursor-pointer disabled:cursor-default",
				"flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-150 ease-brand outline-none",
				"focus-visible:ring-[2px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-45",
				tone === "danger" ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-primary/10 hover:text-primary",
			)}
		>
			{children}
		</button>
	);
}
