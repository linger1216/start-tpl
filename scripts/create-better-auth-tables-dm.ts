/**
 * 给**达梦**建 Better Auth 需要的表(幂等,可重复跑)。
 *
 * 为什么单独一个脚本:`drizzle-kit` 的 dialect 是硬编码枚举、**没有达梦**,所以 `db:generate` /
 * `db:migrate` 对达梦无意义 —— 达梦的 DDL 只能手写维护。表定义的「形状」真源是 `src/db/data-base-schema.ts`,
 * **改那边之后要同步改这里**(与 `scripts/create-system-tables.ts` 同一口径)。
 *
 * 达梦与 MySQL 的几处差异(都实测过):
 *   · 没有 `boolean` 类型 → 用 `tinyint`(drizzle 的 `boolean` 在 MySQL 上本来也是 tinyint(1))
 *   · `timestamp` → 用 `datetime`(MySQL 的 timestamp 有 1970-2038 限制,达梦没这回事)
 *   · 反引号 → 双引号(达梦默认模式认双引号)
 *   · 表名 `user` 是达梦保留字 → **所有标识符一律加双引号**
 *   · `create table if not exists` / `create index if not exists` 达梦都支持 → 天然幂等
 *
 * 用法:`pnpm db:dm:create-ba`
 */
import "dotenv/config";

import dmdb from "dmdb";
import { upgradeTaskStatusIndex } from "./dm-index-upgrade";

type Conn = {
	execute: (sql: string, binds: unknown[], options: unknown, cb: (e: unknown, r: unknown) => void) => void;
	close: () => Promise<void>;
};

/** 表所在的模式 —— 与 DATABASE_URL 的 `?schema=` 一致 */
const SCHEMA = new URLSearchParams((process.env.DATABASE_URL ?? "").split("?")[1] ?? "").get("schema") ?? "eg";

const S = `"${SCHEMA}"`;

/**
 * Better Auth 内核四表 + 模板示例表 `todos`。
 * 列名 / 长度 / 约束全部对齐 `src/db/data-base-schema.ts`。
 * 表名带 `sys_` 前缀(认证是系统内部服务);better-auth 按 `src/lib/auth.ts` 里的**映射键名**找模型,表名随便。
 */
const STATEMENTS: string[] = [
	// ── 系统设置基础表 ────────────────────────────────────────
	`create table if not exists ${S}."sys_menu" (
      "id" varchar(32) not null,
      "parent_id" varchar(32) default null,
      "name" varchar(32) not null,
      "path" varchar(128) not null,
      "type" tinyint default 2 not null,
      "perm" varchar(64),
      "icon" varchar(32) default null,
      "sort" int not null default 0,
      "visible" tinyint not null default 1,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      "deleted_at" datetime default null,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_sys_menu_path" on ${S}."sys_menu" ("path")`,
	`create index if not exists "idx_sys_menu_parent_sort" on ${S}."sys_menu" ("parent_id", "sort")`,
	`create table if not exists ${S}."sys_dict" (
      "id" varchar(32) not null,
      "code" varchar(64) not null,
      "name" varchar(32) not null,
      "items" text default null,
      "remark" varchar(255) default null,
      "status" tinyint not null default 1,
      "created_at" datetime default current_timestamp,
      "updated_at" datetime default current_timestamp,
      "deleted_at" datetime default null,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_sys_dict_code" on ${S}."sys_dict" ("code")`,
	`create table if not exists ${S}."sys_para" (
      "para_key" varchar(64) not null,
      "para_value" text not null,
      "para_type" tinyint not null,
      "para_group" varchar(32) default null,
      "status" tinyint not null default 1,
      "remark" varchar(255) default null,
      "editable" tinyint not null default 1,
      "created_at" datetime default current_timestamp,
      "updated_at" datetime default current_timestamp,
      "deleted_at" datetime default null,
      primary key ("para_key")
    )`,
	`create index if not exists "idx_para_group" on ${S}."sys_para" ("para_group")`,
	`create table if not exists ${S}."sys_tag" (
      "id" varchar(32) not null,
      "parent_id" varchar(32) default null,
      "label" varchar(32) not null,
      "value" varchar(32) default null,
      "desc" text default null,
      "sort" int not null default 0,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      "deleted_at" datetime default null,
      primary key ("id")
    )`,
	`create index if not exists "idx_sys_tag_parent_sort" on ${S}."sys_tag" ("parent_id", "sort")`,
	`create table if not exists ${S}."sys_tag_relation" (
      "id" varchar(32) not null,
      "tag_id" varchar(32) not null,
      "obj_id" varchar(32) not null,
      "obj_type" tinyint not null,
      "created_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_tag_rel_unique" on ${S}."sys_tag_relation" ("tag_id", "obj_type", "obj_id")`,
	`create index if not exists "idx_tag_rel_tag" on ${S}."sys_tag_relation" ("tag_id")`,
	`create index if not exists "idx_tag_rel_obj" on ${S}."sys_tag_relation" ("obj_type", "obj_id")`,

	// ── user ──────────────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_user" (
		"id" varchar(36) not null,
		"name" varchar(128) not null,
		"email" varchar(255) not null,
		"phone" varchar(32),
		"email_verified" tinyint default 0 not null,
		"image" varchar(512),
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		"deleted_at" datetime,
		primary key ("id")
	)`,
	`create unique index if not exists "uk_sys_user_email" on ${S}."sys_user" ("email")`,

	// ── session ───────────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_session" (
		"id" varchar(36) not null,
		"expires_at" datetime not null,
		"token" varchar(255) not null,
		"ip_address" text,
		"user_agent" text,
		"user_id" varchar(36) not null,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id"),
		constraint "fk_sys_session_user" foreign key ("user_id") references ${S}."sys_user" ("id") on delete cascade
	)`,
	`create unique index if not exists "uk_sys_session_token" on ${S}."sys_session" ("token")`,
	`create index if not exists "idx_sys_session_user" on ${S}."sys_session" ("user_id")`,

	// ── account ───────────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_account" (
		"id" varchar(36) not null,
		"account_id" varchar(255) not null,
		"provider_id" varchar(64) not null,
		"user_id" varchar(36) not null,
		"access_token" text,
		"refresh_token" text,
		"id_token" text,
		"access_token_expires_at" datetime,
		"refresh_token_expires_at" datetime,
		"scope" varchar(255),
		"password" text,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id"),
		constraint "fk_sys_account_user" foreign key ("user_id") references ${S}."sys_user" ("id") on delete cascade
	)`,
	`create unique index if not exists "uk_sys_account_provider" on ${S}."sys_account" ("provider_id", "account_id")`,
	`create index if not exists "idx_sys_account_user" on ${S}."sys_account" ("user_id")`,

	// ── verification ──────────────────────────────────────────────────────
	`create table if not exists ${S}."sys_verification" (
		"id" varchar(36) not null,
		"identifier" varchar(255) not null,
		"value" text not null,
		"expires_at" datetime not null,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id")
	)`,
	`create index if not exists "idx_sys_verification_identifier" on ${S}."sys_verification" ("identifier")`,

	// ── 登录风控(失败计数 + 锁定;m23422 风格的连续失败 → 锁定表)────────────
	// 见 src/lib/auth-lockout.ts 的阈值(默认 5 次失败锁 15 分钟)。
	`create table if not exists ${S}."sys_account_lockout" (
		"email" varchar(255) not null,
		"failed_attempts" int default 0 not null,
		"locked_until" datetime,
		"last_failed_at" datetime,
		"last_failed_ip" varchar(64),
		primary key ("email")
	)`,
	`create index if not exists "idx_sys_account_lockout_until" on ${S}."sys_account_lockout" ("locked_until")`,

	// ── 限流计数(better-auth secondaryStorage 落地;A1)────────────────
	// 配合 src/lib/rate-limit-storage.ts,实现跨进程 / 多副本的 IP 限流。
	// value 列存 session cache 的 JSON 字符串;count 列存限流计数。
	`create table if not exists ${S}."sys_rate_limit" (
		"key" varchar(191) not null,
		"count" int default 0 not null,
		"value" text,
		"expires_at" datetime,
		primary key ("key")
	)`,
	`create index if not exists "idx_sys_rate_limit_expires" on ${S}."sys_rate_limit" ("expires_at")`,

	// ── sys_share_token(外链访客令牌;用户管理 ▸ 访客管理,见 doc/外链分享.md)────
	// 凭证表硬删(无 deleted_at,与 sys_rate_limit 同档,见 lib/soft-delete.ts 的运维表口径)。
	`create table if not exists ${S}."sys_share_token" (
		"id" varchar(32) not null,
		"token" varchar(64) not null,
		"remark" varchar(255) default '' not null,
		"allowed_paths" text not null,
		"expires_at" datetime,
		"enabled" tinyint default 1 not null,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id")
	)`,
	`create unique index if not exists "uk_sys_share_token" on ${S}."sys_share_token" ("token")`,

	// ── 权限四表(部门 / 角色;形状见 src/db/data-base-schema.ts)──
	`create table if not exists ${S}."sys_dept" (
		"id" varchar(32) not null,
		"parent_id" varchar(32),
		"name" varchar(64) not null,
		"sort" int default 0 not null,
		"status" tinyint default 1 not null,
		"remark" varchar(255),
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		"deleted_at" datetime,
		primary key ("id")
	)`,
	`create index if not exists "idx_sys_department_parent_sort" on ${S}."sys_dept" ("parent_id", "sort")`,

	`create table if not exists ${S}."sys_role" (
		"id" varchar(32) not null,
		"name" varchar(32) not null,
		"sort" int default 0 not null,
		"status" tinyint default 1 not null,
		"remark" varchar(255),
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		"deleted_at" datetime,
		primary key ("id"),
		unique ("name")
	)`,

	`create table if not exists ${S}."sys_user_dept" (
		"id" varchar(32) not null,
		"department_id" varchar(32) not null,
		"user_id" varchar(32) not null,
		"created_at" datetime default current_timestamp not null,
		primary key ("id"),
		constraint "uk_sys_dm_unique" unique ("department_id", "user_id"),
		constraint "fk_sys_dm_department" foreign key ("department_id") references ${S}."sys_dept" ("id") on delete cascade,
		constraint "fk_sys_dm_user" foreign key ("user_id") references ${S}."sys_user" ("id") on delete cascade
	)`,
	`create index if not exists "idx_sys_dm_user" on ${S}."sys_user_dept" ("user_id")`,

	// ── sys_casbin_rule(功能权限策略:Casbin 判定 + 存储;见 src/lib/casbin.ts)────────
	`create table if not exists ${S}."sys_casbin_rule" (
		"id" varchar(32) not null,
		"ptype" varchar(8) not null,
		"v0" varchar(80) not null,
		"v1" varchar(128) not null,
		"v2" varchar(16) default '' not null,
		"created_at" datetime default current_timestamp not null,
		"updated_at" datetime default current_timestamp not null,
		primary key ("id"),
		constraint "uk_sys_casbin_rule" unique ("ptype", "v0", "v1", "v2")
	)`,
	`create index if not exists "idx_sys_casbin_rule_v0" on ${S}."sys_casbin_rule" ("ptype", "v0")`,
	`create index if not exists "idx_sys_casbin_rule_v1" on ${S}."sys_casbin_rule" ("ptype", "v1")`,

	// ── sys_file(文件元数据;字节存 MinIO,见 doc/文件管理.md)─────────────────
	`create table if not exists ${S}."sys_file" (
	  "id" varchar(32) not null,
	  "bucket" varchar(64) not null,
	  "object_key" varchar(512) not null,
	  "origin_name" varchar(255) not null,
	  "ext" varchar(16),
	  "content_type" varchar(128),
	  "size" bigint default 0 not null,
	  "hash" char(64),
	  "status" tinyint default 0 not null,
	  "created_at" datetime default current_timestamp not null,
	  "updated_at" datetime default current_timestamp not null,
	  primary key ("id"),
	  constraint "uk_sys_file_object" unique ("bucket", "object_key")
	)`,
	`create index if not exists "idx_sys_file_status" on ${S}."sys_file" ("status", "created_at")`,
	`create index if not exists "idx_sys_file_hash" on ${S}."sys_file" ("hash")`,
	// ── sys_log(审计日志;只增不改,见 doc/审计日志.md)────────────────────
	`create table if not exists ${S}."sys_log" (
      "id" varchar(32) not null,
      "trace_id" varchar(32),
      "path" varchar(64) not null,
      "label" varchar(64),
      "type" varchar(16),
      "operator_id" varchar(32),
      "operator_name" varchar(64),
      "ip" varchar(64),
      "target" varchar(255),
      "status" tinyint default 1 not null,
      "error_code" varchar(48),
      "error_message" varchar(255),
      "input" text,
      "duration_ms" int,
      "created_at" datetime default current_timestamp not null,
      primary key ("id")
    )`,
	`create index if not exists "idx_sys_log_time" on ${S}."sys_log" ("created_at")`,
	`create index if not exists "idx_sys_log_operator" on ${S}."sys_log" ("operator_id", "created_at")`,
	`create index if not exists "idx_sys_log_path" on ${S}."sys_log" ("path", "created_at")`,
	`create table if not exists ${S}."sys_notification" (
        "id" varchar(32) not null primary key, "type" varchar(64) not null, "source_type" varchar(64), "source_id" varchar(191), "title" varchar(128) not null, "content" text, "payload" text, "dedupe_key" varchar(191) not null, "created_at" datetime not null
  )`,
	`create unique index if not exists "uk_notification_dedupe" on ${S}."sys_notification" ("dedupe_key")`,
	`create index if not exists "idx_notification_source" on ${S}."sys_notification" ("source_type", "source_id", "type", "created_at")`,
	`create table if not exists ${S}."sys_notification_delivery" (
        "id" varchar(32) not null primary key, "notification_id" varchar(32) not null, "recipient_id" varchar(36) not null, "channel" varchar(16) not null, "target" varchar(255), "status" varchar(16) not null, "read_at" datetime, "attempts" int not null default 0, "next_attempt_at" datetime, "locked_until" datetime, "lock_token" varchar(32), "provider_message_id" varchar(255), "sent_at" datetime, "last_error" text, "created_at" datetime not null, "updated_at" datetime not null
  )`,
	`create unique index if not exists "uk_notification_recipient_channel" on ${S}."sys_notification_delivery" ("notification_id","recipient_id","channel")`,
	`create index if not exists "idx_delivery_recipient" on ${S}."sys_notification_delivery" ("recipient_id","channel","read_at","created_at")`,
	`create index if not exists "idx_delivery_pending" on ${S}."sys_notification_delivery" ("status","next_attempt_at","locked_until")`,
	`create table if not exists ${S}."sys_notification_attempt" (
        "id" varchar(32) not null primary key, "delivery_id" varchar(32) not null, "attempt_no" int not null, "status" varchar(16) not null, "provider" varchar(64), "error" text, "started_at" datetime not null, "finished_at" datetime
  )`,
	`create unique index if not exists "uk_delivery_attempt" on ${S}."sys_notification_attempt" ("delivery_id","attempt_no")`,
	`create table if not exists ${S}."sys_scheduled_job" (
        "id" varchar(32) not null primary key, "name" varchar(128) not null, "handler" varchar(128) not null, "interval_seconds" int not null, "cron_expression" varchar(128), "timezone" varchar(64) default 'UTC' not null, "timeout_seconds" int not null default 60, "max_attempts" int not null default 3, "retry_delay_seconds" int not null default 30, "enabled" tinyint not null default 1, "next_run_at" datetime not null, "locked_until" datetime, "lock_token" varchar(32), "attempts" int not null default 0, "created_at" datetime not null, "updated_at" datetime not null
  )`,
	`create unique index if not exists "uk_scheduled_job_name" on ${S}."sys_scheduled_job" ("name")`,
	`create index if not exists "idx_job_due" on ${S}."sys_scheduled_job" ("enabled","next_run_at","locked_until")`,
	`create table if not exists ${S}."sys_job_execution" (
        "id" varchar(32) not null primary key, "job_id" varchar(32) not null, "started_at" datetime not null, "finished_at" datetime, "status" varchar(16) not null, "error" text, "duration_ms" int
  )`,
	`create index if not exists "idx_execution_job" on ${S}."sys_job_execution" ("job_id","started_at")`,
	// ── demo_grid(Demo:综合网格履职)──────────────────
	`create table if not exists ${S}."demo_grid" (
      "id" varchar(32) not null,
      "name" varchar(64) not null,
      "town_name" varchar(32),
      "town_id" varchar(32),
      "owner_name" varchar(32),
      "owner_id" varchar(32),
      "duty" varchar(64),
      "remark" varchar(255),
      "created_at" datetime default current_timestamp not null,
      "updated_at" datetime default current_timestamp not null,
      "deleted_at" datetime,
      primary key ("id")
    )`,
	`create index if not exists "idx_demo_grid_town" on ${S}."demo_grid" ("town_id")`,
	`create index if not exists "idx_demo_grid_owner" on ${S}."demo_grid" ("owner_id")`,

	// ── sys_data_policy(数据权限:规则;见 src/lib/data-scope.ts)──────────
	//
	// v2 (m20034):「输出值」搬到 sys_data_plugin.output_values,rule.params 列删除。
	// m23422:规则多一列 `value_key` —— 从插件输出行里取哪个 key 的值去比。
	// 达梦没有 json 类型,这里 `output_values` 落成 `text` —— 引擎读端走 `parseItems()`
	// 兜底(MySQL/达梦都为 `text` 的形态读回字符串,统一容错)。
	`create table if not exists ${S}."sys_data_policy" (
      "id" varchar(32) not null,
      "status" tinyint default 1 not null,
      "subject" varchar(48) not null,
      "resource" varchar(64) not null,
      "column" varchar(64),
      "value_key" varchar(64),
      "plugin_key" varchar(64),
      "remark" varchar(255),
      "created_at" datetime default current_timestamp not null,
      "updated_at" datetime default current_timestamp not null,
      "deleted_at" datetime,
      primary key ("id")
    )`,
	`create index if not exists "idx_sys_data_policy_resource" on ${S}."sys_data_policy" ("resource", "status")`,

	// ── sys_data_plugin(数据权限:值域插件登记;加/改不用重启)──────────────
	// v2 (m20034):函数体那段(`fn`)已删 —— 现在这张表只装「指定清单」类插件,
	// 用户在表单里**逐行手填** `[{key, value}]`,存进 `output_values` 列。
	// 达梦的 `create table if not exists` 只在表不存在时跑,已存在的老库不会**自动**获得新结构 —— 老库迁移
	// 走这里的 columnDrops 段(m18035 起统一管)+ 达梦版手动执行 ALTER TABLE。
	`create table if not exists ${S}."sys_data_plugin" (
      "id" varchar(32) not null,
      "plugin_key" varchar(64) not null,
      "label" varchar(64) not null,
      "output_values" text,
      "status" tinyint default 1 not null,
      "remark" varchar(255),
      "created_at" datetime default current_timestamp not null,
      "updated_at" datetime default current_timestamp not null,
      "deleted_at" datetime,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_sys_data_plugin_key" on ${S}."sys_data_plugin" ("plugin_key")`,

	// ── 任务闭环 ───────────────────────────────────────────────
	`create table if not exists ${S}."tc_report_template" (
      "id" varchar(32) not null,
      "name" varchar(255) not null,
      "creator_id" varchar(36) not null,
      "payload" text,
      "shared" tinyint default 0 not null,
      "created_at" datetime default current_timestamp,
      "updated_at" datetime default current_timestamp,
      "deleted_at" datetime,
      primary key ("id")
    )`,
	`create table if not exists ${S}."tc_report_submission" (
      "id" varchar(32) not null,
      "report_id" varchar(32) not null,
      "task_id" varchar(191) not null,
      "submitter_id" varchar(36) not null,
      "revision" int not null,
      "payload" text default null,
      "created_at" datetime default current_timestamp,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_report_submission_revision" on ${S}."tc_report_submission" ("report_id", "revision")`,
	`create index if not exists "idx_report_submission_task" on ${S}."tc_report_submission" ("task_id", "created_at")`,
	`create table if not exists ${S}."tc_task_report" (
      "id" varchar(32) not null,
      "task_id" varchar(191) not null,
      "draft" text default null,
      "revision" int not null default 0,
      "current_submission_id" varchar(32) default null,
      "created_at" datetime default current_timestamp,
      "updated_at" datetime default current_timestamp,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_task_report_task" on ${S}."tc_task_report" ("task_id")`,
	`create table if not exists ${S}."tc_workflow" (
      "id" varchar(191) not null,
      "payload" text not null,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      "deleted_at" datetime default null,
      primary key ("id")
    )`,
	`create table if not exists ${S}."tc_task" (
      "id" varchar(191) not null,
      "name" varchar(255) not null,
      "description" text default null,
      "status" varchar(32) not null,
      "creator_id" varchar(191) not null,
      "due_at" datetime default null,
      "priority" tinyint default null,
      "payload" text default null,
      "workflow" text not null,
      "workflow_id" varchar(191),
      "parent_id" varchar(191),
      "report" text,
      "reminder_config" text,
      "deleted_at" datetime default null,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create index if not exists "idx_task_status_created" on ${S}."tc_task" ("status", "created_at")`,
	`create index if not exists "idx_task_workflow" on ${S}."tc_task" ("workflow_id")`,
	`create index if not exists "idx_task_creator_status" on ${S}."tc_task" ("creator_id", "status")`,
	`create index if not exists "idx_task_parent" on ${S}."tc_task" ("parent_id")`,
	`create table if not exists ${S}."tc_task_reminder" (
      "id" varchar(36) not null,
      "task_id" varchar(191) not null,
      "action_id" varchar(191) default null,
      "recipient_id" varchar(191) not null,
      "kind" varchar(20) not null,
      "offset_minutes" int not null,
      "channels" text not null,
      "scheduled_at" datetime not null,
      "status" varchar(20) not null,
      "event_key" varchar(191) not null,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_task_reminder_event" on ${S}."tc_task_reminder" ("event_key")`,
	`create index if not exists "idx_task_reminder_due" on ${S}."tc_task_reminder" ("status", "scheduled_at")`,
	`create index if not exists "idx_task_reminder_task" on ${S}."tc_task_reminder" ("task_id", "status")`,
	`create table if not exists ${S}."tc_action" (
      "id" varchar(191) not null,
      "task_id" varchar(191) not null,
      "root_action_id" varchar(191) not null,
      "parent_action_id" varchar(191) default null,
      "is_locking" tinyint not null,
      "from_status" varchar(32) default null,
      "to_status" varchar(32) default null,
      "sequence" int not null,
      "creator_id" varchar(191) not null,
      "assignee_id" varchar(191) not null,
      "status" varchar(16) not null,
      "viewed_at" datetime default null,
      "activated_at" datetime default null,
      "last_urged_at" datetime default null,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create index if not exists "idx_action_task_root" on ${S}."tc_action" ("task_id", "root_action_id", "sequence")`,
	`create index if not exists "idx_action_assignee_status" on ${S}."tc_action" ("assignee_id", "status")`,
	`create index if not exists "idx_action_parent" on ${S}."tc_action" ("parent_action_id")`,
	`create index if not exists "idx_action_unviewed" on ${S}."tc_action" ("status", "viewed_at", "activated_at")`,
	`create table if not exists ${S}."tc_member" (
      "id" varchar(191) not null,
      "task_id" varchar(191) not null,
      "user_id" varchar(36) not null,
      "role" varchar(16) not null,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create unique index if not exists "uk_member_unique" on ${S}."tc_member" ("task_id", "user_id", "role")`,
	`create index if not exists "idx_member_user_role" on ${S}."tc_member" ("user_id", "role")`,
	`create index if not exists "idx_member_task_role" on ${S}."tc_member" ("task_id", "role")`,
	`create table if not exists ${S}."tc_comment" (
      "id" varchar(191) not null,
      "task_id" varchar(191) not null,
      "author_id" varchar(36) not null,
      "content" text not null,
      "attachments" text default null,
      "deleted_at" datetime default null,
      "created_at" datetime not null default current_timestamp,
      "updated_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create index if not exists "idx_comment_task_created" on ${S}."tc_comment" ("task_id", "created_at")`,
	`create index if not exists "idx_comment_author" on ${S}."tc_comment" ("author_id")`,
	`create table if not exists ${S}."tc_log" (
      "id" varchar(32) not null,
      "task_id" varchar(191) not null,
      "event" varchar(48) not null,
      "from_status" varchar(32) default null,
      "to_status" varchar(32) default null,
      "target_id" varchar(191) default null,
      "actor_id" varchar(36) not null,
      "actor_name" varchar(64) default null,
      "detail" text default null,
      "created_at" datetime not null default current_timestamp,
      primary key ("id")
    )`,
	`create index if not exists "idx_log_task_created" on ${S}."tc_log" ("task_id", "created_at")`,
	`create index if not exists "idx_log_task_event" on ${S}."tc_log" ("task_id", "event", "created_at")`,
	`create index if not exists "idx_log_actor" on ${S}."tc_log" ("actor_id", "created_at")`,
	`create index if not exists "idx_log_target" on ${S}."tc_log" ("target_id", "created_at")`,

	// ── todos(模板示例表,删 demo 时可一并删)──────────────────────────────
	`create table if not exists ${S}."todos" (
		"id" int identity(1,1) not null,
		"title" text not null,
		"created_at" datetime default current_timestamp,
		primary key ("id")
	)`,
];

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url?.startsWith("dm://")) {
		console.error("DATABASE_URL 不是 dm://,本脚本只服务达梦。跳过。");
		process.exit(0);
	}

	const pool = (await dmdb.createPool({ connectString: url, poolMax: 1, poolTimeout: 10 })) as unknown as {
		getConnection: (cb: (e: unknown, c: Conn) => void) => void;
		close: () => Promise<void>;
	};
	const conn = await new Promise<Conn>((res, rej) => pool.getConnection((e, c) => (e ? rej(e as Error) : res(c))));
	const run = (sql: string) =>
		new Promise<void>((res, rej) => conn.execute(sql, [], { outFormat: 4002 }, (e) => (e ? rej(e as Error) : res())));
	const q = (sql: string) =>
		new Promise<Array<Record<string, unknown>>>((res, rej) =>
			conn.execute(sql, [], { outFormat: 4002 }, (e, r) =>
				e ? rej(e as Error) : res((r as { rows: Array<Record<string, unknown>> }).rows ?? []),
			),
		);

	// ── 老库改表名必须在**建表之前**跑 ──
	// 否则 `create table if not exists` 会先把**新名字**那张空表建出来,改名随即看到「新旧同时存在」
	// 而不敢合并:数据留在旧表、新表空着,而且**每次执行都重复这一幕**(MySQL 线已按同样顺序修正)。
	let failed = 0;
	const tableRenames: Array<{ from: string; to: string }> = [
		{ from: "sys_department", to: "sys_dept" },
		{ from: "sys_department_member", to: "sys_user_dept" },
		// 功能权限策略表补 `sys_` 前缀,与 MySQL 线同步。
		{ from: "casbin_rule", to: "sys_casbin_rule" },
	];
	let renamed = 0;
	const existingTables = new Set(
		(await q(`select TABLE_NAME from SYS.ALL_TABLES where OWNER='${SCHEMA}'`)).map((r) =>
			String(r.TABLE_NAME).toLowerCase(),
		),
	);
	for (const rename of tableRenames) {
		if (!existingTables.has(rename.from)) {
			console.log(`· ${rename.from} 不存在(已是新名或新库),跳过`);
			continue;
		}
		if (existingTables.has(rename.to)) {
			console.log(`· ${rename.from} 与 ${rename.to} 同时存在 —— 不自动合并,请人工确认后处理`);
			continue;
		}
		try {
			await run(`alter table ${S}."${rename.from}" rename to "${rename.to}"`);
			renamed += 1;
			console.log(`✓ 表改名 ${rename.from} → ${rename.to}`);
		} catch (e) {
			failed += 1;
			console.log(`✗ ${rename.from} 表改名失败:${(e as Error).message?.slice(0, 90).replace(/\n/g, " ")}`);
		}
	}
	// 动作列名须在建索引前统一，否则旧库会先尝试引用不存在的新列。
	if (existingTables.has("tc_action")) {
		const cols = new Set(
			(
				await q(`select COLUMN_NAME as c from SYS.ALL_TAB_COLUMNS where OWNER='${SCHEMA}' and TABLE_NAME='tc_action'`)
			).map((row) => String(row.C ?? row.c).toLowerCase()),
		);
		const renames = [
			{ from: "created_id", to: "creator_id" },
			{ from: "handle_id", to: "assignee_id" },
			{ from: "serial_no", to: "root_action_id" },
		];
		for (const { from, to } of renames) {
			if (cols.has(from) && cols.has(to)) throw new Error(`tc_action 同时存在 ${from} 和 ${to}，请先处理`);
		}
		if (cols.has("handle_id")) {
			const oldIndex = await q(
				`select INDEX_NAME as n from SYS.ALL_INDEXES where OWNER='${SCHEMA}' and TABLE_NAME='tc_action' and INDEX_NAME='idx_action_handle_status'`,
			);
			if (oldIndex.length) await run(`drop index "idx_action_handle_status" on ${S}."tc_action"`);
		}
		if (cols.has("serial_no")) {
			const oldIndex = await q(
				`select INDEX_NAME as n from SYS.ALL_INDEXES where OWNER='${SCHEMA}' and TABLE_NAME='tc_action' and INDEX_NAME='idx_action_task_serial'`,
			);
			if (oldIndex.length) await run(`drop index "idx_action_task_serial" on ${S}."tc_action"`);
		}
		for (const { from, to } of renames) {
			if (!cols.has(from)) continue;
			await run(`alter table ${S}."tc_action" rename column "${from}" to "${to}"`);
			renamed += 1;
		}
	}
	// 任务动作列名迁移结束
	// 改过表名就必须清计划缓存:达梦的**全局计划缓存**里还留着按旧表名编译的计划,
	// 否则后续参数化语句会报 `[-7009] Object is modified`(实测踩过 —— 报错看着像表不存在,其实是计划失效)。
	if (renamed > 0) {
		try {
			await run("call sp_clear_plan_cache()");
			console.log("✓ 已清达梦计划缓存(表名变了,旧计划不能再用了)");
		} catch (e) {
			console.log(`· 计划缓存未清(不影响建表):${(e as Error).message?.slice(0, 70).replace(/\n/g, " ")}`);
		}
	}

	// 快照取在改名**之后** —— 否则刚搬过去的表会被报成「✓ 新建」(它此前的名字不在这份名单里)。
	const before = new Set(
		(await q(`select TABLE_NAME from SYS.ALL_TABLES where OWNER='${SCHEMA}'`)).map((r) => String(r.TABLE_NAME)),
	);

	// 任务索引迁移开始
	// 只删除列定义不匹配的旧索引；随后 STATEMENTS 负责创建或补建。
	await upgradeTaskStatusIndex(SCHEMA, q, run);
	// 任务索引迁移结束

	for (const sql of STATEMENTS) {
		const isCreateTable = /create table/i.test(sql);
		const tableName = isCreateTable ? sql.match(/"([a-z_]+)"\s*\(/)?.[1] : undefined;
		const existed = tableName ? before.has(tableName) : undefined;
		try {
			await run(sql);
			const action = isCreateTable ? (existed ? "· 已存在" : "✓ 新建") : "· 索引/约束";
			console.log(`${action} ${sql.replace(/\s+/g, " ").slice(0, 78)}`);
		} catch (e) {
			failed += 1;
			console.log(
				`✗ 失败:${sql.replace(/\s+/g, " ").slice(0, 60)}\n    ${(e as Error).message?.slice(0, 120).replace(/\n/g, " ")}`,
			);
		}
	}

	// ── 老库补列:`create table if not exists` 不会给已存在的表加列,新增列要在这里登记(幂等)──
	const columnUpgrades: Array<{ table: string; column: string; ddl: string }> = [
		{ table: "sys_user", column: "phone", ddl: "varchar(32)" },
		{ table: "tc_action", column: "viewed_at", ddl: "datetime" },
		{ table: "tc_action", column: "activated_at", ddl: "datetime" },
		{ table: "tc_action", column: "last_urged_at", ddl: "datetime" },
		{ table: "sys_scheduled_job", column: "cron_expression", ddl: "varchar(128)" },
		{ table: "sys_scheduled_job", column: "timezone", ddl: "varchar(64) default 'UTC' not null" },
		{ table: "sys_scheduled_job", column: "timeout_seconds", ddl: "int default 60 not null" },
		{ table: "sys_scheduled_job", column: "max_attempts", ddl: "int default 3 not null" },
		{ table: "sys_scheduled_job", column: "retry_delay_seconds", ddl: "int default 30 not null" },
		{ table: "sys_menu", column: "type", ddl: "tinyint default 2 not null" },
		{ table: "sys_menu", column: "perm", ddl: "varchar(64)" },
		// v2 (m20034):「输出值」搬到插件表(达梦没有 json 类型,落 text)
		{ table: "sys_data_plugin", column: "output_values", ddl: "text" },
		// m23422:规则多一列「从插件输出行里取哪个 key 的值去比」
		{ table: "sys_data_policy", column: "value_key", ddl: "varchar(64)" },
		// 统一软删 (m27126 #9):业务表补 `deleted_at`(sys_file 已有 status=2 行级软删,不叠这一列)
		{ table: "sys_menu", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_dict", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_para", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_tag", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_user", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_dept", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_role", column: "deleted_at", ddl: "datetime" },
		{ table: "demo_grid", column: "deleted_at", ddl: "datetime" },
		// 填报模板合并版本表:schema → payload(结构搬进模板行)+ shared 可见性标志
		{ table: "tc_report_template", column: "payload", ddl: "text" },
		{ table: "tc_report_template", column: "shared", ddl: "tinyint default 0 not null" },
		{ table: "tc_report_template", column: "deleted_at", ddl: "datetime" },
		// 流程模板来源(「我的任务」按模板筛):v1 起写入;旧任务 null(快照里没有模板 id,无法回填)
		{ table: "tc_task", column: "workflow_id", ddl: "varchar(191)" },
		// 父子任务 + 填报规则(批次退役)
		{ table: "tc_task", column: "parent_id", ddl: "varchar(191)" },
		{ table: "tc_task", column: "report", ddl: "text" },
		{ table: "tc_task", column: "reminder_config", ddl: "text" },
		{ table: "sys_data_policy", column: "deleted_at", ddl: "datetime" },
		{ table: "sys_data_plugin", column: "deleted_at", ddl: "datetime" },
	];
	for (const upgrade of columnUpgrades) {
		const cols = await q(
			`select COLUMN_NAME as c from SYS.ALL_TAB_COLUMNS where OWNER='${SCHEMA}' and TABLE_NAME='${upgrade.table}'`,
		);
		if (cols.some((row) => String(row.C ?? row.c).toLowerCase() === upgrade.column)) {
			console.log(`· ${upgrade.table}.${upgrade.column} 已存在,跳过`);
			continue;
		}
		try {
			await run(`alter table ${S}."${upgrade.table}" add column "${upgrade.column}" ${upgrade.ddl}`);
			console.log(`✓ ${upgrade.table} 补列 ${upgrade.column}(注释由 pnpm db:sync:meta 对齐)`);
		} catch (e) {
			failed += 1;
			console.log(`✗ ${upgrade.table} 补列失败:${(e as Error).message?.slice(0, 90).replace(/\n/g, " ")}`);
		}
	}

	// 任务批次迁移开始
	// ── 填报模板 / 填报批次退役:版本表与批次两张表整体删除(开发库删掉重来,数据不迁移)──
	for (const table of ["tc_report_template_version", "tc_report_batch_task", "tc_report_batch"]) {
		if (existingTables.has(table)) {
			await run(`drop table ${S}."${table}"`);
			console.log(`✓ 已删除 ${table}(版本/批次概念退役)`);
		}
	}
	// 任务批次迁移结束

	// ── 老库删列:列被合并 / 废弃时在这里登记(幂等;删列前先删挂在它上面的外键)──
	// 达梦老库列名变更(`code` → `fn`)不走本脚本 —— 达梦 `ALTER TABLE RENAME COLUMN` 在 8.1+
	// 才有,且**必须在所有列 drop 前**跑,迁移时人工执行:
	//   alter table "sys_data_plugin" rename column "code" to "fn";
	// 任务成员索引迁移开始
	const memberPrimaryIndex = await q(
		`select INDEX_NAME as n from SYS.ALL_INDEXES where OWNER='${SCHEMA}' and TABLE_NAME='tc_member' and INDEX_NAME='idx_member_task_primary'`,
	);
	if (memberPrimaryIndex.length) await run(`drop index "idx_member_task_primary" on ${S}."tc_member"`);
	// 任务成员索引迁移结束
	const columnDrops: Array<{ table: string; column: string; constraint?: string }> = [
		{ table: "sys_notification_delivery", column: "provider" },
		{ table: "sys_user_dept", column: "role_id", constraint: "fk_sys_dm_role" },
		// 菜单的「启用 / 停用」从来没人读(上下线走 visible,且带子树语义)—— 死列,删掉
		{ table: "sys_menu", column: "status" },
		// sys_para 的 id 是无意义代理键(主键是 para_key)—— 删掉
		{ table: "sys_para", column: "id" },
		// 这两张表只增不改(标签关联行 / 部门成员)—— `updated_at` 永远等于 created_at,白列
		{ table: "sys_tag_relation", column: "updated_at" },
		{ table: "sys_user_dept", column: "updated_at" },
		// 填报合并版本表:version_id 概念移除,模板引用统一走 tc_task.report.reportId
		{ table: "tc_task_report", column: "version_id" },
		{ table: "tc_task_report", column: "status" },
		{ table: "tc_member", column: "is_primary" },
		// 数据权限 v1.1:「给值 / 给行」不再是字段,改由 `domain` / `resource` 推导(`data-scope-spec.ts` 的 `producesOf()`)
		{ table: "sys_data_plugin", column: "produces" },
		// 数据权限 v1.2:插件只剩「一段函数体」一档,`declared`(登记取数)整档删掉 —— 这两列随之废弃
		{ table: "sys_data_plugin", column: "impl_kind" },
		{ table: "sys_data_plugin", column: "decl" },
		// 数据权限 v1.3 (m18228):user 明确「插件不需要域概念」 —— domain / resource 全砍
		{ table: "sys_data_plugin", column: "domain" },
		{ table: "sys_data_plugin", column: "resource" },
		// 数据权限 v2 (m20034):user 明确「新建插件只允许指定清单(fixed)类」 —— 函数体那段(fn)不进库;
		// 「输出值」搬到 plugin.output_values,规则行的 params 删(规则不再带参数)。
		{ table: "sys_data_plugin", column: "fn" },
		{ table: "sys_data_policy", column: "params" },
		// m24215:demo_grid 拿掉「管理单元」概念,group_id 列删
		{ table: "demo_grid", column: "group_id" },
	];
	for (const drop of columnDrops) {
		const cols = await q(
			`select COLUMN_NAME as c from SYS.ALL_TAB_COLUMNS where OWNER='${SCHEMA}' and TABLE_NAME='${drop.table}'`,
		);
		if (!cols.some((row) => String(row.C ?? row.c).toLowerCase() === drop.column)) {
			console.log(`· ${drop.table}.${drop.column} 不存在,跳过`);
			continue;
		}
		try {
			if (drop.constraint) {
				await run(`alter table ${S}."${drop.table}" drop constraint "${drop.constraint}"`);
				console.log(`· ${drop.table} 先删外键 ${drop.constraint}`);
			}
			await run(`alter table ${S}."${drop.table}" drop column "${drop.column}"`);
			console.log(`✓ ${drop.table} 删列 ${drop.column}`);
		} catch (e) {
			failed += 1;
			console.log(`✗ ${drop.table} 删列失败:${(e as Error).message?.slice(0, 90).replace(/\n/g, " ")}`);
		}
	}

	// ── 老库删索引:demo_grid.group_id 没了,idx_demo_grid_group 也得跟上(m24215)──
	const indexDrops: Array<{ table: string; index: string }> = [{ table: "demo_grid", index: "idx_demo_grid_group" }];
	for (const drop of indexDrops) {
		const idx = await q(
			`select INDEX_NAME as n from SYS.ALL_INDEXES where OWNER='${SCHEMA}' and TABLE_NAME='${drop.table}' and INDEX_NAME='${drop.index}'`,
		);
		if (idx.length === 0) {
			console.log(`· ${drop.table}.${drop.index} 不存在,跳过`);
			continue;
		}
		try {
			await run(`drop index "${drop.index}" on ${S}."${drop.table}"`);
			console.log(`✓ ${drop.table} 删索引 ${drop.index}`);
		} catch (e) {
			failed += 1;
			console.log(`✗ ${drop.table} 删索引失败:${(e as Error).message?.slice(0, 90).replace(/\n/g, " ")}`);
		}
	}

	const after = (await q(`select TABLE_NAME from SYS.ALL_TABLES where OWNER='${SCHEMA}' order by TABLE_NAME`)).map(
		(r) => String(r.TABLE_NAME),
	);
	console.log(`\n${SCHEMA} 模式现在的表:${after.join(", ")}`);
	console.log(failed === 0 ? "\n✓ 全部就绪(幂等,可重复跑)" : `\n⚠️ 有 ${failed} 条语句失败,见上`);
	console.log("提示:表注释 / 列注释用 `pnpm db:sync:meta` 对齐(达梦支持 comment on,和 MySQL 共用一份真源)。");
	await conn.close();
	await pool.close();
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error("fatal:", (e as Error).message);
	process.exit(1);
});
