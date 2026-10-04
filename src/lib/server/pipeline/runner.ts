import { and, count, desc, eq, isNull } from "drizzle-orm";
import { pipeline } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { notify } from "$lib/server/notify";
import { loadNotif } from "$lib/server/settings";
import { Crawler, parseBudget, parseSeedRule } from "./crawl";
import { hasShape } from "./geo";
import { userAgent } from "./http";
import { modelLabel } from "./llm";
import { readApiArea } from "./opendata";
import { fetchElements } from "./overpass";
import {
	type AreaInput,
	type AreaOutcome,
	type AreaRow,
	processArea,
	type SourceRow,
} from "./process";
import { hash } from "./reader";
import { type RegistryState, readRegistry } from "./registry";
import { HOLD_AFTER_FAILURES, nextRunAt, RETRY_AFTER_MS } from "./schedule";
import { parseMatching } from "./tagfilter";
import { type OsmElement, osmRef, PipelineError, type RawRecord } from "./types";

const TICK_MS = 60_000;
const FIRST_TICK_MS = 5_000;
/** A run that has held its claim this long died with its process; the next one may take over. */
const STALE_CLAIM_MS = 3 * 3_600_000;
const MESSAGES_SHOWN = 3;

interface Exec {
	fetched: number;
	cands: number;
	errors: string[];
	areasOk: number;
	areasTried: number;
	note: string | null;
	state: Record<string, unknown>;
	licence?: string;
	outside?: number;
	withheld?: number;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function absorb(out: Exec, p: AreaOutcome) {
	out.cands += p.cands;
	out.errors.push(...p.errors);
	out.outside = (out.outside ?? 0) + p.outside;
	out.withheld = (out.withheld ?? 0) + p.withheld;
}

/** What a run set aside on purpose, which the run's line says whether or not it also failed somewhere. */
const asides = ({ outside = 0, withheld = 0 }: Exec) => [
	...(outside === 1 ? ["1 record placed outside the area by its own address"] : []),
	...(outside > 1 ? [`${outside} records placed outside the area by their own address`] : []),
	...(withheld === 1 ? ["1 personal contact detail left out"] : []),
	...(withheld > 1 ? [`${withheld} personal contact details left out`] : []),
];
export const claimFresh = (s: { runningSince: Date | null }) =>
	s.runningSince !== null && Date.now() - s.runningSince.getTime() < STALE_CLAIM_MS;

export function pendingCount(db: Db): number {
	return (
		db
			.select({ n: count() })
			.from(t.candidates)
			.leftJoin(t.decisions, eq(t.decisions.candidateId, t.candidates.id))
			.where(isNull(t.decisions.candidateId))
			.get()?.n ?? 0
	);
}

async function readRegistrySource(
	db: Db,
	source: SourceRow,
	areas: AreaRow[],
	at: Date,
): Promise<Exec> {
	const state = ((source.syncState ?? {}) as { registry?: RegistryState }).registry ?? {};
	const reg = await readRegistry(
		source,
		areas,
		state,
		areas.some((a) => a.lastRunAt === null),
	);
	// The licence the dataset's own metadata names travels with this run's evidence too.
	const withLicence = { ...source, licence: source.licence || reg.licence || "" };
	const out: Exec = {
		fetched: reg.scanned,
		cands: 0,
		errors: [],
		areasOk: 0,
		areasTried: areas.length,
		note: reg.unchanged ? "dataset unchanged" : reg.skipped ? `${reg.skipped} rows skipped` : null,
		state: { ...(source.syncState ?? {}), registry: reg.state },
		licence: reg.licence,
	};
	for (const area of areas) {
		const records: RawRecord[] = [...(reg.byArea.get(area.id) ?? [])].map(([key, rows]) => ({
			key,
			rows,
			url: `${reg.fileUrl}#${encodeURIComponent(key)}`,
		}));
		try {
			const r = await processArea(
				db,
				withLicence,
				area,
				{ records, reader: reg.reader, complete: !reg.unchanged },
				at,
			);
			absorb(out, r);
			out.areasOk += 1;
		} catch (err) {
			out.errors.push(`${area.name}: ${msg(err)}`);
		}
	}
	return out;
}

async function readApiSource(db: Db, source: SourceRow, areas: AreaRow[], at: Date): Promise<Exec> {
	const out: Exec = {
		fetched: 0,
		cands: 0,
		errors: [],
		areasOk: 0,
		areasTried: areas.length,
		note: null,
		state: source.syncState ?? {},
	};
	let skipped = 0;
	for (const area of areas) {
		try {
			const r = await readApiArea(source, area);
			out.fetched += r.fetched;
			skipped += r.skipped;
			const base = source.endpoint.replace(/[?#].*$/, "");
			const records: RawRecord[] = [...r.rows].map(([key, rows]) => ({
				key,
				rows,
				url: r.reader?.keyField
					? `${base}?where=${encodeURIComponent(`${r.reader.keyField}="${key}"`)}`
					: base,
			}));
			const p = await processArea(
				db,
				source,
				area,
				{ records, reader: r.reader, complete: true },
				at,
			);
			absorb(out, p);
			out.areasOk += 1;
		} catch (err) {
			out.errors.push(`${area.name}: ${msg(err)}`);
		}
	}
	if (skipped) out.note = `${skipped} rows skipped`;
	return out;
}

const hostOf = (u: string) => {
	try {
		return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).host.replace(/^www\./, "");
	} catch {
		return null;
	}
};

async function readCrawlSource(
	db: Db,
	source: SourceRow,
	areas: AreaRow[],
	at: Date,
): Promise<Exec> {
	if (source.extractor !== "model")
		throw new PipelineError("a crawl needs the model extractor: pages have no fixed fields");
	const rule = parseSeedRule(source.endpoint);
	const crawler = new Crawler(parseBudget(source.budget), userAgent());
	const known = ((source.syncState ?? {}) as { pages?: Record<string, string> }).pages ?? {};
	const pages = { ...known };
	const out: Exec = {
		fetched: 0,
		cands: 0,
		errors: [],
		areasOk: 0,
		areasTried: areas.length,
		note: null,
		state: source.syncState ?? {},
	};
	const require = rule.require.length ? rule.require : [{ k: "website", v: null }];

	for (const area of areas) {
		try {
			const elements = await fetchElements(area, parseMatching(source.matching), require);
			const seeds: { url: string; el: OsmElement }[] = [];
			const byHost = new Map<string, OsmElement>();
			for (const el of elements) {
				for (const sel of require) {
					const url = el.tags[sel.k];
					if (!url) continue;
					const host = hostOf(url);
					if (host && !byHost.has(host)) byHost.set(host, el);
					seeds.push({ url, el });
					break;
				}
			}
			for (const url of rule.urls) {
				const el = byHost.get(hostOf(url) ?? "");
				if (el && !seeds.some((s) => s.el === el)) seeds.push({ url, el });
				else if (!el) out.errors.push(`no OSM POI in ${area.name} points at ${url}`);
			}

			const records: RawRecord[] = [];
			for (const seed of seeds) {
				if (crawler.exhausted) break;
				try {
					const page = await crawler.fetchSeed(seed.url);
					if (!page) continue;
					const key = osmRef(seed.el);
					records.push({
						key,
						url: page.url,
						rows: [],
						text: page.text,
						element: seed.el,
						unchanged: known[key] === hash(page.text),
					});
				} catch (err) {
					out.errors.push(`${seed.url}: ${msg(err)}`);
				}
			}

			// Unread pages are not gone pages, so a crawl never sweeps what it did not see.
			const input: AreaInput = { records, reader: null, elements, complete: false };
			const p = await processArea(db, source, area, input, at);
			absorb(out, p);
			for (const r of records)
				if (r.text && !p.failedKeys.includes(r.key)) pages[r.key] = hash(r.text);
			out.areasOk += 1;
		} catch (err) {
			out.errors.push(`${area.name}: ${msg(err)}`);
		}
	}
	out.fetched = crawler.pages;
	out.state = { ...(source.syncState ?? {}), pages };
	return out;
}

async function execute(db: Db, source: SourceRow, areas: AreaRow[], at: Date): Promise<Exec> {
	if (source.extractor === "model" && !modelLabel())
		throw new PipelineError("no model configured: set LLM_PROVIDER and LLM_MODEL");
	if (!source.endpoint.trim()) throw new PipelineError("the source has no endpoint");

	const shaped = areas.filter(hasShape);
	const bare = areas.filter((a) => !hasShape(a)).map((a) => `${a.name}: no boundary box yet`);
	if (shaped.length === 0) throw new PipelineError(bare.join("; "));

	const run =
		source.kind === "registry"
			? readRegistrySource
			: source.kind === "api"
				? readApiSource
				: readCrawlSource;
	const out = await run(db, source, shaped, at);
	out.errors.push(...bare);
	out.areasTried += bare.length;
	return out;
}

/** Runs one source over every area it is linked to and records the outcome. Never throws. */
export async function runSource(db: Db, id: string): Promise<void> {
	const claimed = db.transaction((tx) => {
		const s = tx.select().from(t.sources).where(eq(t.sources.id, id)).get();
		if (!s || claimFresh(s)) return null;
		tx.update(t.sources)
			.set({ runningSince: new Date(), runRequestedAt: null })
			.where(eq(t.sources.id, id))
			.run();
		return s;
	});
	if (!claimed) return;
	const source = claimed;
	const startedAt = new Date();
	const t0 = performance.now();

	const areas = db
		.select({ area: t.areas })
		.from(t.areaSources)
		.innerJoin(t.areas, eq(t.areas.id, t.areaSources.areaId))
		.where(and(eq(t.areaSources.sourceId, id), eq(t.areas.paused, false)))
		.all()
		.map((r) => r.area);

	if (areas.length === 0) {
		db.update(t.sources)
			.set({ runningSince: null, nextRunAt: nextRunAt(source.schedule, startedAt) })
			.where(eq(t.sources.id, id))
			.run();
		return;
	}

	const pendingBefore = pendingCount(db);
	let exec: Exec;
	let fatal: string | null = null;
	try {
		exec = await execute(db, source, areas, startedAt);
	} catch (err) {
		fatal = msg(err);
		exec = {
			fetched: 0,
			cands: 0,
			errors: [],
			areasOk: 0,
			areasTried: areas.length,
			note: null,
			state: source.syncState ?? {},
		};
	}

	const result: "ok" | "partial" | "failed" =
		fatal || exec.areasOk === 0 ? "failed" : exec.errors.length ? "partial" : "ok";
	const shown = [...new Set(fatal ? [fatal] : exec.errors)];
	const message =
		[
			result === "ok"
				? exec.note
				: shown.slice(0, MESSAGES_SHOWN).join("; ") +
					(shown.length > MESSAGES_SHOWN ? ` (+${shown.length - MESSAGES_SHOWN} more)` : ""),
			...asides(exec),
		]
			.filter(Boolean)
			.join("; ") || null;
	const errorCount = fatal ? 1 : exec.errors.length;

	db.transaction((tx) => {
		tx.insert(t.runs)
			.values({
				sourceId: id,
				startedAt,
				durMs: Math.round(performance.now() - t0),
				fetched: exec.fetched,
				cands: exec.cands,
				errors: errorCount,
				result,
				message,
			})
			.run();
		const recent = tx
			.select({ result: t.runs.result })
			.from(t.runs)
			.where(eq(t.runs.sourceId, id))
			.orderBy(desc(t.runs.startedAt), desc(t.runs.id))
			.limit(HOLD_AFTER_FAILURES)
			.all();
		const held =
			recent.length === HOLD_AFTER_FAILURES && recent.every((r) => r.result === "failed");
		tx.update(t.sources)
			.set({
				health: result === "ok" ? "ok" : result === "partial" ? "warn" : "error",
				failing: held,
				runningSince: null,
				nextRunAt:
					result === "failed"
						? new Date(Date.now() + RETRY_AFTER_MS)
						: nextRunAt(source.schedule, startedAt),
				syncState: result === "failed" ? source.syncState : exec.state,
				...(exec.licence && !source.licence ? { licence: exec.licence } : {}),
			})
			.where(eq(t.sources.id, id))
			.run();
	});

	await announce(db, source.name, result, exec, message, pendingBefore);
}

async function announce(
	db: Db,
	name: string,
	result: "ok" | "partial" | "failed",
	exec: Exec,
	message: string | null,
	pendingBefore: number,
) {
	try {
		if (result === "failed")
			await notify(db, "sourceFailed", `${name}: ${message ?? "run failed"}`);
		await notify(
			db,
			"runFinished",
			`${name}: ${result}, ${exec.cands} candidates${message ? ` — ${message}` : ""}`,
		);
		const over = (await loadNotif(db)).queueOver;
		const now = pendingCount(db);
		if (pendingBefore < over && now >= over)
			await notify(db, "queue", `${now} candidates are waiting for review (limit ${over})`);
	} catch (err) {
		console.error("pipeline: notification failed:", msg(err));
	}
}

/** The next source to run, or null. An explicit request wins and ignores `enabled` and the hold; the clock only counts while the scheduler is on. */
export function pickDue(db: Db, now = new Date()): string | null {
	const rows = db
		.select()
		.from(t.sources)
		.all()
		.filter((s) => !claimFresh(s));
	const asked = rows
		.filter((s) => s.runRequestedAt)
		.sort((a, b) => (a.runRequestedAt as Date).getTime() - (b.runRequestedAt as Date).getTime());
	if (asked.length) return asked[0].id;
	if (!pipeline.enabled) return null;
	return (
		rows.find((s) => s.enabled && !s.failing && (!s.nextRunAt || s.nextRunAt <= now))?.id ?? null
	);
}

/**
 * One run at a time, process-wide: runs queue behind each other instead of sharing the
 * event loop. ponytail: a slow registry download therefore delays every source behind it;
 * per-host limits would lift that if it ever hurts.
 */
let draining: Promise<void> | null = null;

export function kick(db: Db): void {
	if (draining) return;
	draining = (async () => {
		for (let id = pickDue(db); id; id = pickDue(db)) await runSource(db, id);
	})()
		.catch((err) => console.error("pipeline:", msg(err)))
		.finally(() => {
			draining = null;
			if (pickDue(db)) kick(db);
		});
}

/** Asks for runs at the next opportunity, which is now unless one is in flight. Returns how many sources were asked. */
export function requestRuns(db: Db, sourceIds: string[]): number {
	let asked = 0;
	for (const id of sourceIds) {
		const s = db.select().from(t.sources).where(eq(t.sources.id, id)).get();
		if (!s || claimFresh(s)) continue;
		if (!s.runRequestedAt)
			db.update(t.sources).set({ runRequestedAt: new Date() }).where(eq(t.sources.id, id)).run();
		asked += 1;
	}
	if (asked) kick(db);
	return asked;
}

export function sourcesOfArea(db: Db, areaId: string): string[] {
	return db
		.select({ id: t.sources.id })
		.from(t.areaSources)
		.innerJoin(t.sources, eq(t.sources.id, t.areaSources.sourceId))
		.innerJoin(t.areas, eq(t.areas.id, t.areaSources.areaId))
		.where(
			and(eq(t.areaSources.areaId, areaId), eq(t.sources.enabled, true), eq(t.areas.paused, false)),
		)
		.all()
		.map((r) => r.id);
}

declare global {
	var __osmReviewerPipelineTimer: ReturnType<typeof setInterval> | undefined;
}

/** Releases claims a dead process left, and starts the clock unless the pipeline is switched off. */
export function startPipeline(db: Db): void {
	db.update(t.sources).set({ runningSince: null }).run();
	if (!pipeline.enabled) return;
	// Dev reloads this module; a second timer would double every tick.
	if (globalThis.__osmReviewerPipelineTimer) clearInterval(globalThis.__osmReviewerPipelineTimer);
	globalThis.__osmReviewerPipelineTimer = setInterval(() => kick(db), TICK_MS);
	globalThis.__osmReviewerPipelineTimer.unref();
	setTimeout(() => kick(db), FIRST_TICK_MS).unref();
}
