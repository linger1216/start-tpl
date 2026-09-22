/**
 * 兼容壳:`rewriteForDm` 的**唯一实现**已经搬到 `src/db/dm/translate.ts`(驱动与 PoC 共用一份)。
 * 这个文件只做转发,避免两处实现漂移。
 */
export { rewriteForDm } from "../src/db/dm/translate.ts";
