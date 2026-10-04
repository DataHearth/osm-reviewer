import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Playwright config and the global setup are separate modules and either may
 * be loaded first, so the directory travels between them through the environment
 * instead of being recomputed: a second `mkdtemp` would hand the fixture a database
 * the server never opened.
 */
function provision(): string {
	const handed = process.env.OSM_REVIEWER_E2E_DB_DIR;
	if (handed) {
		mkdirSync(handed, { recursive: true });
		return handed;
	}
	const dir = mkdtempSync(join(tmpdir(), "osm-reviewer-e2e-"));
	process.env.OSM_REVIEWER_E2E_DB_DIR = dir;
	return dir;
}

/** WAL needs the directory writable, not just the file, which is why this is a directory. */
export const E2E_DATABASE_DIR = provision();
export const E2E_DATABASE_PATH = join(E2E_DATABASE_DIR, "osm-reviewer.db");
