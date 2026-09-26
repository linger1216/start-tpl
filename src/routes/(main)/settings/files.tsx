// 系统设置 ▸ 文件管理:元数据在 sys_file,字节在 MinIO(见 doc/文件管理.md)
import { createFileRoute } from "@tanstack/react-router";

import { SettingsFilesPage } from "#/components/modules/settings/settings-files-page";
import { PAGE_SIZE_KEY } from "#/hooks/use-page-size";

export const Route = createFileRoute("/(main)/settings/files")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(context.trpc.para.byKey.queryOptions({ key: PAGE_SIZE_KEY })),
			context.queryClient.ensureQueryData(context.trpc.file.list.queryOptions()),
		]),
	component: SettingsFilesPage,
});
