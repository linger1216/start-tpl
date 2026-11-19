import { sql } from "drizzle-orm";
import { db } from "../src/db/index.ts";

/**
 * 一次性:旧任务不做迁移、直接丢弃(用户口径)。
 * 删表比逐列 rename 干净 —— `db:create` 会用新 DDL 重建。
 */
const tables = ["tc_log", "tc_comment", "tc_action", "tc_member", "tc_task_reminder", "tc_task_report", "tc_task"];
for (const table of tables) await db.execute(sql.raw(`drop table if exists \`${table}\``));
console.log(`✓ dropped ${tables.length} tc_* tables`);
