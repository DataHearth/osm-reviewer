import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { resolveDatabasePath } from "./path";
import * as schema from "./schema";

export function createDb(databasePath?: string) {
	const sqlite = new Database(resolveDatabasePath(databasePath));
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	return drizzle(sqlite, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;
