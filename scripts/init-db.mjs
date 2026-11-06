#!/usr/bin/env node
/**
 * 根据 .env.local 中的 DATABASE_URL 自动连接 MySQL 服务端并创建数据库。
 * 用法:
 *   node scripts/init-db.mjs [--root <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import mysql from "mysql2/promise";

const rootArgIdx = process.argv.indexOf("--root");
const root = rootArgIdx >= 0 ? path.resolve(process.argv[rootArgIdx + 1]) : process.cwd();
const envLocalPath = path.join(root, ".env.local");

if (!fs.existsSync(envLocalPath)) {
	console.error(`Error: 未找到环境配置文件: ${envLocalPath}`);
	process.exit(1);
}

const envContent = fs.readFileSync(envLocalPath, "utf8");
const dbMatch = envContent.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?/m);

if (!dbMatch || !dbMatch[1]) {
	console.error("Error: .env.local 中未找到有效的 DATABASE_URL 配置。");
	process.exit(1);
}

const rawUrl = dbMatch[1].trim();
if (!rawUrl.startsWith("mysql://") && !rawUrl.startsWith("mysql2://")) {
	console.error("Error: 自动建库仅支持 MySQL,请配置独立 MySQL 数据库或按达梦文档手动初始化。");
	process.exit(1);
}

let parsed;
try {
	parsed = new URL(rawUrl);
} catch (e) {
	console.error(`Error: 无法解析 DATABASE_URL: ${e.message}`);
	process.exit(1);
}

const dbName = parsed.pathname.replace(/^\//, "");
if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
	console.error("Error: DATABASE_URL 中的数据库名称只能包含字母、数字和下划线。");
	process.exit(1);
}

const host = parsed.hostname || "localhost";
const port = parsed.port ? Number(parsed.port) : 3306;
const user = decodeURIComponent(parsed.username || "root");
const password = decodeURIComponent(parsed.password || "");

async function main() {
	let connection;
	try {
		connection = await mysql.createConnection({
			host,
			port,
			user,
			password,
			connectTimeout: 5000,
		});
		await connection.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
		console.log(`  ✓ MySQL 数据库「${dbName}」已就绪 (${host}:${port})`);
	} catch (err) {
		console.error(`  ✗ 自动建库失败 (${host}:${port}/${dbName}): ${err.message}`);
		console.error("    请检查 MySQL 服务是否正在运行且用户名密码正确。");
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

main();
