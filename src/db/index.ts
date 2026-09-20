import { drizzle } from "drizzle-orm/mysql2";

import * as schema from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is not set. Run `cp .env.example .env.local` and fill in your MySQL connection string.",
	);
}

export const db = drizzle(databaseUrl, {
	schema,
	mode: "default",
});
