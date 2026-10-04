/**
 * 资源表的**元数据** —— 资源下拉、字段下拉、主键,全从活库的 `information_schema` 现读。只在服务端跑。
 *
 * 为什么不建登记表(用户最早提的「资源登记」):表 / 列 / 注释本来就是库里的既成事实,
 * 再登记一份就等于有两份,迟早不一致。**零登记表**是刻意的。
 *
 * 但有三个坑,改这里之前先读:
 * 1. **注释的真源是 `scripts/sync-table-meta.ts`** —— 它把注释 `alter table … comment` 刷进活库
 *    (`TABLE_COMMENTS` 在 `:33`、`COLUMN_COMMENTS` 在 `:59`)。新加业务表时要**同时**在那个文件里
 *    补注释条目,否则下拉里显示的是裸列名(功能不受影响,只是配置页不好看)。
 * 2. **`information_schema` 是 MySQL 方言**,`table_schema = database()` 更是。`src/` 里此前
 *    zero 先例(`scripts/` 里 5 个文件用它)。达梦分支复用 `MySqlDialect`(`src/db/dm/session.ts:235`),
 *    但 `database()` 在达梦上不保证存在 ⇒ **这里一律 best-effort**:读不到就回空表 + 一条 warn +
 *    缓存住,绝不把配置页打成 500。读不到时配置页允许**手输表名 / 列名**。
 * 3. **别名必须显式起**(`as tableName`)—— `information_schema` 的字段名在 MySQL 里是大写
 *    (`TABLE_NAME` / `COLUMN_COMMENT`),不写别名读到的就是 `undefined`(`scripts/sync-table-meta.ts:307`
 *    记过这个坑,当时是 `EXTRA` 被静默丢掉)。
 */
import { type SQL, sql } from "drizzle-orm";

import { db } from "#/db";
import { logger } from "#/lib/logger";

/** 一张资源表的元数据 */
type ResourceMeta = {
	/** 表名 —— 程序内部一律用它,也是策略行 `resource` 存的值 */
	table: string;
	/** 中文名(表注释);读不到注释时等于 `table` */
	label: string;
	/** 主键列名;没有主键 / 读不到时是 `null`(那时 `row` 插件不可用) */
	pk: string | null;
	columns: ResourceColumnMeta[];
};

type ResourceColumnMeta = {
	column: string;
	/** 列注释;没写注释时等于 `column` */
	label: string;
	/** `information_schema` 的 `DATA_TYPE`,如 `varchar` / `datetime` */
	dataType: string;
};

/** 跑一条裸 SQL 并把结果按行数组还回来(元数据查询 / 引擎的 count 与样张都用它) */
export async function selectRows(query: SQL): Promise<Record<string, unknown>[]> {
	const [rows] = await db.execute(query);
	return (rows as unknown as Record<string, unknown>[]) ?? [];
}

/**
 * 表 + 列 + 注释 + 主键,**一条 SQL 拿全**。
 *
 * 只列基表(`table_type = 'BASE TABLE'`)—— 视图不该出现在"资源"下拉里:
 * 它没有主键,`row` 插件无从下手,写进去也只会配出一条跑不通的规则。
 */
async function fetchMetaRows(): Promise<Record<string, unknown>[]> {
	return selectRows(sql`
		select
			c.table_name as tableName,
			c.column_name as columnName,
			c.column_comment as columnComment,
			c.data_type as dataType,
			c.column_key as columnKey,
			t.table_comment as tableComment
		from information_schema.columns c
		join information_schema.tables t
			on t.table_schema = c.table_schema and t.table_name = c.table_name
		where c.table_schema = database() and t.table_type = 'BASE TABLE'
		order by c.table_name, c.ordinal_position
	`);
}

/** 元数据缓存 —— 配置页会连着读好几次(资源 → 字段 → 主键),一条 SQL 就够,别每次点都查 */
const META_CACHE_TTL_MS = 30_000;
let metaCache: { at: number; map: Map<string, ResourceMeta> } | null = null;

/**
 * 全部资源表 —— 表名 → 元数据。读不到(非 MySQL / 没权限 / 连接异常)时回**空表**。
 *
 * 空表在界面上表现为"下拉是空的,请手输",不是报错 —— 这条路径不该阻塞配规则。
 */
export async function loadResourceMeta(): Promise<Map<string, ResourceMeta>> {
	if (metaCache && Date.now() - metaCache.at < META_CACHE_TTL_MS) return metaCache.map;

	const map = new Map<string, ResourceMeta>();
	try {
		for (const row of await fetchMetaRows()) {
			const table = str(row.tableName);
			const column = str(row.columnName);
			if (!table || !column) continue;

			let meta = map.get(table);
			if (!meta) {
				meta = { table, label: str(row.tableComment) || table, pk: null, columns: [] };
				map.set(table, meta);
			}
			if (str(row.columnKey).toUpperCase() === "PRI" && !meta.pk) meta.pk = column;
			meta.columns.push({ column, label: str(row.columnComment) || column, dataType: str(row.dataType) });
		}
	} catch (error) {
		logger.warn("data_scope.meta_unavailable", {
			message: error instanceof Error ? error.message : String(error),
		});
	}

	metaCache = { at: Date.now(), map };
	return map;
}

/** 单张表的元数据;不在活库里回 `null`(`loadResourceMeta()` 读不到东西时一律 `null`) */
export async function resourceMetaOf(table: string): Promise<ResourceMeta | null> {
	return (await loadResourceMeta()).get(table) ?? null;
}

function str(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
