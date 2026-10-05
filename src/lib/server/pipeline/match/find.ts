import { bestHit, groundsOf, otherPlace, ownGrounds } from "../fr/school";
import { distance, metres } from "../geo";
import { lookalike, schoolBuilding } from "../tagfilter";
import { type Extraction, type OsmElement, osmRef } from "../types";
import { fitScore, otherStation, renumberedPool, stationFit } from "./charging";
import { companiesAgree, NAME_MATCH, nameScore, whoOf, whoSimilarity } from "./names";
import { MAIN, type Main, mainOf, RETIRED } from "./ops";
import { DUPLICATE_RADIUS_M, LAT_PREFILTER, MATCH_RADIUS_M } from "./radii";
import { refHits } from "./refs";

/** With a name missing on either side only a near-coincident point is trusted. */
const BARE_RADIUS_M = 15;

/** A name this close to the record's is the place even as far off as a directory puts it. */
const STRONG_NAME = 0.6;

export type Findable = Pick<Extraction, "lat" | "lon" | "name" | "refs"> &
	Partial<Pick<Extraction, "tags" | "addr" | "absent">>;

/**
 * Why an object is no longer the place the record describes, though it may carry its id: it
 * closed (`disused:amenity`), lost its name (`was:name`), became something else
 * (`office=company`), or is being built (`landuse=construction`, an `opening_date` to come).
 * A stale id on it settles nothing.
 */
export function notThePlace(e: OsmElement, main?: Main, now = Date.now()): string | null {
	const t = e.tags;
	const live = MAIN.filter((k) => t[k]);
	const retired = MAIN.flatMap((k) => RETIRED.map((p) => `${p}:${k}`)).find((k) => t[k]);
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

/** Within this an object of the station's network with its connectors is the station, whatever its name or id says. */
const FIT_RADIUS_M = 25;

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
		// A school building carrying the UAI within the grounds mapped as that same school: the
		// grounds are the school, and the building only one of its blocks.
		const grounds = groundsOf(x, byRef, els);
		return grounds && ownGrounds(x, grounds, els) ? grounds : byRef;
	}

	let best: { el: OsmElement; score: number } | null = null;
	for (const e of els) {
		if (otherPlace(e, x.refs)) continue;
		if (Math.abs(e.lat - x.lat) > LAT_PREFILTER) continue;
		// What its id cannot make the place, its name or position cannot either.
		if (notThePlace(e, main, now)) continue;
		const building = schoolBuilding(e.tags);
		if (building && !e.tags.name) continue;
		const d = distance(x.lat, x.lon, e.lat, e.lon);
		const named = e.tags.name && x.name ? nameScore(x, e) : null;
		// Most charging stations on OSM have no name, and the registry places them up to tens of
		// metres off; the operator agreeing is what lets one match beyond a coincident point,
		// though never as far as a name does: one operator runs every station in a town.
		const who = whoSimilarity(x, e);
		// A name that is only a brand ("Toulibeo") says who runs the place as well as an operator tag.
		const brand = named === null && e.tags.name ? companiesAgree(whoOf(x), [e.tags.name]) : null;
		const agree = Math.max(who ?? 0, brand ?? 0);
		const fits = stationFit(x, e);
		// The network's own station a few metres off, with the record's connectors, is the
		// station even under a name the site has since lost or an id the network has since
		// renumbered. Another network's id still rules it out, and a record of the run carrying
		// the object's id takes it back (`yieldToIds`).
		const renumbered = otherStation(e, x.refs);
		const network = renumbered ? renumberedPool(e, x.refs) : agree >= NAME_MATCH;
		const known = d <= FIT_RADIUS_M && network && !!fits && fits.agree > 0 && fits.against === 0;
		if (renumbered && !known) continue;
		const sim = named ?? (agree >= NAME_MATCH ? agree : null);
		const strong = named !== null && named >= STRONG_NAME;
		if (d > (strong ? DUPLICATE_RADIUS_M : MATCH_RADIUS_M)) continue;
		const ok = known || (sim === null ? d <= BARE_RADIUS_M : sim >= NAME_MATCH);
		if (!ok) continue;
		// On the operator's word alone a fast DC unit is not an AC station, nor the other way round.
		if (named === null && fits?.types) continue;
		// A named block inside grounds mapped as the school is not the school: the building
		// stands for it only when nothing mapped as one matches. Another operator's sign, or a
		// connector the source says the station lacks, speaks against an object as well.
		const against =
			(building ? 1 : 0) +
			(who !== null && agree < NAME_MATCH ? 0.3 : 0) +
			(x.absent ?? []).filter((k) => e.tags[k] !== undefined).length * 0.3;
		const base = known ? Math.max(sim ?? 0, NAME_MATCH) : (sim ?? 0.4);
		const score = base - d / 1000 - against + fitScore(fits) * 0.05;
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
	return el && fitScore(stationFit(x, el)) >= 0 ? el : null;
}

/**
 * A source point farther from its own housenumber than the record allows moves there: a
 * directory geocoded on a CEDEX's sorting office, or a station placed to a couple of decimals,
 * would otherwise match whatever stands at the wrong spot, or nothing. Unless the point is
 * borne out where it stands: an object there matches it, and is not the same object found
 * from the address, standing nearer it.
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
		if (d <= x.geocode.farM) return x;
		const here = findMatch(x, els, refIndex, shared);
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
		const scored = ms.map((m) => ({ m, s: fitScore(stationFit(m.x, m.el as OsmElement)) }));
		const top = scored.reduce((a, b) => (b.s > a.s ? b : a));
		for (const { m, s } of scored) if (s < top.s) loses.set(m, top.m);
	}
	return matched.map((m) => {
		const winner = loses.get(m);
		if (!winner || !m.el) return m;
		const note = `${osmRef(m.el)} fits “${winner.x.name}” (${winner.x.key}) better, which keeps it`;
		return { ...m, el: null, x: { ...m.x, notes: [...(m.x.notes ?? []), note] } } as M;
	});
}
