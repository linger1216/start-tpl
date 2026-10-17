import { useMemo, useState } from "react";

/**
 * 台账页「新建 / 编辑 / 详情 / 删除」四态弹窗的统一钩子 —— 完整四态(`viewing` /
 * `editing` / `createOpen` / `pendingDelete`)在 settings 的 users / roles / parameters /
 * dictionary / data-scope / data-plugins / files 等 7 页逐字重复(每页 ~14 行样板)。
 *
 * 返回值:
 *  - `viewing` / `setViewing(null)`      详情弹窗(行对象非空即开);
 *  - `createOpen` / `setCreateOpen`      新建弹窗(boolean);
 *  - `editing` / `setEditing(null)`      编辑弹窗(**`editing === null` 时新建态**,复用同一个 Form);
 *  - `pendingDelete` / `setPendingDelete`  ConfirmDialog 的"待删行";
 *  - `openCreate()` / `openEdit(row)`    两个语义动作(里头把另一态复位,保证三态互斥);
 *  - `confirmOpen`                       ConfirmDialog 的 open prop。
 *
 * ⚠️ 保留**裸 setter**(`setEditing(row)` / `setViewing(null)` 等都是原样的 React setter),
 * 调用方的联动(users 页的 `enabled: createOpen || editing !== null`)照常可用。
 * 关弹窗一律给 `null`(行)或 `false`(布尔);**互斥约定**:`openCreate`/`openEdit` 各自清掉其它两态。
 */
export function useLedgerDialogs<TRow extends { id: string }>() {
	const [viewing, setViewing] = useState<TRow | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<TRow | null>(null);
	const [pendingDelete, setPendingDelete] = useState<TRow | null>(null);

	return useMemo(
		() => ({
			viewing,
			setViewing,
			createOpen,
			setCreateOpen,
			editing,
			setEditing,
			pendingDelete,
			setPendingDelete,
			openCreate() {
				setViewing(null);
				setEditing(null);
				setCreateOpen(true);
			},
			openEdit(row: TRow) {
				setViewing(null);
				setCreateOpen(false);
				setEditing(row);
			},
			/** 详情弹窗的 open(`viewing !== null`) */
			viewingOpen: viewing !== null,
			/** 新建 / 编辑共用的 Form open */
			formOpen: createOpen || editing !== null,
			/** ConfirmDialog 的 open(`pendingDelete !== null`) */
			confirmOpen: pendingDelete !== null,
			/** ConfirmDialog 的 onOpenChange —— 关掉即清空"待删行"(页面里 `if (!next) setPendingDelete(null)`) */
			closeConfirm: () => setPendingDelete(null),
		}),
		[viewing, createOpen, editing, pendingDelete],
	);
}
