import { statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { count, sql } from "drizzle-orm";
import { env } from "$env/dynamic/private";
import { providerReachable } from "$lib/server/auth/oidc";
import { sso } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import { resolveDatabasePath } from "$lib/server/db/path";
import { candidates, sources } from "$lib/server/db/schema";
import type { MetricRow } from "$lib/types";
import { version } from "../../../package.json";

export const NOT_CONFIGURED = "not configured";
export const NOT_IMPLEMENTED = "not implemented";

/** The `created_by` tag a changeset carries. */
export const CREATED_BY = `osm-reviewer/${version}`;

const MB = 1024 * 1024;
const size = (bytes: number) =>
	bytes >= 1024 * MB ? (bytes / 1024 / MB).toFixed(1) + " GB" : (bytes / MB).toFixed(1) + " MB";

function uptime() {
	const s = Math.floor(process.uptime());
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/** The commit the running build came from. The Nix package and the OCI image set it; a
    `pnpm dev` or a hand-built `build/` has none. */
const rev = () => env.OSM_REVIEWER_REV || "unknown rev";

/** What the login screen may say about the instance before anyone has signed in. */
export const release = (host: string) => ({ host, version, rev: rev(), uptime: uptime() });

/** WAL keeps recent writes beside the main file until a checkpoint, so it counts too. */
function databaseBytes(path: string) {
	let total = 0;
	for (const suffix of ["", "-wal"]) {
		try {
			total += statSync(path + suffix).size;
		} catch {
			// no WAL file between checkpoints
		}
	}
	return total;
}

export function instanceFacts(db: Db) {
	const path = resolveDatabasePath(env.DATABASE_PATH);
	const sqlite = db.get<{ v: string }>(sql`select sqlite_version() as v`).v;
	const queued = db.select({ n: count() }).from(candidates).get()?.n ?? 0;
	return {
		version,
		rev: rev(),
		image: env.OSM_REVIEWER_IMAGE || NOT_CONFIGURED,
		runtime: `node ${process.versions.node} · sqlite ${sqlite}`,
		uptime: uptime(),
		db: `${size(databaseBytes(path))} · ${queued} candidates · ${path}`,
	};
}

/** Answers within this, or the diagnostics pane would hang on a provider that is down. */
const PROBE_MS = 3000;

async function identityProvider(): Promise<MetricRow> {
	if (!sso.enabled)
		return ["identity provider", NOT_CONFIGURED, "SSO_ISSUER is unset or SSO_ENABLED=false"];
	const timeout = new Promise<string>((resolve) =>
		setTimeout(() => resolve("no answer in 3 s"), PROBE_MS),
	);
	const result = await Promise.race([
		providerReachable().then(
			() => null,
			(err: unknown) => (err instanceof Error ? err.message : String(err)),
		),
		timeout,
	]);
	return result === null
		? ["identity provider", "reachable", sso.host + " · discovery cached", "ok"]
		: ["identity provider", "unreachable", sso.host + " · " + result, "bad"];
}

function disk(): MetricRow {
	const dir = dirname(resolveDatabasePath(env.DATABASE_PATH));
	const fs = statfsSync(dir);
	const total = fs.blocks * fs.bsize;
	const free = fs.bavail * fs.bsize;
	return [
		"disk",
		`${size(free)} free`,
		`of ${size(total)} · ${dir}`,
		free / total < 0.1 ? "warn" : "ok",
	];
}

function sourceHealth(db: Db): MetricRow {
	const rows = db.select({ name: sources.name, health: sources.health }).from(sources).all();
	if (rows.length === 0) return ["sources", "none", "no source configured"];
	const failing = rows.filter((r) => r.health !== "ok");
	return [
		"sources",
		`${rows.length - failing.length} of ${rows.length} healthy`,
		failing.map((r) => r.name).join(", ") || "as of each source's last run",
		failing.some((r) => r.health === "error") ? "bad" : failing.length ? "warn" : "ok",
	];
}

/** Rows that read a fixed value are features with nothing behind them yet: no dot, no tone. */
export async function health(db: Db): Promise<MetricRow[]> {
	return [
		["pipeline worker", NOT_IMPLEMENTED, "nothing feeds the queue yet"],
		["OSM API", NOT_IMPLEMENTED, "changeset upload is simulated"],
		sourceHealth(db),
		await identityProvider(),
		disk(),
		["backup", NOT_CONFIGURED],
	];
}
