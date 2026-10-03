import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client";

/**
 * This module is bundled to a different depth in dev (src/lib/server/db) than in
 * the adapter-node output (build/server/chunks), and the built server may be
 * started from any working directory, so neither a relative literal nor
 * process.cwd() finds the folder reliably. Walking up from the module itself
 * finds the repo root in dev and build/ in production, where vite.config.ts
 * copies the generated migrations.
 */
function findMigrationsFolder(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const candidate = join(dir, "drizzle");
		if (existsSync(join(candidate, "meta", "_journal.json"))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`no drizzle/ migrations folder above ${import.meta.url}`);
		dir = parent;
	}
}

/**
 * Drizzle applies every pending migration inside one transaction, where SQLite
 * ignores `PRAGMA foreign_keys`. The OFF that a generated table rebuild emits is
 * therefore a no-op, and dropping the old table cascades through its children:
 * 0005's `areas` rebuild deleted every candidate and decision this way. Keys are
 * off around the whole run instead, and the check afterwards replaces the one
 * SQLite would have made.
 */
export function runMigrations(db: Db): void {
	const sqlite = db.$client;
	sqlite.pragma("foreign_keys = OFF");
	try {
		migrate(db, { migrationsFolder: findMigrationsFolder() });
		const broken = sqlite.pragma("foreign_key_check") as unknown[];
		if (broken.length > 0) throw new Error(`migrations left ${broken.length} broken foreign keys`);
	} finally {
		sqlite.pragma("foreign_keys = ON");
	}
}
