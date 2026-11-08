import { type ChildProcess, spawn } from "node:child_process";
import { db, dmPool } from "../src/db/index.ts";
// 命名空间导入是为了裁剪:**任务闭环**功能要删掉 `registerJob(...)` 那一行,
// 而 `runDueJobs` 必须留下。写成具名导入的话,删调用就得改 import 行(两条规则、互相牵连);
// 命名空间导入让删掉调用后 import 仍然有用,一条规则即可自洽。
import * as scheduler from "../src/lib/scheduler.ts";

const children = new Set<ChildProcess>();
let stopping = false;

/** 终止子进程后才释放任务租约，避免超时处理器与重试并行。 */
function runChild(script: string, args: string[], timeoutSeconds: number): Promise<void> {
	if (stopping) return Promise.reject(new Error("Worker 正在停止"));
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
			stdio: ["ignore", "inherit", "pipe", "ipc"],
			env: process.env,
		});
		children.add(child);
		let stderr = "";
		let timedOut = false;
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString()).slice(-2000);
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, Math.max(1, timeoutSeconds) * 1000);
		child.once("error", (error) => {
			clearTimeout(timer);
			children.delete(child);
			reject(error);
		});
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			children.delete(child);
			if (timedOut) reject(new Error(`执行超时(${timeoutSeconds} 秒)`));
			else if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `子进程退出: ${code ?? signal}`));
		});
	});
}

function shutdown() {
	stopping = true;
	for (const child of children) child.kill("SIGKILL");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
	await scheduler.registerJob({ name: "task-close.unviewed", handler: "task-close.unviewed", intervalSeconds: 60 });
	while (!stopping) {
		const results = await Promise.allSettled([
			scheduler.runDueJobs((handler, timeout) => runChild("scripts/job-runner.ts", [handler], timeout)),
			runChild("scripts/delivery-runner.ts", [], 110),
		]);
		for (const result of results) if (result.status === "rejected") console.error("worker:", result.reason);
		if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
	}
} finally {
	shutdown();
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
