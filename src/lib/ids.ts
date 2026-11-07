import { nanoid } from "nanoid";

/** 内部主键使用 21 位 URL 安全随机串；业务编码由具体业务定义。 */
export function newId(): string {
	return nanoid();
}
