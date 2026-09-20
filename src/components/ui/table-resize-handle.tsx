/**
 * 表头列宽拖拽手柄(自绘 pointer 实现)。
 *
 * 不用 TanStack 原生 handler:v9 把 getResizeHandler 挂在 **header** 上
 * (`header.getResizeHandler()`),不在 column 上,所以 `column.getResizeHandler`
 * 确实不存在。本组件只拿到 columnId(7 个模块共用此签名),拿不到 header,
 * 故自行基于 th 渲染宽度 + pointer 位移算新宽度,经 onColumnSizingChange 写回。
 *
 * ponytail: 若后续统一迁移,把入参从 columnId 改成 header,即可直接用原生
 * header.getResizeHandler() 替掉下面的 pointer 数学。
 *
 * 交互:
 *  - 拖拽右边缘调整列宽
 *  - 双击手柄重置该列(删除 columnSizing 条目 → 回到自动布局)
 */

import type React from "react";

export function TableResizeHandle({
	columnId,
	onChange,
}: {
	columnId: string;
	/** 更新列宽(函数式 updater,与 useState setter 兼容) */
	onChange: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
}) {
	function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
		e.preventDefault();
		e.stopPropagation();
		const th = e.currentTarget.parentElement;
		if (!th) return;
		// 以 th 右边缘作为基准:鼠标的 clientX 减去 th.right 即为「th 右边应当延伸到的位置」
		const rect = th.getBoundingClientRect();
		// 鼠标按下时,与 th 右边缘的偏移(按下偏左 → deltaOffset 为正)
		const anchorRight = rect.right;
		const initialWidth = rect.width;

		const move = (ev: PointerEvent) => {
			// 新右边缘 = 当前 clientX + 起始时鼠标到右边缘的偏移(保持按下相对位置)
			const newRight = ev.clientX + (anchorRight - e.clientX);
			const newLeft = rect.left;
			const nextWidth = Math.max(20, Math.round(newRight - newLeft));
			void initialWidth;
			onChange((prev) => ({ ...prev, [columnId]: nextWidth }));
		};
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
	}

	function handleDoubleClick() {
		// 重置该列:删除条目后 th/cell 不再有固定宽度,回落到列定义/自动布局
		onChange((prev) => {
			if (!(columnId in prev)) return prev;
			const next = { ...prev };
			delete next[columnId];
			return next;
		});
	}

	return (
		<button
			type="button"
			aria-label="拖拽调整列宽"
			tabIndex={0}
			title="拖拽调整列宽;双击重置"
			onPointerDown={handlePointerDown}
			onDoubleClick={handleDoubleClick}
			className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize touch-none border-r border-primary/10 bg-transparent
			select-none appearance-none border-0 p-0 transition-[background-color,border-color] hover:border-primary hover:bg-primary/15 active:border-primary active:bg-primary/15"
		/>
	);
}
