/**
 * 全球眼视频 —— 读写外部视频平台(中国电信 DSS)的接口层。
 *
 * 只有两个 **query**(没有任何 mutation):取通道树、取单通道播放地址。
 * 协议与 token 保活都在 `lib/global-eye.ts`;这里只做入参校验、拼树、错误归一。
 *
 * ⚠️ 新增 procedure 必须在 `lib/rbac.ts` 里分类(两个页面码 + `UNSCOPED_QUERIES`),
 * 否则 `tests/auth.test.ts` 的分类守卫会失败。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
	collectGlobalEyeTree,
	type GlobalEyeNodeRow,
	getGlobalEyeStreamUrl,
	toGlobalEyeTreeRows,
} from "#/lib/global-eye";
import { buildTree } from "#/lib/tree";
import { createTRPCRouter, protectedProcedure } from "../init";

/** 同级排序:按插入序(组织 → 设备 → 通道),同序再按名字(中文按拼音) */
function compareRows(left: GlobalEyeNodeRow, right: GlobalEyeNodeRow): number {
	return left.sort - right.sort || left.name.localeCompare(right.name, "zh-Hans-CN");
}

/** 外部平台异常统一成 BAD_GATEWAY,前端 `toastApiError` 能把中文原因显示出来 */
function badGateway(error: unknown): TRPCError {
	return new TRPCError({
		code: "BAD_GATEWAY",
		message: error instanceof Error ? error.message : String(error),
	});
}

export const globalEyeRouter = createTRPCRouter({
	/** 组织 / 设备 / 通道目录;节点带通道原始字段(右侧详情直接用) */
	channelTree: protectedProcedure.query(async () => {
		try {
			const { orgs, devices, channels } = await collectGlobalEyeTree();
			const { tree } = buildTree(toGlobalEyeTreeRows({ orgs, devices, channels }), { compare: compareRows });
			return {
				tree,
				stats: {
					orgs: orgs.length,
					devices: devices.length,
					channels: channels.length,
					online: channels.filter((channel) => Boolean(channel.isOnline)).length,
				},
			};
		} catch (error) {
			throw badGateway(error);
		}
	}),
	/** 单通道的实时播放地址(前端点「播放」时调用) */
	streamUrl: protectedProcedure.input(z.object({ channelId: z.string().min(1).max(128) })).query(async ({ input }) => {
		try {
			return await getGlobalEyeStreamUrl(input.channelId);
		} catch (error) {
			throw badGateway(error);
		}
	}),
});
