import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "#/integrations/trpc/react";

/**
 * 读一个系统字典(`sys_dict`)—— 前端统一入口。
 *
 * 入参是**字典编码**(`code`,如 `yes_no`),不是主键 —— `sys_dict.id` 是 nanoid,业务侧不认识它。
 * 字典是服务端数据:`items = [{label, value}]`。库里没有这个编码时回空数组,
 * **不编造候选**;需要"给个兜底种子"的场景(如档案类型)由服务端种子脚本写进库。
 */
export function useDict(code: string): { items: Array<{ label: string; value: string }>; isLoading: boolean } {
	const trpc = useTRPC();
	const query = useQuery(trpc.dict.byCode.queryOptions({ code }));
	// 停用的字典不参与消费侧(下拉/校验)—— 字段管理页看得到它,用得到它的地方看不到
	const enabled = query.data?.status === 1;
	return { items: enabled ? (query.data?.items ?? []) : [], isLoading: query.isPending };
}
