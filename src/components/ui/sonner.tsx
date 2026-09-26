import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";

/**
 * 全局 toast 容器 —— **必须挂一次**,否则 `toast.success / toast.error` 只是往 sonner 内部
 * 队列里塞了一条消息,页面上什么都不出现(本项目此前就漏了这一处:全站 60+ 处 toast 全部静默)。
 *
 * 主题:sonner 自己不认识本项目的 `.dark` class(主题由 `src/lib/constants.ts` 的
 * `THEME_STORAGE_KEY` + `.dark` class 切换),所以这里监听 `<html>` 的 class 变化,
 * 把当前主题透给 sonner —— 不引 next-themes,也不和既有的主题机制打架。
 */
function useDocumentTheme(): "light" | "dark" {
	const [theme, setTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		const root = document.documentElement;
		const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
		read();
		const observer = new MutationObserver(read);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return theme;
}

export function Toaster() {
	const theme = useDocumentTheme();

	return (
		<SonnerToaster
			theme={theme}
			position="top-center"
			richColors
			closeButton
			duration={4000}
			// 与设计系统一致:圆角 12px、字体沿用全局、宽度上限贴近弹窗
			toastOptions={{
				classNames: {
					toast: "rounded-xl font-sans text-sm",
					title: "text-sm font-medium",
					description: "text-xs",
				},
			}}
		/>
	);
}
