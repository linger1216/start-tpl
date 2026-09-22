// 只用来验证:当前 Node 进程里 legacy 算法(DES-CFB)是否可用
import { createCipheriv } from "node:crypto";
try {
	createCipheriv("des-cfb", Buffer.alloc(8), Buffer.alloc(8));
	console.log("DES-CFB 可用 ✅  (NODE_OPTIONS 已生效)");
} catch (e) {
	console.log(`DES-CFB 不可用 ❌  (${e.code})`);
}
