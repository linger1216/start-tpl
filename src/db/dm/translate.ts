/**
 * DM(达梦)方言与 drizzle/mysql-core 之间的翻译层。
 *
 * 这个文件**与 dmdb 解耦**:rewriteForDm 是纯字符串状态机,
 * bindDmExec 才真正碰 dmdb。换驱动只动 bindDmExec 这一处。
 *
 * 两件事:
 *   ① 占位符 `?` → `:1, :2, …`(dmdb 是 Oracle 风格绑定)
 *   ② 反引号标识符 ` → "(默认模式下 DM 拒绝反引号,但接受双引号)
 *
 * 用一个状态机扫描(在 code / ' / " / ` 四种上下文之间切)逐字符处理,
 * 正确处理 SQL 字符串内的 '' 转义、块注释、行注释。
 */
export type DmResultRow = Record<string, unknown>;

export interface DmExecResult {
	rows: DmResultRow[];
	insertId?: number;
	affectedRows?: number;
}
export type DmExec = (sql: string, params: unknown[]) => Promise<DmExecResult>;

export function rewriteForDm(sql: string, paramCount: number): string {
	if (!sql.includes("?") && !sql.includes("`")) return sql;
	let out = "";
	let i = 0;
	let paramIndex = 1;
	const n = sql.length;

	type Ctx = "code" | "sq" | "dq" | "bt";
	let ctx: Ctx = "code";

	while (i < n) {
		const c = sql.charAt(i);
		const next = sql.charAt(i + 1) || undefined;

		if (ctx === "code" && c === "/" && next === "*") {
			const end = sql.indexOf("*/", i + 2);
			if (end === -1) {
				out += sql.slice(i);
				break;
			}
			out += sql.slice(i, end + 2);
			i = end + 2;
			continue;
		}
		if (ctx === "code" && c === "-" && next === "-" && (i + 2 >= n || /[\s]/.test(sql[i + 2] ?? ""))) {
			const end = sql.indexOf("\n", i + 2);
			if (end === -1) {
				out += sql.slice(i);
				break;
			}
			out += sql.slice(i, end);
			i = end;
			continue;
		}

		if (ctx === "code") {
			if (c === "'") {
				ctx = "sq";
				out += c;
				i++;
				continue;
			}
			if (c === '"') {
				ctx = "dq";
				out += c;
				i++;
				continue;
			}
			if (c === "`") {
				ctx = "bt";
				out += '"';
				i++;
				continue;
			}
			if (c === "?") {
				if (paramIndex > paramCount) {
					throw new Error("[dm] SQL 里 ? 比参数个数(" + paramCount + ")多。SQL: " + sql);
				}
				out += `:${paramIndex++}`;
				i++;
				continue;
			}
			out += c;
			i++;
			continue;
		}

		if (ctx === "sq") {
			if (c === "'") {
				if (next === "'") {
					out += "''";
					i += 2;
					continue;
				}
				ctx = "code";
				out += c;
				i++;
				continue;
			}
			if (c === "\\" && next !== undefined) {
				out += `${c}${next}`;
				i += 2;
				continue;
			}
			out += c;
			i++;
			continue;
		}

		if (ctx === "dq") {
			if (c === '"') {
				if (next === '"') {
					out += '""';
					i += 2;
					continue;
				}
				ctx = "code";
				out += c;
				i++;
				continue;
			}
			out += c;
			i++;
			continue;
		}

		if (ctx === "bt") {
			if (c === "`") {
				ctx = "code";
				out += '"';
				i++;
				continue;
			}
			out += c;
			i++;
			continue;
		}

		out += c;
		i++;
	}
	return out;
}

function autoBind(v: unknown): unknown {
	if (v === null || v === undefined) return { val: v, type: 2001 };
	if (typeof v === "bigint") return { val: v.toString(), type: 2001 };
	if (v instanceof Date) return { val: v, type: 2014 };
	if (typeof v === "number") return { val: v, type: 2010 };
	return { val: v, type: 2001 };
}

export type DmConn = {
	execute: (
		sql: string,
		binds: unknown[],
		options: Record<string, unknown>,
		cb: (err: unknown, result: unknown) => void,
	) => void;
	close: () => Promise<void>;
	/** dmdb 的 Connection 直接有这两个方法(没有 BEGIN 语句,靠 autoCommit=false 累积) */
	commit: () => Promise<void>;
	rollback: () => Promise<void>;
};

/** dmdb 的池:注意 `createPool()` 返回的是 Promise,所以这里同时接受 Promise 形态,内部 await */
export type DmPool = {
	getConnection: (cb: (err: unknown, c: DmConn) => void) => void;
	close: () => Promise<void>;
};
export type DmPoolLike = DmPool | Promise<DmPool>;

/**
 * dmdb → drizzle 的值归一化:
 *  · BigInt:达梦的 NUMBER/BIGINT 列会回 BigInt,而 drizzle 的 int/tinyint 解码器要 number
 *  · CLOB:达梦把大字段回成 Lob 对象(内容在 `.data`),而 drizzle 的 text 解码器当它是字符串
 *    —— 首选靠 `dmdb.fetchAsString = [dmdb.CLOB]` 全局解决,这里是兜底。
 */
function normalizeValue(v: unknown): unknown {
	if (typeof v === "bigint") return Number(v);
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>;
		const isLob = o.iLob !== undefined || o.type === 2017 || o.type === 2019;
		if (isLob) {
			if (typeof o.data === "string") return o.data;
			if (o.data instanceof Uint8Array) return Buffer.from(o.data).toString("utf8");
		}
	}
	return v;
}

function normalizeRow(row: DmResultRow): DmResultRow {
	const out: DmResultRow = {};
	for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
	return out;
}

function execOnConn(
	conn: DmConn,
	sql: string,
	params: unknown[],
	extraOptions?: Record<string, unknown>,
): Promise<DmExecResult> {
	return new Promise((resolve, reject) => {
		conn.execute(sql, params.map(autoBind), { outFormat: 4002, ...extraOptions }, (err: unknown, result: unknown) => {
			if (err) return reject(err as Error);
			// ⚠️ dmdb 的字段名是 **rowsAffected**(不是 mysql2 的 affectedRows)——
			// 写成 affectedRows 会静默拿到 undefined,症状是"删除/更新返回影响行数 0"。
			const r = result as {
				rows?: DmResultRow[];
				insertId?: number;
				rowsAffected?: number;
				affectedRows?: number;
			};
			const affected = r.rowsAffected ?? r.affectedRows;
			resolve({
				rows: (r.rows ?? []).map(normalizeRow),
				insertId: typeof r.insertId === "number" ? r.insertId : undefined,
				affectedRows: typeof affected === "number" ? affected : undefined,
			});
		});
	});
}

export function bindDmExec(poolLike: DmPoolLike): DmExec {
	return async (rawSql, rawParams) => {
		const pool = await poolLike; // dmdb.createPool 是异步的:这里第一次用才真正等到池子就绪
		const sql = rewriteForDm(rawSql, rawParams.length);
		const conn = await new Promise<DmConn>((resolve, reject) =>
			pool.getConnection((e, c) => (e ? reject(e as Error) : resolve(c))),
		);
		try {
			return await execOnConn(conn, sql, rawParams);
		} finally {
			await conn.close().catch(() => {});
		}
	};
}

export type DmTxExec = DmExec & {
	release: () => Promise<void>;
	commit: () => Promise<void>;
	rollback: () => Promise<void>;
};

/**
 * 事务用的 exec:绑定一条固定连接,且**每条语句都 autoCommit=false**
 * (达梦没有 `BEGIN` 语句;事务靠"关掉自动提交 + 最后 commit/rollback"表达)。
 */
export function bindDmExecOnConn(conn: DmConn): DmTxExec {
	const exec: DmExec = async (rawSql, rawParams) => {
		const sql = rewriteForDm(rawSql, rawParams.length);
		return execOnConn(conn, sql, rawParams, { autoCommit: false });
	};
	return Object.assign(exec, {
		release: () => conn.close(),
		commit: () => conn.commit(),
		rollback: () => conn.rollback(),
	});
}
