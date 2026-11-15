import { ArrayReportTable } from "#/components/modules/task-close/array-report-table";
import {
	type ReportFieldLike,
	type ReportFile,
	textValueOf,
	type Value,
} from "#/components/modules/task-close/report-types";
import { AttachmentChip } from "#/components/modules/task-close/task-content-attachments";
import { useAttachmentPreview } from "#/components/modules/task-close/use-attachment-preview";
import { useStableKeys } from "#/hooks/use-stable-keys";
import { isRecord } from "#/lib/task/json";
import { formatLocalDateTime } from "#/lib/time";

export function ReportValueView({
	taskId,
	field,
	value,
	files,
}: {
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	files: readonly ReportFile[];
}) {
	if (field.type === "attachment") {
		const ids = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
		if (ids.length === 0) return <>—</>;
		return <ReportFileChips taskId={taskId} ids={ids} files={files} />;
	}
	if (field.type === "array") return <ReportArrayView taskId={taskId} field={field} value={value} files={files} />;
	return <>{plainTextOf(field, value)}</>;
}

function ReportArrayView({
	taskId,
	field,
	value,
	files,
}: {
	taskId: string;
	field: ReportFieldLike;
	value: Value | undefined;
	files: readonly ReportFile[];
}) {
	const items = (Array.isArray(value) ? value : []).filter((item): item is Record<string, Value> => isRecord(item));
	const itemKeys = useStableKeys(items.length, "tc-read");
	const itemFields = field.itemFields ?? [];
	if (items.length === 0) return <>—</>;
	return (
		<ArrayReportTable
			items={items}
			itemKeys={itemKeys}
			fields={itemFields}
			renderCell={(item, sub) => <ReportValueView taskId={taskId} field={sub} value={item[sub.id]} files={files} />}
		/>
	);
}

function ReportFileChips({
	taskId,
	ids,
	files,
}: {
	taskId: string;
	ids: readonly string[];
	files: readonly ReportFile[];
}) {
	const preview = useAttachmentPreview<ReportFile>(taskId);
	return (
		<>
			<span className="flex flex-wrap items-center gap-1.5">
				{ids.map((id) => {
					const file = files.find((item) => item.id === id) ?? { id, name: id, size: 0, contentType: null };
					return <AttachmentChip key={id} file={file} onPreview={() => preview.preview(file)} />;
				})}
			</span>
			{preview.dialog}
		</>
	);
}

/** 一个值的纯文本口径:单选 / 多选给选项名,其余原样(空值一律「—」) */
function plainTextOf(field: ReportFieldLike, value: Value | undefined): string {
	if (value == null || value === "") return "—";
	if (field.type === "multiselect") {
		const picked = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
		return picked.length === 0 ? "—" : picked.join("、");
	}
	if (field.type === "select") return String(value);
	if (field.type === "datetime") return formatLocalDateTime(value as string) || String(value);
	if (typeof value === "boolean") return value ? "是" : "否";
	if (Array.isArray(value)) return value.length === 0 ? "—" : `${value.length} 项`;
	return textValueOf(value);
}
