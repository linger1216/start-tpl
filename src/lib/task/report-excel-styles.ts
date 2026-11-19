import { posix } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import * as XLSX from "xlsx";

/** 在原 XLSX 包内替换目标工作表数据，保留工作簿其他内容和模板样式。 */
export async function writeStyledReportWorkbook(
	template: Buffer,
	sheetName: string,
	dataStartRow: number,
	rows: unknown[][],
	lastColumn: number,
): Promise<Buffer> {
	const zip = await JSZip.loadAsync(template);
	const read = async (path: string) => {
		const entry = zip.file(path);
		if (!entry) throw new Error("工作簿结构无效");
		return new DOMParser().parseFromString(await entry.async("string"), "application/xml");
	};
	const workbook = await read("xl/workbook.xml");
	const sheets = Array.from(workbook.getElementsByTagNameNS("*", "sheet"));
	const sheet = sheets.find((item) => item.getAttribute("name") === sheetName);
	const relationId =
		sheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
		sheet?.getAttribute("r:id");
	const relations = await read("xl/_rels/workbook.xml.rels");
	const relation = Array.from(relations.getElementsByTagNameNS("*", "Relationship")).find(
		(item) => item.getAttribute("Id") === relationId,
	);
	const target = relation?.getAttribute("Target");
	if (!target) throw new Error("找不到工作表文件");
	const path = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("xl", target));
	const xml = await read(path);
	const sheetData = xml.getElementsByTagNameNS("*", "sheetData")[0];
	if (!sheetData) throw new Error("工作表数据无效");
	const originalRows = Array.from(sheetData.getElementsByTagNameNS("*", "row"));
	const exemplar =
		originalRows.find((row) => Number(row.getAttribute("r")) === dataStartRow) ??
		originalRows.find((row) => Number(row.getAttribute("r")) >= dataStartRow);
	const rowTemplates = new Map(originalRows.map((row) => [Number(row.getAttribute("r")), row]));
	for (const row of originalRows) if (Number(row.getAttribute("r")) >= dataStartRow) sheetData.removeChild(row);
	const ns = sheetData.namespaceURI;
	rows.forEach((values, index) => {
		const number = dataStartRow + index;
		const source = rowTemplates.get(number) ?? exemplar;
		const row = source
			? (source.cloneNode(true) as ReturnType<typeof xml.createElementNS>)
			: xml.createElementNS(ns, "row");
		row.setAttribute("r", String(number));
		const cells = Array.from(row.getElementsByTagNameNS("*", "c"));
		const byColumn = new Map<number, ReturnType<typeof xml.createElementNS>>();
		for (const cell of cells) {
			const address = cell.getAttribute("r");
			if (!address) continue;
			const column = XLSX.utils.decode_cell(address).c;
			cell.setAttribute("r", XLSX.utils.encode_cell({ r: number - 1, c: column }));
			while (cell.firstChild) cell.removeChild(cell.firstChild);
			cell.removeAttribute("t");
			byColumn.set(column, cell);
		}
		values.forEach((value, column) => {
			if (value === null || value === undefined || value === "") return;
			let cell = byColumn.get(column);
			if (!cell) {
				cell = xml.createElementNS(ns, "c");
				cell.setAttribute("r", XLSX.utils.encode_cell({ r: number - 1, c: column }));
				const next = Array.from(row.getElementsByTagNameNS("*", "c")).find(
					(item) => XLSX.utils.decode_cell(item.getAttribute("r") ?? "A1").c > column,
				);
				row.insertBefore(cell, next ?? null);
			}
			if (typeof value === "number" || typeof value === "boolean") {
				if (typeof value === "boolean") cell.setAttribute("t", "b");
				const v = xml.createElementNS(ns, "v");
				v.appendChild(xml.createTextNode(typeof value === "boolean" ? (value ? "1" : "0") : String(value)));
				cell.appendChild(v);
			} else {
				cell.setAttribute("t", "inlineStr");
				const inline = xml.createElementNS(ns, "is");
				const text = xml.createElementNS(ns, "t");
				text.setAttribute("xml:space", "preserve");
				// XML 1.0 不允许大部分控制字符。
				// biome-ignore lint/suspicious/noControlCharactersInRegex: 需要过滤无效 XML 字符
				text.appendChild(xml.createTextNode(String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")));
				inline.appendChild(text);
				cell.appendChild(inline);
			}
		});
		sheetData.appendChild(row);
	});
	const dimension = xml.getElementsByTagNameNS("*", "dimension")[0];
	if (dimension)
		dimension.setAttribute(
			"ref",
			XLSX.utils.encode_range({
				s: { r: 0, c: 0 },
				e: { r: Math.max(0, dataStartRow - 2 + rows.length), c: lastColumn },
			}),
		);
	zip.file(path, new XMLSerializer().serializeToString(xml));
	return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
