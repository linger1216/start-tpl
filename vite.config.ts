import { createRequire } from "node:module";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * pdfjs 的 worker 必须由应用侧给出一个真实 URL(`new Worker(url)`),否则 pdfjs 只能退回主线程
 * 跑(fake worker),几十页的 PDF 会把界面卡住。
 *
 * 但 pnpm 的 node_modules 是**严格**的:`pdfjs-dist` 是 `react-pdf` 的依赖、不是本包的依赖,
 * 所以写 `import "pdfjs-dist/build/pdf.worker.min.mjs?url"` 是解析不到的。
 * 于是从 `react-pdf` 自己的位置反查它带的那一份 —— 顺带保证 worker 与主库**永远同版本**
 * (两边版本不一致时 pdfjs 会当场抛 "The API version does not match the Worker version")。
 *
 * 用法:`import workerUrl from "pdfjs-worker?url"`(见 `settings-file-pdf.tsx`)。
 */
const require = createRequire(import.meta.url);
const reactPdfDir = path.dirname(require.resolve("react-pdf/package.json"));
const pdfWorkerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs", { paths: [reactPdfDir] });

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: [{ find: /^pdfjs-worker/, replacement: pdfWorkerPath }],
	},
	plugins: [devtools(), nitro(), tailwindcss(), tanstackStart(), viteReact()],
});

export default config;
