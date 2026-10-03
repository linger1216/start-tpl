/**
 * 进程内 SSE 事件总线(`src/lib/sse-bus.ts`)回归。
 *
 * 重点:
 *  1. `publish()` 只投到同频道,跨频道不投递;
 *  2. 多个订阅者都能收到,unsubscribe 之后不再收到;
 *  3. 订阅者 throw 不会影响其他订阅者;
 *  4. **绝不抛**:`publish` 给一个无人订阅的频道是 no-op。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { publish, resetSseBus, subscribe } from "../src/lib/sse-bus.ts";

test("publish:同频道多订阅者都能收到", () => {
	resetSseBus();
	const a: string[] = [];
	const b: string[] = [];
	const unA = subscribe("notice:1", (e) => a.push(e.name));
	const unB = subscribe("notice:1", (e) => b.push(e.name));
	publish({ channel: "notice:1", name: "x", data: 1 });
	assert.deepEqual(a, ["x"]);
	assert.deepEqual(b, ["x"]);
	unA();
	unB();
});

test("publish:不同频道不串", () => {
	resetSseBus();
	const a: string[] = [];
	const b: string[] = [];
	const unA = subscribe("notice:1", (e) => a.push(e.name));
	const unB = subscribe("notice:2", (e) => b.push(e.name));
	publish({ channel: "notice:1", name: "hit-1", data: null });
	assert.deepEqual(a, ["hit-1"]);
	assert.deepEqual(b, []);
	unA();
	unB();
});

test("unsubscribe 后不再收到", () => {
	resetSseBus();
	const got: string[] = [];
	const un = subscribe("notice:1", (e) => got.push(e.name));
	un();
	publish({ channel: "notice:1", name: "x", data: null });
	assert.deepEqual(got, []);
});

test("publish:无人订阅时不抛、不打 error", () => {
	resetSseBus();
	assert.doesNotThrow(() => {
		publish({ channel: "notice:nobody", name: "x", data: null });
	});
});

test("publish:订阅者 throw 不会中断其它订阅者", () => {
	resetSseBus();
	const safe: string[] = [];
	subscribe("notice:1", () => {
		throw new Error("boom");
	});
	subscribe("notice:1", (e) => safe.push(e.name));
	// 不抛 / 后续订阅者正常收到
	assert.doesNotThrow(() => {
		publish({ channel: "notice:1", name: "x", data: null });
	});
	assert.deepEqual(safe, ["x"]);
});
