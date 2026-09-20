import { Button } from "#/components/ui/button";

/**
 * Excel 导入的「导入方式」选项(追加 / 覆盖)—— 4 个设置页共用同一套交互。
 *
 * 传进 `ExcelImportDialog` 的 `options` 槽位;状态留在编排壳(受控)。
 */
export function SettingsImportModeOptions({
	mode,
	onModeChange,
}: {
	mode: "append" | "replace";
	onModeChange: (next: "append" | "replace") => void;
}) {
	return (
		<div className="space-y-1.5">
			<div className="text-[13px] font-medium text-foreground">导入方式</div>
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant={mode === "append" ? "default" : "outline"} onClick={() => onModeChange("append")}>
					追加到现有数据
				</Button>
				<Button size="sm" variant={mode === "replace" ? "default" : "outline"} onClick={() => onModeChange("replace")}>
					覆盖现有数据
				</Button>
			</div>
		</div>
	);
}
