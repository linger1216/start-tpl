import assert from "node:assert/strict";
import { test } from "node:test";

import { getContext } from "../src/integrations/tanstack-query/root-provider.tsx";

test("各路由上下文隔离查询缓存与 tRPC 批处理客户端", () => {
	const first = getContext();
	const second = getContext();
	assert.notEqual(first.queryClient, second.queryClient);
	assert.notEqual(first.trpcClient, second.trpcClient);
});
