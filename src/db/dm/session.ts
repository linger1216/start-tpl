/**
 * 把 dmdb 适配进 drizzle 的 MySQL 方言核心。
 *
 * 结构照抄 drizzle 自带的 mysql-proxy 驱动(同一模式:复用 MySqlDialect + 自写 session),
 * 差别只有两处:
 *   ① 执行换成 dmdb(不再是 HTTP callback)—— 见 ./translate.ts
 *   ② 事务**真做**:借一条固定连接跑 BEGIN/COMMIT/ROLLBACK(proxy 那个直接抛 not supported)
 *
 * 类型上必须给两个 HKT(否则 drizzle 的 prepareQuery 约束不满足):
 *   DmQueryResultHKT.type   = 本次查询的原始结果形状
 *   DmPreparedQueryHKT.type = 我们的 PreparedQuery 类(注意:是"类"不是"结果",这是 drizzle 的约定)
 */
import { entityKind } from "drizzle-orm/entity";
import type {
	MySqlPreparedQueryConfig,
	MySqlPreparedQueryHKT,
	MySqlQueryResultHKT,
	MySqlTransactionConfig,
	PreparedQueryKind,
	SelectedFieldsOrdered,
} from "drizzle-orm/mysql-core";
import {
	MySqlDatabase,
	MySqlDialect,
	MySqlSession,
	MySqlTransaction,
	MySqlPreparedQuery as PreparedQueryBase,
} from "drizzle-orm/mysql-core";
import type { RelationalSchemaConfig, TablesRelationalConfig } from "drizzle-orm/relations";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm/relations";
import { fillPlaceholders, type Query, type SQL } from "drizzle-orm/sql";
import * as drizzleUtils from "drizzle-orm/utils";

import { bindDmExecOnConn, type DmConn, type DmExec, type DmPoolLike, type DmResultRow } from "./translate";

/**
 * drizzle 的 `mapResultRow` 只在运行时导出(`drizzle-orm/utils.js`),.d.ts 里没声明 ——
 * 但它**必须用**:它不只是搬字段,还会按列的 `mapFromDriverValue` 解码
 * (tinyint(1) → boolean、datetime → Date、json → 对象)。自己手写映射会把这些类型全丢掉。
 * 所以这里补一个类型声明把它取出来。
 */
const mapResultRow = (
	drizzleUtils as unknown as {
		mapResultRow: (
			columns: SelectedFieldsOrdered,
			row: unknown[],
			joinsNotNullableMap?: Record<string, string> | undefined,
		) => Record<string, unknown>;
	}
).mapResultRow;

/** drizzle 内部工具类型的等价物(utils.d.ts 未导出,自己写一份) */
type Assume<T, U> = T extends U ? T : U;

/**
 * 逐列兜一层驱动侧转换。
 *
 * 目前只有一种需要: **json 列**。mysql2 会把 JSON 列自动解析成对象,所以 drizzle/mysql-core
 * 的 json 列**没有** `mapFromDriverValue`(它假设驱动已经给了解析后的值)。达梦这边 `items`
 * 是 TEXT/CLOB,回的是原始 JSON 字符串 —— 于是 `row.items` 会变成一个长度 53 的字符串。
 * 这里按列类型判断,只在"json 列 + 值确实是 JSON 文本"时解析。
 */
function coerceForField(field: unknown, value: unknown): unknown {
	if (typeof value !== "string") return value;
	const f = field as { columnType?: string; dataType?: string } | undefined;
	const isJson = f?.columnType === "MySqlJson" || f?.dataType === "json";
	if (!isJson) return value;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

/** 一次查询的原始结果形状 */
export type DmRawResult = {
	rows: DmResultRow[];
	insertId?: number;
	affectedRows?: number;
};

export interface DmQueryResultHKT extends MySqlQueryResultHKT {
	type: DmRawResult;
}
export interface DmPreparedQueryHKT extends MySqlPreparedQueryHKT {
	type: DmPreparedQuery<Assume<this["config"], MySqlPreparedQueryConfig>>;
}

class DmPreparedQuery<T extends MySqlPreparedQueryConfig> extends PreparedQueryBase<T> {
	static readonly [entityKind] = "DmPreparedQuery";
	constructor(
		private readonly exec: DmExec,
		private readonly queryString: string,
		private readonly params: unknown[],
		private readonly fields: SelectedFieldsOrdered | undefined,
		private readonly customResultMapper: ((rows: unknown[][]) => T["execute"]) | undefined,
	) {
		super(undefined, undefined, undefined);
	}

	async execute(placeholderValues: Record<string, unknown> = {}): Promise<T["execute"]> {
		const params = fillPlaceholders(this.params, placeholderValues);
		const result = await this.exec(this.queryString, params);

		// 写操作 / 无字段映射:**必须回 mysql2 那套 `[ResultSetHeader, FieldPacket[]]`**。
		// 项目里的写法是 `(await db.delete(...))[0].affectedRows`(见 tag.ts 的 unlink / 级联删除),
		// 回成普通对象会让 `[0]` 变 undefined,症状是"删除成功但影响行数读成 0"。
		if (!this.fields && !this.customResultMapper) {
			return [
				{
					insertId: result.insertId,
					affectedRows: result.affectedRows,
					rows: result.rows,
				},
				[],
			] as unknown as T["execute"];
		}
		if (this.customResultMapper) {
			return this.customResultMapper(result.rows.map((r) => Object.values(r)));
		}
		// SELECT:dmdb 返回对象行,取 values 交给 drizzle 的映射器(顺序 = SELECT 顺序 = fields 顺序)
		// (走到这里 fields 一定有值:上面两个分支已经把"无字段"和"自定义映射"处理掉了)
		const fields = this.fields ?? [];
		return result.rows.map((row) => {
			// fields[i] 是 drizzle 的 { path, field } 包装,真正的列对象在 .field 上
			const values = Object.values(row).map((v, i) =>
				coerceForField((fields[i] as { field?: unknown } | undefined)?.field, v),
			);
			return mapResultRow(fields, values, undefined);
		}) as T["execute"];
	}

	async *iterator(): AsyncGenerator<T["iterator"]> {
		const rows = (await this.execute()) as unknown as DmResultRow[];
		for (const row of rows) yield row as T["iterator"];
	}
}

class DmSession<
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig,
> extends MySqlSession<DmQueryResultHKT, DmPreparedQueryHKT, TFullSchema, TSchema> {
	static readonly [entityKind] = "DmSession";
	constructor(
		private readonly exec: DmExec,
		dialect: MySqlDialect,
		private readonly schema: RelationalSchemaConfig<TSchema> | undefined,
		private readonly pool: DmPoolLike,
	) {
		super(dialect);
	}

	prepareQuery<T extends MySqlPreparedQueryConfig>(
		query: Query,
		fields: SelectedFieldsOrdered | undefined,
		customResultMapper?: (rows: unknown[][]) => T["execute"],
	): PreparedQueryKind<DmPreparedQueryHKT, T> {
		return new DmPreparedQuery(this.exec, query.sql, query.params, fields, customResultMapper) as never;
	}

	async all<T = unknown>(query: SQL): Promise<T[]> {
		const q = this.dialect.sqlToQuery(query);
		const result = await this.exec(q.sql, q.params);
		return result.rows as T[];
	}

	/**
	 * db.execute(sql\`...\`) —— 返回形态对齐 mysql2 的 `[rows, fields]`:
	 * 项目里的脚本写的是 `(await db.execute(...))[0]`,所以这里必须给两元组。
	 */
	async execute<T>(query: SQL): Promise<T> {
		const q = this.dialect.sqlToQuery(query);
		const result = await this.exec(q.sql, q.params);
		return [result.rows, []] as unknown as T;
	}

	/** 真事务:借一条固定连接 → BEGIN → callback 在这条连接上跑 → COMMIT / ROLLBACK → 还连接 */
	async transaction<T>(
		cb: (tx: DmTransaction<TFullSchema, TSchema>) => Promise<T>,
		_config?: MySqlTransactionConfig,
	): Promise<T> {
		const pool = await this.pool;
		const conn = await new Promise<DmConn>((resolve, reject) =>
			pool.getConnection((e, c) => (e ? reject(e as Error) : resolve(c))),
		);
		const txExec = bindDmExecOnConn(conn);
		const txSession = new DmSession<TFullSchema, TSchema>(txExec, this.dialect, this.schema, this.pool);
		// MySqlTransaction 的构造是 5 参:(dialect, session, schema, nestedIndex, mode)
		const tx = new DmTransaction<TFullSchema, TSchema>(this.dialect, txSession, this.schema, 0, "default");
		try {
			const result = await cb(tx);
			await txExec.commit(); // 达梦:提交靠 Connection.commit(),不是 COMMIT 语句
			return result;
		} catch (e) {
			await txExec.rollback().catch(() => {});
			throw e;
		} finally {
			await txExec.release().catch(() => {});
		}
	}
}

class DmTransaction<
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig,
> extends MySqlTransaction<DmQueryResultHKT, DmPreparedQueryHKT, TFullSchema, TSchema> {
	static readonly [entityKind] = "DmTransaction";
	constructor(
		dialect: MySqlDialect,
		session: MySqlSession<DmQueryResultHKT, DmPreparedQueryHKT, TFullSchema, TSchema>,
		schema: RelationalSchemaConfig<TSchema> | undefined,
		nestedIndex: number,
		mode: "default" | "planetscale",
	) {
		// 基类把 session 声明成带默认泛型的 MySqlSession,而我们的 session 用的是 DM 的 HKT ——
		// 两者结构一致但泛型不互assign,这里按 drizzle 内部惯例断言一次(运行期无差别)。
		super(dialect, session as never, schema as never, nestedIndex, mode);
	}

	/** 嵌套事务 / savepoint:DM 这条线暂不支持,直接禁掉(与 MySQL 默认行为一致) */
	override transaction<T>(_transaction: (tx: DmTransaction<TFullSchema, TSchema>) => Promise<T>): Promise<T> {
		throw new Error("[dm] 不支持嵌套事务 / savepoint");
	}
}

/** 与 drizzle 其它驱动同形:drizzleDm({ exec, pool, schema }) */
export function drizzleDm<TFullSchema extends Record<string, unknown> = Record<string, never>>(args: {
	exec: DmExec;
	pool: DmPoolLike;
	schema?: TFullSchema;
	casing?: "snake_case" | "camelCase";
}) {
	const dialect = new MySqlDialect({ casing: args.casing });
	let schema: RelationalSchemaConfig<TablesRelationalConfig> | undefined;
	if (args.schema) {
		const extracted = extractTablesRelationalConfig(args.schema, createTableRelationsHelpers);
		schema = {
			fullSchema: args.schema,
			schema: extracted.tables,
			tableNamesMap: extracted.tableNamesMap,
		};
	}
	const session = new DmSession<TFullSchema, TablesRelationalConfig>(args.exec, dialect, schema, args.pool);
	return new MySqlDatabase(
		dialect,
		session,
		schema as RelationalSchemaConfig<TablesRelationalConfig> | undefined,
		"default",
	) as unknown as MySqlDatabase<DmQueryResultHKT, DmPreparedQueryHKT, TFullSchema>;
}
