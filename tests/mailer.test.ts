/**
 * 邮件驱动的选择逻辑回归(`src/lib/mailer.ts`)。
 *
 * 只测**分支选择与配置校验**,不真连 SMTP、不真发信:
 *  - 默认(没配 `MAIL_DRIVER`)走 console:打日志、不抛;
 *  - 未知驱动:立刻抛「未实现的邮件驱动」—— 别静默降级,否则生产上以为发出去了;
 *  - `smtp` 驱动但配置缺项:抛错并**点名缺哪几个**(配置事故要一眼能改,不能连到一半才失败);
 *  - `smtp` 驱动但配置齐全:进入真发路径,这里只断言"不是配置错误"(连不上是环境问题,不是本文件的职责)。
 *
 * 真发路径靠一个**不存在的 host** 收尾:它会走到 DNS 解析失败并抛出,
 * 错误信息与配置校验的错误完全不同 ⇒ 正好能把"配置校验过了"和"真发出去了"分开断言。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { sendMail } from "../src/lib/mailer.ts";

const MAIL_ENV_KEYS = [
	"MAIL_DRIVER",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_SECURE",
	"SMTP_USER",
	"SMTP_PASS",
	"SMTP_ALLOW_SELF_SIGNED",
	"MAIL_FROM",
] as const;

/** 本仓库 `.env.local` 里的原值 —— 测完原样放回去,别把开发者的配置改坏 */
const ORIG: Record<string, string | undefined> = Object.fromEntries(
	MAIL_ENV_KEYS.map((key) => [key, process.env[key]]),
);

after(() => {
	for (const key of MAIL_ENV_KEYS) {
		const value = ORIG[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

/** 清掉全部邮件相关变量,让每条用例从同一状态出发 */
function resetEnv(): void {
	for (const key of MAIL_ENV_KEYS) delete process.env[key];
}

const MESSAGE = { to: "__test__mailer@example.com", subject: "测试", text: "正文" };

test("默认驱动:打日志不真发,也不抛", async () => {
	resetEnv();
	await sendMail(MESSAGE);
});

test("未知驱动:立刻报「未实现的邮件驱动」(不静默降级)", async () => {
	resetEnv();
	process.env.MAIL_DRIVER = "resend";
	await assert.rejects(() => sendMail(MESSAGE), /未实现的邮件驱动:resend/);
});

test("smtp 缺 SMTP_HOST:点名缺哪个,方便一眼改配置", async () => {
	resetEnv();
	process.env.MAIL_DRIVER = "smtp";
	process.env.MAIL_FROM = "系统 <no-reply@example.com>";
	await assert.rejects(() => sendMail(MESSAGE), /SMTP_HOST/);
});

test("smtp 缺 MAIL_FROM:先在发信入口就拦下", async () => {
	resetEnv();
	process.env.MAIL_DRIVER = "smtp";
	process.env.SMTP_HOST = "smtp.example.com";
	await assert.rejects(() => sendMail(MESSAGE), /MAIL_FROM/);
});

test("smtp 只填了用户名没填密码:算配置事故,一并点名", async () => {
	resetEnv();
	process.env.MAIL_DRIVER = "smtp";
	process.env.SMTP_HOST = "smtp.example.com";
	process.env.MAIL_FROM = "系统 <no-reply@example.com>";
	process.env.SMTP_USER = "postmaster";
	await assert.rejects(() => sendMail(MESSAGE), /SMTP_USER \/ SMTP_PASS/);
});

test("smtp 配置齐全:不再报配置错(真发失败是环境问题,不是本文件的职责)", async () => {
	resetEnv();
	process.env.MAIL_DRIVER = "smtp";
	// 这个域名解析不到 —— 错误会停在 DNS / 连接阶段,而不是上面的配置校验
	process.env.SMTP_HOST = "smtp.invalid.nonexistent.example";
	process.env.MAIL_FROM = "系统 <no-reply@example.com>";
	let caught: unknown = null;
	try {
		await sendMail(MESSAGE);
	} catch (error) {
		caught = error;
	}
	// 真连上了(极不可能)也算通过;连不上时错误必须不是"缺少环境变量"那一类
	const message = caught instanceof Error ? caught.message : String(caught ?? "");
	assert.doesNotMatch(message, /缺少环境变量|必须配 MAIL_FROM/, `不该是配置校验失败:${message}`);
});
