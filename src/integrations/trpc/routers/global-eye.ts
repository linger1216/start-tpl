/**
 * 全球眼 —— 只做两件事:取通道树、取通道的 HLS 地址。
 * 协议与 token 在 `lib/global-eye.ts`;播放由前端 hls.js 直连。
 *
 * ⚠️ 新增 procedure 必须在 `lib/rbac.ts` 里分类,否则 `tests/auth.test.ts` 会失败。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type GlobalEyeNodeRow, getGlobalEyeStreamUrl, getGlobalEyeTree, toGlobalEyeTreeRows } from "#/lib/global-eye";
import { buildTree } from "#/lib/tree";
import { createTRPCRouter, protectedProcedure } from "../init";

function compareRows(left: GlobalEyeNodeRow, right: GlobalEyeNodeRow): number {
	return left.sort - right.sort || left.name.localeCompare(right.name, "zh-Hans-CN");
}

function badGateway(error: unknown): TRPCError {
	return new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : String(error) });
}

export const globalEyeRouter = createTRPCRouter({
	/** 通道树(组织 → 设备 → 通道);`refresh` 绕过缓存并重新登录 */
	channelTree: protectedProcedure.input(z.object({ refresh: z.boolean().optional() })).query(async ({ input }) => {
		try {
			const { orgs, devices, channels } = await getGlobalEyeTree(input.refresh ?? false);
			return buildTree(toGlobalEyeTreeRows({ orgs, devices, channels }), { compare: compareRows }).tree;
		} catch (error) {
			throw badGateway(error);
		}
	}),
	/** 通道的 HLS 播放地址(浏览器直连) */
	streamUrl: protectedProcedure.input(z.object({ channelId: z.string().min(1).max(128) })).query(async ({ input }) => {
		try {
			return await getGlobalEyeStreamUrl(input.channelId);
		} catch (error) {
			throw badGateway(error);
		}
	}),
});
