import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { fmtDate, stamp } from "$lib/format";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import type {
	Area,
	Candidate,
	Changeset,
	Counts,
	Decision,
	Rel,
	ScopeArea,
	Source,
	Staged,
	Tag,
} from "$lib/types";

/** How much of the queue one screen holds; the rest is counted, not fetched. */
const QUEUE_PAGE = 50;

export type Yields = Record<string, [number, number]>;

export async function loadSources(db: Db): Promise<Source[]> {
	const rows = await db.query.sources.findMany({
		with: {
			allowedTags: { orderBy: (x) => asc(x.position) },
			config: { orderBy: (x) => asc(x.position) },
			metrics: { orderBy: (x) => asc(x.position) },
			runs: { orderBy: (x) => desc(x.startedAt) },
		},
		orderBy: (x) => asc(x.id),
	});

	return rows.map((s) => ({
		id: s.id,
		name: s.name,
		kind: s.kind,
		kindLabel: s.kindLabel,
		health: s.health,
		failing: s.failing,
		enabled: s.enabled,
		floor: s.floor,
		allow: s.allowedTags.map((a) => a.pattern),
		config: s.config.map((c) => (c.tone ? [c.label, c.value, c.tone] : [c.label, c.value])),
		metrics: s.metrics.map((m) => [m.label, m.value, m.note ?? undefined, m.tone ?? undefined]),
		runs: s.runs.map((r) => ({
			when: stamp(r.startedAt),
			dur: r.dur,
			fetched: r.fetched,
			cands: r.cands,
			errors: r.errors,
			result: r.result,
		})),
	}));
}

export async function loadAreas(db: Db): Promise<{ areas: Area[]; yields: Yields }> {
	const rows = await db.query.areas.findMany({
		with: { sources: true },
		orderBy: (x) => asc(x.id),
	});

	const yields: Yields = {};
	for (const a of rows) {
		for (const link of a.sources) {
			if (link.candidateCount === null || link.acceptRate === null) continue;
			yields[`${link.sourceId}:${a.id}`] = [link.candidateCount, link.acceptRate];
		}
	}

	const areas = rows.map((a) => ({
		id: a.id,
		name: a.name,
		def: a.def,
		rel: a.rel ?? undefined,
		level: a.level ?? undefined,
		center: [a.centerLat, a.centerLon] as [number, number],
		km: a.km ?? undefined,
		radius: a.radius ?? undefined,
		sqkm: a.sqkm,
		pending: a.pending,
		pois: a.pois,
		accepted30: a.accepted30,
		status: a.status,
		lastRun: a.lastRun,
		sources: a.sources.map((s) => s.sourceId),
	}));

	return { areas, yields };
}

export async function loadRels(db: Db): Promise<Rel[]> {
	const rows = await db.query.rels.findMany({ orderBy: (x) => asc(x.name) });
	return rows.map((r) => ({
		name: r.name,
		rel: r.rel,
		meta: r.meta,
		center: [r.centerLat, r.centerLon] as [number, number],
		km: r.km,
		sqkm: r.sqkm,
		pois: r.pois,
		est: r.est,
	}));
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
			age: c.age,
			stale: c.stale ?? undefined,
			conflict: c.headVersion !== null,
			baseVersion: c.baseVersion ?? undefined,
			headVersion: c.headVersion ?? undefined,
			conflictWho: c.conflictWho ?? undefined,
			theirs: side("theirs"),
			ours: side("ours"),
			nearby: c.nearby.map((n) => n.label),
			unchanged: c.unchanged,
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

/**
 * Every area the top bar's picker offers, most waiting first. `areas.pending` is what
 * the pipeline queued; decisions taken since are subtracted per area.
 */
async function loadScopeAreas(db: Db): Promise<(ScopeArea & { queued: number })[]> {
	const [rows, done] = await Promise.all([
		db.query.areas.findMany({ with: { sources: true } }),
		db
			.select({ areaId: t.candidates.areaId, n: sql<number>`count(*)`.mapWith(Number) })
			.from(t.decisions)
			.innerJoin(t.candidates, eq(t.decisions.candidateId, t.candidates.id))
			.groupBy(t.candidates.areaId),
	]);
	const decided = new Map(done.map((d) => [d.areaId, d.n]));

	return rows
		.map((a) => ({
			id: a.id,
			name: a.name,
			def: a.def,
			radius: a.radius ?? undefined,
			status: a.status,
			lastRun: a.lastRun,
			sources: a.sources.length,
			queued: a.pending,
			pending: Math.max(0, a.pending - (decided.get(a.id) ?? 0)),
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
