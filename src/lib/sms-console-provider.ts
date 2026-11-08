import type { DeliveryProvider } from "#/lib/notification-delivery";

/** 本地调试只打印内容，不把模拟结果登记为真实发送成功。 */
export const consoleSmsProvider: DeliveryProvider = {
	name: "console",
	async send(message) {
		console.info(`[sms:console] 尾号 ${message.target.slice(-4)} · ${message.title}: ${message.content}`);
		throw new Error("短信开发模式仅打印内容，未实际发送");
	},
};
