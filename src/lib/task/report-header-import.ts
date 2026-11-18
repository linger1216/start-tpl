/** Excel 表头生成字段所需的最小结果。 */
export type ReportHeaderField = { id: string; label: string };

/**
 * 表头单元格转字段:空值跳过,标签超长跳过,重复标识自动加序号。
 * idForLabel 由调用方提供,这样拼音预填逻辑仍与手动新增字段保持一致。
 */
export function reportFieldsFromHeaders(
	headers: readonly unknown[],
	existingIds: readonly string[],
	idForLabel: (label: string) => string,
): { fields: ReportHeaderField[]; skippedLong: number } {
	const used = new Set(existingIds);
	const fields: ReportHeaderField[] = [];
	let skippedLong = 0;

	for (const raw of headers) {
		if (raw == null || (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean")) continue;
		const label = String(raw).trim();
		if (!label) continue;
		if (label.length > 100) {
			skippedLong += 1;
			continue;
		}

		const requested = idForLabel(label)
			.replace(/[^a-zA-Z0-9_]/g, "")
			.replace(/^[0-9]+/, "")
			.slice(0, 64);
		const base = /^[a-zA-Z]/.test(requested) ? requested : "field";
		let id = base;
		let suffix = 2;
		while (used.has(id)) {
			const tail = `_${suffix++}`;
			id = `${base.slice(0, 64 - tail.length)}${tail}`;
		}
		used.add(id);
		fields.push({ id, label });
	}

	return { fields, skippedLong };
}
