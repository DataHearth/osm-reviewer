import { defineConfig } from "drizzle-kit";
import { resolveDatabasePath } from "./src/lib/server/db/path";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/lib/server/db/schema.ts",
	out: "./drizzle",
	casing: "snake_case",
	dbCredentials: { url: resolveDatabasePath(process.env.DATABASE_PATH) },
});
