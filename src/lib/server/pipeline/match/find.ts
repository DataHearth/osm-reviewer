import { distance, distanceTo, latGap, metres } from "../geo";
import { lookalike, shell } from "../tagfilter";
import { type Extraction, type OsmElement, osmRef } from "../types";
import { shown } from "./describe";
import { groundsOf } from "./grounds";
import { kit, mainKeys, wordsOf } from "./kinds";
import { companiesAgree, NAME_MATCH, nameScore, whoOf, whoSimilarity } from "./names";
import { type Main, mainOf, RETIRED } from "./ops";
import { DUPLICATE_RADIUS_M, latDegrees, MATCH_RADIUS_M, REACH_M } from "./radii";
import { refHits, rulesOut } from "./refs";

/** With a name missing on either side only a near-coincident point is trusted. */
const BARE_RADIUS_M = 15;

/** A name this close to the record's is the place even as far off as a directory puts it. */
const STRONG_NAME = 0.6;

export type Findable = Pick<Extraction, "lat" | "lon" | "name" | "refs"> &
	Partial<Pick<Extraction, "tags" | "addr" | "absent" | "fit" | "kind">>;

/**
 * Why an object is no longer the place the record describes, though it may carry its id: it
 * closed (`disused:amenity`), lost its name (`was:name`), became something else
 * (`office=company`), or is being built (`landuse=construction`, an `opening_date` to come).
 * A stale id on it settles nothing.
 */
export function notThePlace(e: OsmElement, main?: Main, now = Date.now()): string | null {
	const t = e.tags;
	const keys = mainKeys();
	const live = keys.filter((k) => t[k]);
	const retired = keys.flatMap((k) => RETIRED.map((p) => `${p}:${k}`)).find((k) => t[k]);
	if (!live.length && retired) return `it is mapped as ${retired}=${t[retired]}`;
	if (t["was:name"] && !t.name) return `its name was removed (was:name=${t["was:name"]})`;
	const opening = Date.parse(t.opening_date ?? "");
	if (
		t.landuse === "construction" ||
		t.building === "construction" ||
		t.construction ||
		opening > now
	)
		return `it is under construction${t.opening_date ? ` (opening_date=${t.opening_date})` : ""}`;
	// Another value of the same key (a college for an institute) is a mapper's reading of the
	// same place, as is a lookalike (an institute as its health centre); another key is not.
	if (main && live.length && !t[main.k] && !lookalike(main.k, main.v, t))
		return `it is now ${live[0]}=${t[live[0]]}`;
	return null;
}

/**
 * The object among several carrying the record's id side by side. A shell beside the grounds
 * is passed over unless it is all there is; the kit's `pick` ranks the rest, else the nearest.
 */
function bestHit(x: Findable, hits: { e: OsmElement; d: number }[]): OsmElement | null {
	const pool = hits.some((h) => !shell(h.e.tags)) ? hits.filter((h) => !shell(h.e.tags)) : hits;
	if (!pool.length) return null;
	return kit(x, "pick")?.(x, pool) ?? pool[0].e;
}

export function findMatch(
	x: Findable,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string> = new Set(),
	now = Date.now(),
): OsmElement | null {
	const main = mainOf(x);
	const hits = refHits(x, refIndex, shared).filter((h) => !notThePlace(h.e, main, now));
	const byRef = bestHit(x, hits);
	if (byRef) {
		// A shell carrying the record's id within the grounds mapped as that same place: the
		// grounds are the place, and the building only one of its blocks.
		const grounds = groundsOf(x, byRef, els);
		const own = kit(x, "ownGrounds");
		return grounds && (!own || own(x, grounds, els)) ? grounds : byRef;
	}
	const reachDeg = latDegrees(REACH_M);
	const excludes = kit(x, "excludes");
	const fitOf = kit(x, "fit");
	const certain = kit(x, "certain");

	let best: { el: OsmElement; score: number } | null = null;
	for (const e of els) {
		if (rulesOut(e, x.refs, "hard") || excludes?.(x, e)) continue;
		if (latGap(x.lat, e) > reachDeg) continue;
		// What its id cannot make the place, its name or position cannot either.
		if (notThePlace(e, main, now)) continue;
		const building = shell(e.tags);
		if (building && !e.tags.name) continue;
		const d = distance(x.lat, x.lon, e.lat, e.lon);
		const named = e.tags.name && x.name ? nameScore(x, e, wordsOf(x)) : null;
		// Most charging stations on OSM have no name, and the registry places them up to tens of
		// metres off; the operator agreeing is what lets one match beyond a coincident point,
		// though never as far as a name does: one operator runs every station in a town.
		const who = whoSimilarity(x, e);
		// A name that is only a brand ("Toulibeo") says who runs the place as well as an operator tag.
		const brand = named === null && e.tags.name ? companiesAgree(whoOf(x), [e.tags.name]) : null;
		const agree = Math.max(who ?? 0, brand ?? 0);
		const fits = fitOf?.(x, e) ?? null;
		const renumbered = rulesOut(e, x.refs, "soft");
		const edge = distanceTo(x.lat, x.lon, e);
		const { known, exact } = certain?.(x, e, { agree, edge, renumbered, fits }) ?? {
			known: false,
			exact: false,
		};
		if (renumbered && !known && !exact) continue;
		const sim = named ?? (agree >= NAME_MATCH ? agree : null);
		const strong = named !== null && named >= STRONG_NAME;
		if (d > (strong ? DUPLICATE_RADIUS_M : MATCH_RADIUS_M) && !exact) continue;
		const ok = known || exact || (sim === null ? d <= BARE_RADIUS_M : sim >= NAME_MATCH);
		if (!ok) continue;
		// On the operator's word alone a fast DC unit is not an AC station, nor the other way round.
		if (named === null && fits?.types) continue;
		// A named block inside grounds mapped as the place is not the place: the building
		// stands for it only when nothing mapped as one matches. Another operator's sign, or a
		// connector the source says the station lacks, speaks against an object as well.
		const against =
			(building ? 1 : 0) +
			(who !== null && agree < NAME_MATCH ? 0.3 : 0) +
			(x.absent ?? []).filter((k) => e.tags[k] !== undefined).length * 0.3;
		const base = known || exact ? Math.max(sim ?? 0, NAME_MATCH) : (sim ?? 0.4);
		const score = base - d / 1000 - against + (fits?.score ?? 0) * 0.05;
		if (!best || score > best.score) best = { el: e, score };
	}
	return best?.el ?? null;
}

/**
 * What a record whose point its preset never moves matches at its housenumber, when nothing
 * matches where it stands. The address is the weaker clue, so an object whose counts say it
 * is another of the site's stations is not taken from it. An update moves nothing on the map,
 * so the record keeps its own point.
 */
export function findAtAddress(
	x: Findable & Pick<Extraction, "geocode" | "atAddress">,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
): OsmElement | null {
	if (!x.atAddress || !x.geocode || Number.isFinite(x.geocode.farM)) return null;
	const el = findMatch({ ...x, ...x.atAddress }, els, refIndex, shared);
	return el && (kit(x, "fit")?.(x, el)?.score ?? 0) >= 0 ? el : null;
}

const postcodeOf = (s: string) => /\b\d{5}\b/.exec(s)?.[0];

/** The base asked again without the postcode can answer from a namesake street in another commune. */
const samePostcode = (q: string, label: string) =>
	!!postcodeOf(q) && postcodeOf(q) === postcodeOf(label);

/**
 * A source point farther from its own housenumber than the record allows moves there: a
 * directory geocoded on a CEDEX's sorting office, or a station placed to a couple of decimals,
 * would otherwise match whatever stands at the wrong spot, or nothing. Unless the point is
 * borne out where it stands: an object there matches it, and is not the same object found
 * from the address, standing nearer it. Past `wrongM` from a housenumber in its own postcode
 * the point is an error, and moves whatever stands there.
 */
export function settlePoints(
	xs: Extraction[],
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
): Extraction[] {
	return xs.map((x) => {
		const to = x.atAddress;
		if (!to || !x.geocode) return x;
		const d = distance(x.lat, x.lon, to.lat, to.lon);
		const wrong =
			d > (x.geocode.wrongM ?? Number.POSITIVE_INFINITY) && samePostcode(x.geocode.q, to.label);
		if (d <= x.geocode.farM && !wrong) return x;
		const here = wrong ? null : findMatch(x, els, refIndex, shared);
		if (here) {
			const there = findMatch({ ...x, lat: to.lat, lon: to.lon }, els, refIndex, shared);
			if (
				there !== here ||
				distance(to.lat, to.lon, here.lat, here.lon) >= distance(x.lat, x.lon, here.lat, here.lon)
			)
				return x;
		}
		return {
			...x,
			lat: to.lat,
			lon: to.lon,
			from: { lat: x.lat, lon: x.lon },
			notes: [...(x.notes ?? []), `Moved ${metres(d)} to its address, ${to.label}`],
		};
	});
}

const matchedById = (
	m: { x: Findable; el: OsmElement | null },
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
) => !!m.el && refHits(m.x, refIndex, shared).some((h) => h.e === m.el);

/**
 * The run's matches, with a record matched only by name or distance to an object another
 * record's own id is on made "new" instead: two stations side by side are two stations, and
 * the duplicate banner still names the object.
 */
export function yieldToIds<M extends { x: Findable; el: OsmElement | null }>(
	matched: M[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
): M[] {
	const byId = (m: M) => matchedById(m, refIndex, shared);
	const named = new Set(matched.filter(byId).map((m) => m.el && osmRef(m.el)));
	return matched.map((m) => (m.el && named.has(osmRef(m.el)) && !byId(m) ? { ...m, el: null } : m));
}

/**
 * Records matched to one object by name or distance alone, the one it fits best keeping it:
 * a car station and the two-wheeler station beside it are told apart by what they hold, and
 * the other is proposed as "new", with a line saying which record kept the object.
 */
export function yieldToFit<
	M extends {
		x: Findable & Pick<Extraction, "key"> & Partial<Pick<Extraction, "notes">>;
		el: OsmElement | null;
	},
>(matched: M[], refIndex: Map<string, OsmElement[]>, shared: Set<string>): M[] {
	const on = new Map<string, M[]>();
	for (const m of matched) if (m.el) on.set(osmRef(m.el), [...(on.get(osmRef(m.el)) ?? []), m]);
	const loses = new Map<M, M>();
	for (const [, ms] of on) {
		if (ms.length < 2 || ms.some((m) => matchedById(m, refIndex, shared))) continue;
		const scored = ms.map((m) => ({
			m,
			s: kit(m.x, "fit")?.(m.x, m.el as OsmElement)?.score ?? 0,
		}));
		const top = scored.reduce((a, b) => (b.s > a.s ? b : a));
		for (const { m, s } of scored) if (s < top.s) loses.set(m, top.m);
	}
	return matched.map((m) => {
		const winner = loses.get(m);
		if (!winner || !m.el) return m;
		const note = `${osmRef(m.el)} fits “${shown(winner.x)}” (${winner.x.key}) better, which keeps it`;
		return { ...m, el: null, x: { ...m.x, notes: [...(m.x.notes ?? []), note] } } as M;
	});
}
