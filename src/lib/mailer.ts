/**
 * 邮件发送 —— 模板只保留**一个函数**,默认"打日志不真发"。
 *
 * 为什么默认不发:模板不该替使用者挑服务商,更不该让人 clone 下来先配一串 API key 才能跑。
 * 而"验证邮箱 / 改邮箱"这类流程**必须有一次邮件往返**才成立,所以开发态的替代方案是:
 * 把 BA 生成的验证链接**打到服务端终端**(`pnpm dev` 那个窗口),点一下就能走完整条链路。
 *
 * 换真实服务商(Resend / SES / 阿里云邮件推送 / 自建 SMTP)时**只改这个文件**:
 * 在 `sendMail` 里加一个分支(或把 `MAIL_DRIVER` 换成服务商名),调用方(`lib/auth.ts`)不用动。
 * 生产上必须换掉 —— 否则用户收不到验证邮件。
 */
import { logger } from "#/lib/logger";

export type MailMessage = {
	to: string;
	subject: string;
	text: string;
	/** 邮件里的主链接(验证 / 重置密码);开发态单独打一行,方便直接点 */
	link?: string;
};

/** 开发态驱动名;`MAIL_DRIVER=…` 换成真实驱动时,记得在下面加对应分支 */
const DEV_DRIVER = "console";

export async function sendMail(message: MailMessage): Promise<void> {
	const driver = process.env.MAIL_DRIVER ?? DEV_DRIVER;

	if (driver === DEV_DRIVER) {
		// ① 结构化日志(生产上按 `mail.dev` 就能筛出"本该发出去却没发"的邮件)
		logger.warn("mail.dev", { to: message.to, subject: message.subject, link: message.link });
		// ② 人读的一行 —— 开发时从终端里复制链接
		const lines = [`\n[mail] 收件人:${message.to}`, `[mail] 主题:${message.subject}`];
		if (message.link) lines.push(`[mail] 链接:${message.link}`);
		lines.push("[mail] (开发态:没有真发,换服务商见 lib/mailer.ts)\n");
		console.log(lines.join("\n"));
		return;
	}

	/**
	 * 这里就是接入点。典型形状:
	 *
	 *   const res = await fetch("https://api.resend.com/emails", {
	 *     method: "POST",
	 *     headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
	 *     body: JSON.stringify({ from: "noreply@example.com", to: message.to, subject: message.subject, text: message.text }),
	 *   });
	 *   if (!res.ok) throw new Error(`发信失败:${res.status} ${await res.text()}`);
	 *
	 * ⚠️ 别把失败吞掉:BA 的验证流程靠"邮件已发出"这个事实,静默失败会让人一直等一封永远不会来的信。
	 */
	throw new Error(`未实现的邮件驱动:${driver}(在 src/lib/mailer.ts 的 sendMail 里加一个分支)`);
}
