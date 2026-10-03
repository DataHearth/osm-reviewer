import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { comma, daysSince, fmtDate, STALE_AFTER_DAYS, stamp } from "$lib/format";
import { llm } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { configRows, KIND_LABEL, metricRows, runRow } from "$lib/server/source-display";
import type {
	Area,
	Candidate,
	Changeset,
	Counts,
	Decision,
	ScopeArea,
	Source,
	Staged,
	Tag,
} from "$lib/types";

/** How much of the queue one screen holds; the rest is counted, not fetched. */
const QUEUE_PAGE = 50;

/** Accepted decisions newer than this count toward an area's "accepted, 30 d". */
const RECENT_DAYS = 30;

/** Candidates a source brought to an area, and the share reviewers accepted (null while none is decided). */
export type Yields = Record<string, [number, number | null]>;

const n = sql<number>`count(*)`.mapWith(Number);

/** Per area: what the pipeline queued, and what reviewers have decided of it. */
async function areaTallies(db: Db) {
	const since = Math.floor((Date.now() - RECENT_DAYS * 86_400_000) / 1000);
	const [queued, decided] = await Promise.all([
		db.select({ areaId: t.candidates.areaId, n }).from(t.candidates).groupBy(t.candidates.areaId),
		db
			.select({
				areaId: t.candidates.areaId,
				n,
				recent:
					sql<number>`coalesce(sum(${t.decisions.kind} = 'accepted' and ${t.decisions.decidedAt} >= ${since}), 0)`.mapWith(
						Number,
					),
			})
			.from(t.decisions)
			.innerJoin(t.candidates, eq(t.decisions.candidateId, t.candidates.id))
			.groupBy(t.candidates.areaId),
	]);
	const queuedBy = new Map(queued.map((q) => [q.areaId, q.n]));
	const decidedBy = new Map(decided.map((d) => [d.areaId, d]));
	return (areaId: string) => {
		const total = queuedBy.get(areaId) ?? 0;
		const done = decidedBy.get(areaId);
		return {
			total,
			pending: Math.max(0, total - (done?.n ?? 0)),
			accepted30: done?.recent ?? 0,
		};
	};
}

/** The area's own state in the words the screens use. */
const areaStatus = (a: { paused: boolean; lastRunAt: Date | null }) =>
	a.paused ? "paused" : a.lastRunAt ? "active" : "first run queued";
const areaLastRun = (a: { lastRunAt: Date | null }) => (a.lastRunAt ? stamp(a.lastRunAt) : "never");

export async function loadSources(db: Db, now: Date = new Date()): Promise<Source[]> {
	const [rows, reviewed, evidence, links] = await Promise.all([
		db.query.sources.findMany({
			with: {
				allowedTags: { orderBy: (x) => asc(x.position) },
				runs: { orderBy: (x) => desc(x.startedAt) },
			},
			orderBy: (x) => asc(x.id),
		}),
		db
			.select({
				sourceId: t.candidates.sourceId,
				n,
				accepted: sql<number>`coalesce(sum(${t.decisions.kind} = 'accepted'), 0)`.mapWith(Number),
			})
			.from(t.decisions)
			.innerJoin(t.candidates, eq(t.decisions.candidateId, t.candidates.id))
			.groupBy(t.candidates.sourceId),
		db
			.select({
				sourceId: t.candidates.sourceId,
				n,
				bare: sql<number>`coalesce(sum(${t.evidence.id} is null), 0)`.mapWith(Number),
			})
			.from(t.tags)
			.innerJoin(t.candidates, eq(t.tags.candidateId, t.candidates.id))
			.leftJoin(t.evidence, eq(t.evidence.tagId, t.tags.id))
			.groupBy(t.candidates.sourceId),
		db
			.select({ sourceId: t.areaSources.sourceId, n })
			.from(t.areaSources)
			.groupBy(t.areaSources.sourceId),
	]);
	const reviewedBy = new Map(reviewed.map((r) => [r.sourceId, r]));
	const evidenceBy = new Map(evidence.map((r) => [r.sourceId, r]));
	const linksBy = new Map(links.map((r) => [r.sourceId, r.n]));
	const model = llm.provider && llm.model ? `${llm.model} · ${llm.provider}` : null;

	return rows.map((s) => {
		const last = s.runs[0];
		const done = reviewedBy.get(s.id);
		const tagged = evidenceBy.get(s.id);
		return {
			id: s.id,
			name: s.name,
			kind: s.kind,
			kindLabel: KIND_LABEL[s.kind],
			health: s.health,
			failing: s.failing,
			enabled: s.enabled,
			floor: s.floor,
			endpoint: s.endpoint,
			schedule: s.schedule,
			matching: s.matching,
			budget: s.budget,
			extractor: s.extractor,
			licence: s.licence,
			allow: s.allowedTags.map((a) => a.pattern),
			config: configRows(s, last, model),
			metrics: metricRows({
				areas: linksBy.get(s.id) ?? 0,
				last,
				reviewed: done?.n ?? 0,
				accepted: done?.accepted ?? 0,
				tags: tagged?.n ?? 0,
				unevidenced: tagged?.bare ?? 0,
			}),
			runs: s.runs.map((r) => runRow(r, s.kind)),
		};
	});
}

export async function loadAreas(db: Db): Promise<{ areas: Area[]; yields: Yields }> {
	const [rows, tally, perLink] = await Promise.all([
		db.query.areas.findMany({ with: { sources: true }, orderBy: (x) => asc(x.id) }),
		areaTallies(db),
		db
			.select({
				sourceId: t.candidates.sourceId,
				areaId: t.candidates.areaId,
				n,
				decided: sql<number>`count(${t.decisions.candidateId})`.mapWith(Number),
				accepted: sql<number>`coalesce(sum(${t.decisions.kind} = 'accepted'), 0)`.mapWith(Number),
			})
			.from(t.candidates)
			.leftJoin(t.decisions, eq(t.decisions.candidateId, t.candidates.id))
			.groupBy(t.candidates.sourceId, t.candidates.areaId),
	]);

	const yields: Yields = {};
	for (const l of perLink) {
		yields[`${l.sourceId}:${l.areaId}`] = [l.n, l.decided > 0 ? l.accepted / l.decided : null];
	}

	const areas = rows.map((a) => ({
		id: a.id,
		name: a.name,
		def: a.def,
		rel: a.rel ?? undefined,
		level: a.level ?? undefined,
		displayName: a.displayName ?? undefined,
		bbox: a.bbox ?? undefined,
		center: [a.centerLat, a.centerLon] as [number, number],
		km: a.km ?? undefined,
		radius: a.radius ?? undefined,
		sqkm: a.sqkm,
		pending: tally(a.id).pending,
		pois: a.pois === null ? "—" : comma(a.pois),
		accepted30: tally(a.id).accepted30,
		status: areaStatus(a),
		lastRun: areaLastRun(a),
		sources: a.sources.map((s) => s.sourceId),
	}));

	return { areas, yields };
}

/** The queue is the scoped area's, or every area's when the scope is null. */
export async function loadQueue(
	db: Db,
	scope: string | null,
): Promise<{
	candidates: Candidate[];
	decided: Record<string, Decision>;
}> {
	const rows = await db.query.candidates.findMany({
		with: {
			tags: {
				orderBy: (x) => asc(x.position),
				with: { evidence: { with: { parts: { orderBy: (x) => asc(x.position) } } } },
			},
			nearby: { orderBy: (x) => asc(x.position) },
			conflictTags: { orderBy: (x) => asc(x.position) },
			decision: true,
		},
		where: scope ? (x) => eq(x.areaId, scope) : undefined,
		orderBy: (x) => [asc(x.areaId), desc(x.conf)],
		limit: QUEUE_PAGE,
	});

	const decided: Record<string, Decision> = {};
	const candidates = rows.map((c) => {
		if (c.decision) decided[c.id] = c.decision.kind;
		const tags: Tag[] = c.tags.map((tag) => ({
			op: tag.op,
			k: tag.k,
			v: tag.v,
			was: tag.was ?? undefined,
			conf: tag.conf,
			invalid: tag.invalid,
			invalidMsg: tag.invalidMsg ?? undefined,
			invalidHint: tag.invalidHint ?? undefined,
			ev: tag.evidence
				? {
						parts: tag.evidence.parts.map((p) => ({ text: p.text, mark: p.mark })),
						path: tag.evidence.path,
						url: tag.evidence.url,
						when: tag.evidence.when,
						kind: tag.evidence.kind,
						conf: tag.evidence.conf,
					}
				: null,
		}));
		const side = (which: "theirs" | "ours") =>
			c.conflictTags.filter((x) => x.side === which).map((x) => ({ k: x.k, v: x.v }));

		return {
			id: c.id,
			osmId: c.osmId,
			type: c.type,
			name: c.name,
			addr: c.addr,
			lat: c.lat,
			lon: c.lon,
			source: c.sourceId,
			conf: c.conf,
			version: c.version,
			fetched: fmtDate(c.fetchedAt),
			age: daysSince(c.fetchedAt) + "d",
			stale: daysSince(c.fetchedAt) >= STALE_AFTER_DAYS ? daysSince(c.fetchedAt) : undefined,
			conflict: c.headVersion !== null,
			baseVersion: c.baseVersion ?? undefined,
			headVersion: c.headVersion ?? undefined,
			conflictWho: c.conflictWho ?? undefined,
			theirs: side("theirs"),
			ours: side("ours"),
			nearby: c.nearby.map((n) => n.label),
			unchanged: c.unchangedTags.map((x) => `${x.k}=${x.v}`).join("  ") || "—",
			tags,
			allQuarantined: tags.every((tag) => !tag.ev),
			hasNoEv: tags.some((tag) => !tag.ev),
			hasInvalid: tags.some((tag) => tag.invalid),
		} satisfies Candidate;
	});

	return { candidates, decided };
}

export async function loadStaged(db: Db): Promise<Staged[]> {
	const rows = await db.query.decisions.findMany({
		where: (d) => and(eq(d.kind, "accepted"), isNull(d.changesetId)),
		with: { candidate: { with: { tags: { orderBy: (x) => asc(x.position) } } }, tags: true },
		orderBy: (d) => asc(d.decidedAt),
	});

	return rows.map((d) => {
		const picked = new Set(d.tags.map((x) => x.tagId));
		return {
			id: d.candidateId,
			osmId: d.candidate.osmId,
			name: d.candidate.name,
			type: d.candidate.type,
			tags: d.candidate.tags
				.filter((tag) => picked.has(tag.id))
				.map((tag) => ({
					op: tag.op,
					k: tag.k,
					v: tag.v,
					was: tag.was ?? undefined,
					conf: tag.conf,
					ev: null,
				})),
		};
	});
}

/** Every area the top bar's picker offers, most waiting first. */
async function loadScopeAreas(db: Db): Promise<(ScopeArea & { queued: number })[]> {
	const [rows, tally] = await Promise.all([
		db.query.areas.findMany({ with: { sources: true } }),
		areaTallies(db),
	]);

	return rows
		.map((a) => ({
			id: a.id,
			name: a.name,
			def: a.def,
			radius: a.radius ?? undefined,
			status: areaStatus(a),
			lastRun: areaLastRun(a),
			sources: a.sources.length,
			queued: tally(a.id).total,
			pending: tally(a.id).pending,
		}))
		.sort((x, y) => y.pending - x.pending);
}

/**
 * Pending and staged, which the top bar and the phone nav show on every screen, for the
 * area the session reviews. `wanted` is the `scope` cookie the picker sets — an area id,
 * or "all". Without one, or naming an area since removed, the scope is the area with the
 * most waiting, which is where the pipeline has filled the queue.
 */
export async function loadCounts(db: Db, wanted: string | undefined): Promise<Counts> {
	const all = await loadScopeAreas(db);
	const scope =
		wanted === "all" ? null : ((all.find((a) => a.id === wanted) ?? all[0])?.id ?? null);
	const inScope = scope ? all.filter((a) => a.id === scope) : all;
	const [staged] = await db
		.select({ n: sql<number>`count(*)`.mapWith(Number) })
		.from(t.decisions)
		.where(and(eq(t.decisions.kind, "accepted"), isNull(t.decisions.changesetId)));

	return {
		pending: inScope.reduce((n, a) => n + a.pending, 0),
		staged: staged.n,
		total: inScope.reduce((n, a) => n + a.queued, 0),
		scope,
		areas: all.map(({ queued: _queued, ...a }) => a),
	};
}

export async function loadChangesets(db: Db): Promise<Changeset[]> {
	const rows = await db.query.changesets.findMany({ orderBy: (x) => desc(x.uploadedAt) });
	return rows.map((h) => ({
		id: h.osmId ?? "—",
		url: h.url,
		when: stamp(h.uploadedAt),
		comment: h.comment,
		objects: h.objects,
		result: h.result,
	}));
}
