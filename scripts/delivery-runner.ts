import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { db, dmPool } from "../src/db/index.ts";
import {
	type DeliveryProvider,
	defaultDeliveryProviders,
	processNotificationDeliveries,
} from "../src/lib/notification-delivery.ts";
import { consoleSmsProvider } from "../src/lib/sms-console-provider.ts";

if (process.connected) process.once("disconnect", () => process.exit(1));

try {
	const providers = { ...defaultDeliveryProviders };
	if (process.env.SMS_PROVIDER === "console") providers.sms = consoleSmsProvider;
	for (const [channel, envName] of [
		["sms", "SMS_PROVIDER_MODULE"],
		["email", "EMAIL_PROVIDER_MODULE"],
	] as const) {
		const modulePath = process.env[envName]?.trim();
		if (!modulePath) continue;
		const module: { default?: DeliveryProvider } = await import(pathToFileURL(resolve(modulePath)).href);
		if (!module.default || typeof module.default.name !== "string" || typeof module.default.send !== "function") {
			throw new Error(`${envName} 必须默认导出 { name, send }`);
		}
		providers[channel] = module.default;
	}
	// 每轮取一小批:单条一轮会把吞吐钉在 12 条/分钟(Worker 每 5 秒起一次本进程)。
	// 50 是 `processNotificationDeliveries` 的默认上限;取 20 是兼顾单轮耗时与积压消化速度。
	await processNotificationDeliveries(providers, 20);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	if (dmPool) await dmPool.close();
	else await db.$client.end();
}
