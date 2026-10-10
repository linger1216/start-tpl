import { app, name as packageName } from "../../package.json";

/**
 * 项目的**标题 / 副标题** —— 唯一真源是 `package.json` 的 `app` 字段:
 *
 * ```json
 * "app": { "title": "管理后台", "subtitle": "TanStack Start 模板" }
 * ```
 *
 * 用它的是两处**展示**:
 *  - 浏览器标签页标题 —— `routes/__root.tsx` 的 `head()`;
 *  - 侧边栏顶部的品牌标题区 —— `layout/sidebar.tsx` 的 `<SidebarHeader>`。
 *
 * 为什么单开一个字段、而不是直接用包名 `name`:`name` 是 **npm 包名**,必须是
 * 小写 ASCII(`My Cool 台` → `my-cool`),当标题很难看;`title` 允许原样写中文 / 大小写。
 * 派生新项目时 `new-project.sh` 会把 `title` 写成你输入的那个名字、`name` 写成清洗后的包名。
 *
 * 取不到 `title` 时回退包名(`name` 一定有,回退链不会返回空)。改标题**只改 package.json**,
 * 不用翻这两个消费方 —— 这也是它单独成一个模块的原因。
 *
 * ⚠️ `app` 这个键**必须存在**(这里是具名导入,整份 package.json 不会被打进客户端包;
 * 删掉该键 `tsc` 会直接报「没有导出成员 app」—— 派生脚本 `new-project.sh` 会自动写上它)。
 */
const meta = app as { title?: string; subtitle?: string } | undefined;

/** 页面标题 / 侧边栏标题 */
export const APP_TITLE = meta?.title?.trim() || packageName;
/** 侧边栏标题下方那行小字;留空 = 不显示 */
export const APP_SUBTITLE = meta?.subtitle?.trim() ?? "";
