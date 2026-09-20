import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_DATABASE_PATH = "./data/osm-reviewer.db";

/** Absolute path to the SQLite file, with its parent directory created if missing. */
export function resolveDatabasePath(configured?: string): string {
	const file = resolve(configured || DEFAULT_DATABASE_PATH);
	mkdirSync(dirname(file), { recursive: true });
	return file;
}
