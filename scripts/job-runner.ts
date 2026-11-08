import { db, dmPool } from "../src/db/index.ts";
import { checkUnviewedActions } from "../src/lib/task-close-reminders.ts";

const handlers: Record<string, () => Promise<unknown>> = {
	"task-close.unviewed": checkUnviewedActions,
};

// Worker 异常退出时不要让子进程继续持有外部副作用。
if (process.connected) process.once("disconnect", () => process.exit(1));

try {
	const name = process.argv[2] ?? "";
	const handler = handlers[name];
	if (!handler) throw new Error(`未注册的任务处理器:${name}`);
	await handler();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
