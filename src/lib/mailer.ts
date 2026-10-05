/**
 * 邮件发送 —— 模板只保留**一个函数**,默认"打日志不真发",要真发就切到 SMTP。
 *
 * 为什么默认不发:模板不该替使用者挑服务商,更不该让人 clone 下来先配一串 API key 才能跑。
 * 而"验证邮箱 / 改邮箱"这类流程**必须有一次邮件往返**才成立,所以开发态的替代方案是:
 * 把 BA 生成的验证链接**打到服务端终端**(`pnpm dev` 那个窗口),点一下就能走完整条链路。
 *
 * 真发只有一条路:`MAIL_DRIVER=smtp` + 一组 `SMTP_*` 环境变量,走 Nodemailer。
 * 为什么是 SMTP 而不是再挑一家 HTTP 邮件服务:企业邮箱(腾讯企业邮 / 阿里邮箱 / Exchange /
 * 自建 Postfix)**都有 SMTP**,而它们大多没有或不便开 HTTP API —— 一条 SMTP 能覆盖全部场景。
 * 换服务商仍然**只改这个文件**:调用方(`lib/auth.ts`)不碰。
 */
import type { Transporter } from "nodemailer";

import { logger } from "#/lib/logger";

type MailMessage = {
	to: string;
	subject: string;
	text: string;
	/** 邮件里的主链接(验证 / 重置密码);开发态单独打一行,方便直接点 */
	link?: string;
};

/** 开发态驱动名;`MAIL_DRIVER=…` 换成真实驱动时,记得在下面加对应分支 */
const DEV_DRIVER = "console";
const SMTP_DRIVER = "smtp";

/**
 * 复用同一个 transport —— 它内部带连接池,每次 `createTransport` 等于每次重连。
 *
 * 类型用 `import type` 取真类型(编译期擦除,不进运行时依赖);不用它就只能手写一个结构类型,
 * 而手写的那份和 Nodemailer 的重载签名对不上(实测 TS2322)。
 */
let smtpTransport: Promise<Transporter> | null = null;

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

	if (driver === SMTP_DRIVER) {
		await sendViaSmtp(message);
		return;
	}

	throw new Error(`未实现的邮件驱动:${driver}(在 src/lib/mailer.ts 的 sendMail 里加一个分支)`);
}

/**
 * Nodemailer SMTP 分支。
 *
 * 动态 `import("nodemailer")` 而不是顶部静态 import:它是**只在真发信时才用得上**的重依赖,
 * 而 `sendMail` 还挂在 BA 的启动路径上(`lib/auth.ts` 静态 import 本文件)—— 不发信的部署
 * 不该为它买单,构建也不该把它拖进不需要它的 chunk。跟 `xlsx` 只在点按钮时 `import()` 同一个道理。
 */
async function sendViaSmtp(message: MailMessage): Promise<void> {
	const from = process.env.MAIL_FROM?.trim();
	if (!from) throw new Error("MAIL_DRIVER=smtp 时必须配 MAIL_FROM(收件人看到的发件人)");

	// 并发首同时只建一个连接池。**建失败要把缓存清掉**,否则第一次的配置事故会把 rejected
	// promise 永久钉在这儿 —— 补好配置再发信还是同一个错,像是"改了环境变量没用"。
	smtpTransport ??= createSmtpTransport().catch((error: unknown) => {
		smtpTransport = null;
		throw error;
	});
	const transport = await smtpTransport;

	/**
	 * ⚠️ 别把失败吞掉:BA 的验证流程靠"邮件已发出"这个事实,
	 * 静默失败会让人一直等一封永远不会来的信。所以这里只记日志、**继续抛**。
	 */
	try {
		await transport.sendMail({
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
		});
		logger.info("mail.sent", { to: message.to, subject: message.subject });
	} catch (error) {
		logger.error("mail.smtp_failed", {
			to: message.to,
			subject: message.subject,
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

/** `SMTP_*` → Nodemailer transport。配置缺项在这里一次性报清,别等发信时才崩 */
async function createSmtpTransport(): Promise<Transporter> {
	const host = process.env.SMTP_HOST?.trim() ?? "";
	const user = process.env.SMTP_USER?.trim();
	const pass = process.env.SMTP_PASS?.trim();
	const missing = [
		["SMTP_HOST", host],
		["MAIL_FROM", process.env.MAIL_FROM?.trim()],
	].filter(([, value]) => !value);
	// 用户名密码允许成对为空(内网 relay 常不鉴权),但只给一半是配置事故 —— 单独挑出来
	if (Boolean(user) !== Boolean(pass)) missing.push(["SMTP_USER / SMTP_PASS", user && pass ? "已填" : ""]);

	if (missing.length > 0) {
		throw new Error(`MAIL_DRIVER=smtp 时缺少环境变量:${missing.map(([name]) => name).join("、")}`);
	}

	const { default: nodemailer } = await import("nodemailer");
	const port = Number(process.env.SMTP_PORT ?? 587);
	// 465 端口是隐式 TLS(`secure: true`);587 是明文连上再 STARTTLS。默认按 587 处理。
	const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "1" : port === 465;

	return nodemailer.createTransport({
		host,
		port,
		secure,
		auth: user && pass ? { user, pass } : undefined,
		// 自签证书只在明确开口子时才放行(内网 relay 常见);默认不碰,走 Node 的证书校验
		...(process.env.SMTP_ALLOW_SELF_SIGNED === "1" ? { tls: { rejectUnauthorized: false } } : {}),
	});
}
