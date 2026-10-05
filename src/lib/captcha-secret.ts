/**
 * CaptchaKit 密钥的兜底生成 —— **人机验证默认就是开的**。
 *
 * CaptchaKit 要求一把至少 32 字节的密钥(`CAPTCHAKIT_SECRET`)。模板如果把「有没有配这把密钥」
 * 当成开关,就会留下一件很难受的事:**安全功能默认是关的**,clone 下来的人得先想起来配一把
 * 随机密钥才能把验证码打开 —— 而忘记配的后果是登录接口裸奔。所以这里反过来:
 *
 *   1. **配了** → 原样用(想自己控制轮换 / 预置固定值的场景);
 *   2. **没配** → 现场生成一把 32 字节随机值回填进 `process.env`,
 *      开发态顺手写进 `.env.local`,**重启后还是同一把**,不必每次都换密钥把在途的 proof token 全作废。
 *
 * 为什么写进 `.env.local` 而不是 `.env.example`:后者是**提交进版本库的模板**,把机器生成的
 * 随机值写进去等于把密钥发给所有人 —— 每个人 clone 下来用的是同一把,等于没有密钥。
 *
 * 生产环境写不了也**不该**写:容器里通常没有 `.env.local`,镜像层也不可写。所以生产走**进程内临时值**,
 * 并打一条 warn 说明它的两个已知边界(重启即失效 / 多副本之间不通用)。真要长期稳定,
 * 生产自己往环境变量里注入一把(`docker run -e CAPTCHAKIT_SECRET=…`)。
 *
 * ⚠️ 注意这两个边界 CaptchaKit 的**默认内存存储**本来就有一份(见下),所以这不是我们额外引入的限制:
 * `createChallenge` / `verifyCaptcha` 共用模块级 `getDefaultStore()`,题目与 proof token 都只在本进程。
 * 多副本部署要共享,得自己实现 `CaptchaStore` 注 Redis —— 模板不预置,因为大部分单体部署用不上。
 *
 * 本模块**只跑在服务端**(`routes/api.captcha.ts` 与 `lib/auth.ts` 会用到),不要从浏览器可达的地方 import。
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { logger } from "#/lib/logger";

const ENV_KEY = "CAPTCHAKIT_SECRET";
/** 写回的目标文件 —— Vite / `dotenv -e` 都会优先读 `.env.local`,且默认在 .gitignore 里 */
const ENV_FILE = ".env.local";
/** CaptchaKit 的下界(`SECRET_MIN_LENGTH`);生成 32 字节 hex = 64 字符,留足余量 */
const SECRET_BYTES = 32;

/** 兜底生成的密钥 —— 只在本进程内有效,配了环境变量 / 第二次调用都直接走它 */
let generated: string | null = null;

/**
 * 把密钥写进 `.env.local`。
 *
 * ⚠️ 只在开发态写,两个理由:
 *   - 生产容器里 `.env.local` 通常不存在,镜像层也不可写;
 *   - `node --test` 下更不能写 —— 测试会 import `lib/auth.ts`,等于每次跑测试都改开发者本机的配置文件。
 *     判据用 `NODE_TEST_CONTEXT`(`node --test` 会设成 `child-v8`),而不是 `NODE_ENV === "test"`
 *     —— 本仓库的 `pnpm test` 并没有设 `NODE_ENV`,设了反而会让人以为有兜底。
 *
 * 顺带一提:`vite build` 也会 SSR 求值到本模块(构建期就把密钥准备好,`pnpm dev` 第一次打开就有),
 * 那属于预期内 —— 写出来的仍是合法随机值,且 `.env.local` 本来就在 `.gitignore` 里。
 * 真正要紧的是生产运行时:那时 `NODE_ENV=production`,只留进程内临时值并 warn。
 *
 * 写失败(只读文件系统 / 目录不存在)**不是错误**:临时值已经在 `process.env` 里了,功能照常,
 * 只是下次重启会换一把密钥。返回布尔值让调用方把这件事说清楚。
 */
function persistToLocalEnv(secret: string): boolean {
	if (process.env.NODE_ENV === "production" || process.env.NODE_TEST_CONTEXT) return false;
	try {
		const path = resolve(process.cwd(), ENV_FILE);
		// 文件不存在就只追加 —— `.env.example` 拷过来的人一般已经有这个文件了,但不该因此放弃写入。
		const current = existsSync(path) ? readFileSync(path, "utf8") : "";
		// 已有一行 `CAPTCHAKIT_SECRET=`(从 `.env.example` 拷过来的空值)就**就地替换**而不是再追加一行:
		// dotenv 后定义的同名键覆盖先定义的,追加虽然也能生效,但文件里留两行同名变量很难排查。
		const line = `${ENV_KEY}=${secret}`;
		const next = /^CAPTCHAKIT_SECRET=.*$/m.test(current)
			? current.replace(/^CAPTCHAKIT_SECRET=.*$/m, line)
			: `${current.trimEnd()}${current.trim() ? "\n\n" : ""}# --- 人机验证(CaptchaKit;首次访问 /api/captcha 时自动生成) ---\n${line}\n`;
		writeFileSync(path, next, "utf8");
		return true;
	} catch (error) {
		logger.warn("captcha.secret_persist_failed", {
			file: ENV_FILE,
			message: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

/**
 * 取一把可用的 CaptchaKit 密钥,并保证 `process.env.CAPTCHAKIT_SECRET` 已被填上。
 *
 * CaptchaKit 的 `getSecret()` 是**调用时**读 `process.env`,所以只要这里回填了,
 * 后面 `createCaptchaHandlers()` / `verifyCaptcha()` 就不必再各自操心兜底。
 *
 * 幂等:配好了就一直返回那把;自己生成的那把也只生成一次,反复调不会换。
 */
export function ensureCaptchaSecret(): string {
	const configured = process.env[ENV_KEY]?.trim();
	if (configured) return configured;

	if (!generated) {
		generated = randomBytes(SECRET_BYTES).toString("hex");
		if (persistToLocalEnv(generated)) {
			logger.info("captcha.secret_generated", { file: ENV_FILE, bytes: SECRET_BYTES });
		} else {
			// 这里必须 warn 而不是 info:生产环境不配密钥时,重启会让在途的 proof token 全部作废,
			// 多副本部署更是各用各的 —— 这两条边界不该只存在于注释里。
			logger.warn("captcha.secret_ephemeral", {
				reason: process.env.NODE_TEST_CONTEXT ? "test" : "not-persisted",
				message: "人机验证仍可用,但这把密钥只在当前进程内有效(重启会换 / 多副本不通用);生产请注入 CAPTCHAKIT_SECRET",
			});
		}
	}
	// 回填放在 `if (!generated)` **外面** —— 复用缓存那一支也得回填:`process.env` 可能被别处清掉过
	// (测试里就是这么干的),而 captchakit 每次都重新读它,不补上就会拿着空串去验,报 CAPTCHA_MISSING_SECRET。
	process.env[ENV_KEY] = generated;
	return generated;
}
