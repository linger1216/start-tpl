import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// `.env.local` wins over `.env` (dotenv does not override already-set keys).
// `.env.example` documents the expected shape; real values go in `.env.local`.
config({ path: [".env.local", ".env"] });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is not set. Run `cp .env.example .env.local` and fill in your MySQL connection string.",
	);
}

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	dialect: "mysql",
	dbCredentials: {
		url: databaseUrl,
	},
});
