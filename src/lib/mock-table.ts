import { create, type StoreApi, type UseBoundStore } from "zustand";

/**
 * 设计阶段的「假后端」:一份内存表,提供增 / 删 / 改 / 批量替换。
 *
 * 为什么不是 useState:
 *  - 全站 40+ 个列表页共用同一套 CRUD 行为,行为只写一遍;
 *  - 数据在本次会话内跨页面保留(切走再回来还在),刷新页面回到种子数据;
 *  - 后续接真后端时,把 store 换成 tRPC 的 query/mutation 即可,页面组件不用动。
 *
 * 注意:行必须有稳定主键 `id`(表格选中 / 编辑 / 删除都靠它)。
 */
export type MockRow = { id: string } & Record<string, unknown>;

/** 校验用:字段值一律以字符串进入表单,提交时再按 kind 转换 */
export type MockDraft = Record<string, unknown>;

/** 表状态:行类型默认是最宽的 `MockRow`,各域可用自己的行类型实例化(`createMockTable<XxxRow>`) */
export type MockTableState<T extends MockRow = MockRow> = {
	rows: T[];
	/** 追加(新增 / Excel「追加导入」) */
	insert: (drafts: MockDraft[]) => void;
	/** 覆盖(Excel「覆盖导入」) */
	replaceAll: (drafts: MockDraft[]) => void;
	update: (id: string, patch: MockDraft) => void;
	remove: (ids: string[]) => void;
};

export type MockTableStore<T extends MockRow = MockRow> = UseBoundStore<StoreApi<MockTableState<T>>>;

/**
 * 建一张内存表。`idPrefix` 用于生成新行主键(如 ENT-0025),
 * 序号从种子行数继续,避免与种子数据撞号。
 */
export function createMockTable<T extends MockRow = MockRow>(seed: T[], idPrefix = "ROW"): MockTableStore<T> {
	let seq = seed.length;
	const nextId = () => `${idPrefix}-${String(++seq).padStart(4, "0")}`;
	const withIds = (drafts: MockDraft[]): T[] => drafts.map((draft) => ({ ...draft, id: nextId() }) as T);

	return create<MockTableState<T>>((set, get) => ({
		rows: seed,
		insert: (drafts) => set({ rows: [...get().rows, ...withIds(drafts)] }),
		replaceAll: (drafts) => set({ rows: withIds(drafts) }),
		update: (id, patch) => set({ rows: get().rows.map((row) => (row.id === id ? ({ ...row, ...patch } as T) : row)) }),
		remove: (ids) => {
			const doomed = new Set(ids);
			set({ rows: get().rows.filter((row) => !doomed.has(row.id)) });
		},
	}));
}
