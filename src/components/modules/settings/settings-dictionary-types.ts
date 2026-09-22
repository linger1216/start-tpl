/** 字段管理页用到的字典行(`sys_dict` 的一行)—— `id` 是 nanoid 主键,业务一律用 `code` */
export type SettingsDictRow = {
	id: string;
	code: string;
	name: string;
	items: Array<{ label: string; value: string }>;
	remark: string | null;
	status: number;
};

/** 编辑弹窗的表单值 */
export type DictFormValues = {
	/** 字典编码(业务键):新建时必填;编辑时不可改(规则里按它引用) */
	code: string;
	name: string;
	remark: string;
	status: boolean;
	items: Array<{ label: string; value: string }>;
};

export function emptyDictForm(): DictFormValues {
	return { code: "", name: "", remark: "", status: true, items: [{ label: "", value: "" }] };
}

export function dictToForm(row: SettingsDictRow): DictFormValues {
	return {
		code: row.code,
		name: row.name,
		remark: row.remark ?? "",
		status: row.status === 1,
		items: row.items.length > 0 ? row.items.map((item) => ({ ...item })) : [{ label: "", value: "" }],
	};
}
