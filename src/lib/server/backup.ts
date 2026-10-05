import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { stamp } from "$lib/format";
import { backup as config } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import type { MetricRow } from "$lib/types";

const FILE = /^osm-reviewer-\d{8}T\d{6}Z\.db$/;
const HOUR_MS = 3_600_000;

let running = false;
let lastError: string | null = null;

/** Names sort chronologically because the timestamp is fixed-width UTC. */
export const snapshots = (dir: string) =>
	readdirSync(dir)
		.filter((f) => FILE.test(f))
		.sort();

export const snapshotName = (at: Date) =>
	`osm-reviewer-${at.toISOString().replace(/[-:]|\.\d+/g, "")}.db`;

export function pruneSnapshots(dir: string, keep: number) {
	const all = snapshots(dir);
	for (const f of all.slice(0, Math.max(0, all.length - keep)))
		rmSync(join(dir, f), { force: true });
}

/** Skips when one is already in flight, so a slow disk never stacks two on each other. */
async function runBackup(db: Db, dir: string, keep: number): Promise<string | null> {
	if (running) return null;
	running = true;
	try {
		mkdirSync(dir, { recursive: true });
		const name = snapshotName(new Date());
		await db.$client.backup(join(dir, name));
		pruneSnapshots(dir, keep);
		lastError = null;
		return name;
	} catch (err) {
		lastError = err instanceof Error ? err.message : String(err);
		console.error("backup:", lastError);
		return null;
	} finally {
		running = false;
	}
}

function newestMtime(dir: string) {
	try {
		const last = snapshots(dir).at(-1);
		return last ? statSync(join(dir, last)).mtimeMs : 0;
	} catch {
		return 0;
	}
}

/**
 * The first snapshot waits out whatever is left of the interval since the newest one on
 * disk, so a restart loop does not fill the directory.
 */
export function startBackups(db: Db) {
	const { dir, intervalHours, keep } = config;
	if (!dir || intervalHours <= 0) return;
	const every = intervalHours * HOUR_MS;
	const tick = () => void runBackup(db, dir, keep);
	setTimeout(
		() => {
			tick();
			setInterval(tick, every).unref();
		},
		Math.max(0, newestMtime(dir) + every - Date.now()),
	).unref();
}

export function backupHealth(): MetricRow {
	const { dir, intervalHours, keep } = config;
	if (!dir) return ["backup", "not configured", "BACKUP_DIR is unset"];
	const detail = `${dir} · every ${intervalHours} h · keep ${keep}`;
	try {
		if (lastError) return ["backup", "failed", `${lastError} · ${detail}`, "bad"];
		const last = snapshots(dir).at(-1);
		if (!last) return ["backup", "none yet", detail, "warn"];
		const st = statSync(join(dir, last));
		const stale = Date.now() - st.mtimeMs > 2 * intervalHours * HOUR_MS;
		return [
			"backup",
			`${stamp(st.mtime)} · ${(st.size / 1024 / 1024).toFixed(1)} MB`,
			detail,
			stale ? "warn" : "ok",
		];
	} catch {
		return ["backup", "none yet", detail, "warn"];
	}
}
