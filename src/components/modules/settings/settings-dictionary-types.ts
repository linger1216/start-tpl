/** 字段管理页用到的字典行(`sys_dict` 的一行) */
export type SettingsDictRow = {
	id: string;
	name: string;
	items: Array<{ label: string; value: string }>;
	remark: string | null;
	status: number;
};

/** 编辑弹窗的表单值 */
export type DictFormValues = {
	/** 新建时必填;编辑时不可改(它是主键,也是规则里引用的编码) */
	id: string;
	name: string;
	remark: string;
	status: boolean;
	items: Array<{ label: string; value: string }>;
};

export function emptyDictForm(): DictFormValues {
	return { id: "", name: "", remark: "", status: true, items: [{ label: "", value: "" }] };
}

export function dictToForm(row: SettingsDictRow): DictFormValues {
	return {
		id: row.id,
		name: row.name,
		remark: row.remark ?? "",
		status: row.status === 1,
		items: row.items.length > 0 ? row.items.map((item) => ({ ...item })) : [{ label: "", value: "" }],
	};
}
