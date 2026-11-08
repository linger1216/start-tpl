/** 保存服务端生成的工作簿，不通过额外 HTTP 端点。 */
export function downloadReportWorkbook(fileBase64: string, name: string) {
	const raw = atob(fileBase64);
	const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
	const url = URL.createObjectURL(
		new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}
