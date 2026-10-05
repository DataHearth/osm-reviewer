import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	notExists,
	type SQL,
	sql,
} from "drizzle-orm";
import { sourceLabel } from "$lib/changeset";
import {
	CONF_HIGH,
	CONF_MID,
	comma,
	daysSince,
	fmtDate,
	STALE_AFTER_DAYS,
	stamp,
} from "$lib/format";
import type { QueueQuery, SortKey } from "$lib/schemas/queue";
import { llm } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { contextTags } from "$lib/server/pipeline/match/ops";
import { claimFresh } from "$lib/server/pipeline/runner";
import { configRows, KIND_LABEL, metricRows, runRow } from "$lib/server/source-display";
import type {
	Area,
	Candidate,
	Changeset,
	Counts,
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
const accepted = sql<number>`coalesce(sum(${t.decisions.kind} = 'accepted'), 0)`.mapWith(Number);

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
	a.paused ? "disabled" : a.lastRunAt ? "active" : "first run queued";
const areaLastRun = (a: { lastRunAt: Date | null }) => (a.lastRunAt ? stamp(a.lastRunAt) : "never");

export async function loadSources(db: Db): Promise<Source[]> {
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
				accepted,
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
			running: !!s.runRequestedAt || claimFresh(s),
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
				accepted,
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

const cand = t.candidates;
const tagsOf = (where?: SQL) => and(eq(t.tags.candidateId, cand.id), where);
const tagRows = (where?: SQL) => sql`select 1 from ${t.tags} where ${tagsOf(where)}`;
const evidencedTags = sql`select 1 from ${t.tags} inner join ${t.evidence} on ${eq(t.evidence.tagId, t.tags.id)} where ${tagsOf()}`;
const bareTags = sql`select 1 from ${t.tags} left join ${t.evidence} on ${eq(t.evidence.tagId, t.tags.id)} where ${tagsOf(isNull(t.evidence.id))}`;

/**
 * What each column sorts by, matching what the row shows. Flags rank a candidate by
 * its worst problem, in the order the flag chip picks the one it names. Age is the
 * reverse of the fetch time, so its direction is flipped where the order is built.
 */
const SORT_EXPR: Record<SortKey, () => SQL> = {
	type: () => sql`case ${cand.type} when 'new' then 0 when 'closure' then 1 else 2 end`,
	name: () => sql`lower(${cand.name})`,
	tags: () => sql`(select count(*) from ${t.tags} where ${tagsOf()})`,
	source: () => sql`${cand.sourceId}`,
	age: () => sql`${cand.fetchedAt}`,
	flags: () => {
		const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
		return sql`case
			when ${isNotNull(cand.headVersion)} then 5
			when exists (${tagRows(eq(t.tags.invalid, true))}) then 4
			when not exists (${evidencedTags}) then 3
			when exists (${bareTags}) then 2
			when ${lte(cand.fetchedAt, staleBefore)} then 1
			else 0 end`;
	},
	conf: () => sql`${cand.conf}`,
};

const CONF_RANGE: Record<QueueQuery["conf"], SQL | undefined> = {
	all: undefined,
	high: gte(cand.conf, CONF_HIGH),
	mid: and(gte(cand.conf, CONF_MID), lt(cand.conf, CONF_HIGH)),
	low: lt(cand.conf, CONF_MID),
};

export interface QueuePage {
	candidates: Candidate[];
	/** Every undecided candidate the filters let through, across all pages. */
	total: number;
	page: number;
	pages: number;
	/** How many matching rows come before this page. */
	offset: number;
	/** The view as asked for, with `page` clamped to the pages that exist. */
	query: QueueQuery;
}

/**
 * One page of the queue: the undecided candidates of the scoped area, or of every area
 * when the scope is null, filtered, sorted and paged by the view in the URL. A page past
 * the end clamps to the last one, so deciding the last row of a page never strands the
 * reviewer on an empty one.
 */
export async function loadQueue(
	db: Db,
	scope: string | null,
	query: QueueQuery,
	pageSize = QUEUE_PAGE,
): Promise<QueuePage> {
	const where = and(
		scope ? eq(cand.areaId, scope) : undefined,
		notExists(
			db.select({ one: sql`1` }).from(t.decisions).where(eq(t.decisions.candidateId, cand.id)),
		),
		query.type === "all" ? undefined : eq(cand.type, query.type),
		CONF_RANGE[query.conf],
	);
	const [{ total }] = await db.select({ total: n }).from(cand).where(where);
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(query.page, pages);
	const offset = (page - 1) * pageSize;

	const ascending = (query.sort === "age") !== (query.dir === "asc");
	const key = SORT_EXPR[query.sort]();
	const ids = (
		await db
			.select({ id: cand.id })
			.from(cand)
			.where(where)
			.orderBy(ascending ? asc(key) : desc(key), desc(cand.conf), asc(cand.id))
			.limit(pageSize)
			.offset(offset)
	).map((r) => r.id);

	const rows = ids.length
		? await db.query.candidates.findMany({
				columns: { record: false },
				with: CANDIDATE_WITH,
				where: (x) => inArray(x.id, ids),
			})
		: [];
	const at = new Map(ids.map((id, i) => [id, i]));
	rows.sort((x, y) => (at.get(x.id) ?? 0) - (at.get(y.id) ?? 0));

	return {
		candidates: rows.map(toCandidate),
		total,
		page,
		pages,
		offset,
		query: { ...query, page },
	};
}

/** One candidate by id, decided or not and whatever the scope: what a shared `/review?id=` link opens. */
export async function loadCandidate(db: Db, id: string): Promise<Candidate | null> {
	const row = await db.query.candidates.findFirst({
		columns: { record: false },
		with: { ...CANDIDATE_WITH, decision: { with: { user: { columns: { name: true } } } } },
		where: (x) => eq(x.id, id),
	});
	if (!row) return null;
	const d = row.decision;
	return {
		...toCandidate(row),
		decided: d ? { kind: d.kind, by: d.user.name, at: stamp(d.decidedAt) } : undefined,
	};
}

// A page is 50 candidates; the record is fetched for the one being read.
const CANDIDATE_WITH = {
	tags: {
		orderBy: (x, { asc }) => asc(x.position),
		with: { evidence: { with: { parts: { orderBy: (x, { asc }) => asc(x.position) } } } },
	},
	nearby: { orderBy: (x, { asc }) => asc(x.position) },
	conflictTags: { orderBy: (x, { asc }) => asc(x.position) },
} satisfies NonNullable<Parameters<Db["query"]["candidates"]["findMany"]>[0]>["with"];

type CandidateRow = Omit<typeof t.candidates.$inferSelect, "record"> & {
	tags: (typeof t.tags.$inferSelect & {
		evidence:
			| (typeof t.evidence.$inferSelect & { parts: (typeof t.evidenceParts.$inferSelect)[] })
			| null;
	})[];
	nearby: (typeof t.candidateNearby.$inferSelect)[];
	conflictTags: (typeof t.candidateConflictTags.$inferSelect)[];
};

function toCandidate(c: CandidateRow): Candidate {
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
		age: `${daysSince(c.fetchedAt)}d`,
		stale: daysSince(c.fetchedAt) >= STALE_AFTER_DAYS ? daysSince(c.fetchedAt) : undefined,
		conflict: c.headVersion !== null,
		baseVersion: c.baseVersion ?? undefined,
		headVersion: c.headVersion ?? undefined,
		conflictWho: c.conflictWho ?? undefined,
		theirs: side("theirs"),
		ours: side("ours"),
		nearby: c.nearby.map((n) => n.label),
		unchanged: contextTags(c.unchangedTags),
		tags,
		allQuarantined: tags.every((tag) => !tag.ev),
		hasNoEv: tags.some((tag) => !tag.ev),
		hasInvalid: tags.some((tag) => tag.invalid),
		warnings: c.warning ? c.warning.split("\n") : [],
	};
}

const stagedCount = async (db: Db) =>
	(await db.select({ n }).from(t.decisions).where(t.STAGED))[0].n;

const WITH_TAGS = {
	candidate: { with: { source: true } },
	tags: { orderBy: (x, { asc }) => asc(x.position) },
} satisfies NonNullable<Parameters<Db["query"]["decisions"]["findMany"]>[0]>["with"];

type DecisionRow = {
	candidateId: string;
	candidate: {
		osmId: string | null;
		name: string;
		type: Staged["type"];
		source: { name: string; licence: string | null };
	};
	tags: { op: Staged["tags"][number]["op"]; k: string; v: string }[];
};

const toStaged = (d: DecisionRow): Staged => ({
	id: d.candidateId,
	osmId: d.candidate.osmId,
	name: d.candidate.name,
	type: d.candidate.type,
	source: sourceLabel(d.candidate.source.name, d.candidate.source.licence),
	tags: d.tags.map((x) => ({ op: x.op, k: x.k, v: x.v })),
});

/**
 * One changeset's worth of the staged rows — the `cs`th batch of `size`, in upload
 * order — and the totals across all of them. A batch past the end clamps to the last,
 * so removing the last row of the last batch never strands the page.
 */
export async function loadStaged(db: Db, cs: number, size: number) {
	const [candidates, [{ writes }]] = await Promise.all([
		stagedCount(db),
		db
			.select({ writes: n })
			.from(t.decisionTags)
			.innerJoin(t.decisions, eq(t.decisions.candidateId, t.decisionTags.candidateId))
			.where(t.STAGED),
	]);
	const changesets = Math.max(1, Math.ceil(candidates / size));
	const page = Math.min(cs, changesets);
	const rows = await db.query.decisions.findMany({
		where: (d) => and(eq(d.kind, "accepted"), isNull(d.changesetId)),
		with: WITH_TAGS,
		orderBy: (d) => [asc(d.decidedAt), asc(d.candidateId)],
		limit: size,
		offset: (page - 1) * size,
	});

	return {
		rows: rows.map(toStaged),
		candidates,
		writes,
		changesets: candidates ? changesets : 0,
		cs: page,
	};
}

/**
 * Every area the top bar's picker offers, most waiting first. This runs on every navigation,
 * so it is three grouped reads and no more: `loadAreas` has the fuller tallies.
 */
async function loadScopeAreas(db: Db): Promise<(ScopeArea & { queued: number })[]> {
	const [rows, queued, links] = await Promise.all([
		db.select().from(t.areas),
		db
			.select({
				areaId: t.candidates.areaId,
				n,
				decided: sql<number>`count(${t.decisions.candidateId})`.mapWith(Number),
			})
			.from(t.candidates)
			.leftJoin(t.decisions, eq(t.decisions.candidateId, t.candidates.id))
			.groupBy(t.candidates.areaId),
		db
			.select({ areaId: t.areaSources.areaId, n })
			.from(t.areaSources)
			.groupBy(t.areaSources.areaId),
	]);
	const queuedBy = new Map(queued.map((r) => [r.areaId, r]));
	const linksBy = new Map(links.map((r) => [r.areaId, r.n]));

	return rows
		.map((a) => {
			const tally = queuedBy.get(a.id);
			return {
				id: a.id,
				name: a.name,
				def: a.def,
				radius: a.radius ?? undefined,
				status: areaStatus(a),
				lastRun: areaLastRun(a),
				sources: linksBy.get(a.id) ?? 0,
				queued: tally?.n ?? 0,
				pending: (tally?.n ?? 0) - (tally?.decided ?? 0),
			};
		})
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

	return {
		pending: inScope.reduce((n, a) => n + a.pending, 0),
		staged: await stagedCount(db),
		total: inScope.reduce((n, a) => n + a.queued, 0),
		scope,
		areas: all.map(({ queued: _queued, ...a }) => a),
	};
}

export async function loadChangesets(db: Db): Promise<(Changeset & { href: string })[]> {
	const rows = await db.query.changesets.findMany({ orderBy: (x) => desc(x.uploadedAt) });
	return rows.map((h) => ({
		id: h.osmId ?? "—",
		href: `/history/${h.id}`,
		url: h.url,
		when: stamp(h.uploadedAt),
		comment: h.comment,
		objects: h.objects,
		result: h.result,
	}));
}

/** One uploaded changeset and the objects it carried; a failed one carried none. */
export async function loadChangeset(db: Db, id: string) {
	const h = await db.query.changesets.findFirst({ where: (x) => eq(x.id, id) });
	if (!h) return null;
	const rows = await db.query.decisions.findMany({
		where: (d) => eq(d.changesetId, id),
		with: WITH_TAGS,
		orderBy: (d) => [asc(d.decidedAt), asc(d.candidateId)],
	});
	return {
		id: h.osmId ?? "—",
		url: h.url,
		when: stamp(h.uploadedAt),
		comment: h.comment,
		objects: h.objects,
		result: h.result,
		error: h.error,
		rows: rows.map(toStaged),
	};
}
