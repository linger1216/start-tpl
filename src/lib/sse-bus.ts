/**
 * 进程内的 SSE 事件总线 —— 给「同一进程内多个浏览器标签页 / 多个组件」之间实时通气用。
 *
 * 为什么模板里有这个:
 *  - 通知铃铛从「60s 轮询」升到「服务端主动推」,靠 `/api/sse/notice` 出口订阅;
 *  - 站内动作(发通知、写审计)调 `publish()` 推一个事件,前端 EventSource 收到后**就地刷新 query 缓存**
 *   —— 比轮询省一个往返、比 WebSocket 省一整套握手和重连协议。
 *
 * **进程内**意味着:模板运行在 Nitro `node-server` 单进程下足够;横向扩到多副本时,
 * 这一层只能管同副本订阅者 —— 跨副本要走 Redis pub/sub 或同类。**派生新项目**时若上多实例,
 * 把 `subscribe` / `publish` 的存储换成共享消息总线即可,事件模型不变。
 *
 * **永不抛**:订阅是 fire-and-forget,推送失败(对端关闭)自己 catch 掉,不污染业务流。
 */
import { logger } from "./logger";

export type SseEvent = {
	/** 频道名 —— 同频道只对同频道的订阅者投递(避免无关事件被无关页面处理) */
	channel: string;
	/** 事件名(可作为 `event:` 字段),便于前端 `addEventListener('name', ...)` 区分 */
	name: string;
	/** 载荷 —— 一般是 query key 列表,前端收到后 invalidate 对应 query */
	data: unknown;
};

type Subscriber = (event: SseEvent) => void;

/** 频道 → 订阅者集合(同一频道可能有多个订阅者:多个标签页、多个组件) */
const channels = new Map<string, Set<Subscriber>>();

/** 订阅一个频道;返回 unsubscribe 函数(组件 unmount 时调)。 */
export function subscribe(channel: string, handler: Subscriber): () => void {
	let set = channels.get(channel);
	if (!set) {
		set = new Set();
		channels.set(channel, set);
	}
	set.add(handler);
	return () => {
		set?.delete(handler);
		if (set && set.size === 0) channels.delete(channel);
	};
}

/**
 * 往频道里推一条事件。
 *
 * 在事件源头(写完数据库)调用,**不影响业务** —— 没有订阅者时也不抛、不打日志。
 */
export function publish(event: SseEvent): void {
	const set = channels.get(event.channel);
	if (!set || set.size === 0) return;
	for (const handler of set) {
		try {
			handler(event);
		} catch (error) {
			logger.warn("sse.handler_threw", {
				channel: event.channel,
				name: event.name,
				message: (error as Error).message,
			});
		}
	}
}

/** 测试 / 调试用 —— 全部清空。 */
export function resetSseBus(): void {
	channels.clear();
}
