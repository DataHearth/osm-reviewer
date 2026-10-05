import { SCHOOLS } from "../fr/kinds";
import {
	campus,
	groundsOf,
	kindWords,
	maternelleAs,
	otherPlace,
	properName,
	uaisOn,
} from "../fr/school";
import { ESTABLISHMENT_IDS, SIRET, SIRET_NAME, siretOf, UAI } from "../fr/tags";
import { fold } from "../fr/text";
import { distance, metres } from "../geo";
import { lookalike, sameKind, schoolBuilding } from "../tagfilter";
import { ids, nameSimilarity } from "../text";
import { type Extraction, type OsmElement, osmRef } from "../types";
import { evseTag, forTwoWheels, otherBorne, otherStation, stationFit } from "./charging";
import { notThePlace } from "./find";
import {
	companiesAgree,
	NAME_MATCH,
	nameScore,
	WHOLE_NAME,
	whoAgrees,
	whoOf,
	whoOn,
	whoSimilarity,
} from "./names";
import { MAIN, mainOf, type TagOp } from "./ops";
import { DUPLICATE_RADIUS_M, LAT_PREFILTER, MATCH_RADIUS_M, SPLIT_RADIUS_M } from "./radii";
import { refHits, SITE_REFS } from "./refs";
import { sameValue } from "./values";

const NEARBY_RADIUS_M = 300;

const label = (e: OsmElement, d: number) =>
	`${osmRef(e)}${e.tags.name ? ` “${e.tags.name}”` : ""}, ${Math.round(d)} m away`;

/** Farther than this, a place with the same operator or address is still likely the record's. */
const SAME_OPERATOR_RADIUS_M = 300;

const tagsOf = (x: Pick<Extraction, "tags">) => Object.fromEntries(x.tags.map((t) => [t.k, t.v]));

/** Housenumber and street, in whichever scheme the object holds them. */
function addressOf(tags: Record<string, string>): string | null {
	const n = tags["addr:housenumber"] ?? tags["contact:housenumber"];
	const street = tags["addr:street"] ?? tags["contact:street"];
	return n && street ? `${fold(n)} ${fold(street)}` : null;
}

export type Placed = Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name" | "from"> &
	Partial<Pick<Extraction, "key">>;

/** Each matched object's records in this run, by the object's OSM ref. */
export type MatchedBy = Map<string, Pick<Extraction, "key" | "name" | "tags" | "refs">[]>;

/** The run's other records matched to `e`. */
export const matchedElsewhere = (e: OsmElement, x: Placed, matchedBy: MatchedBy) =>
	(matchedBy.get(osmRef(e)) ?? []).filter((o) => o.key !== x.key);

/** Objects of the record's kind other than `el`, nearest to it (or to the record) first. */
function kinOf(x: Placed, el: OsmElement | null, els: OsmElement[]) {
	const main = mainOf(x);
	if (!main) return null;
	const from = el ?? x;
	const near = els
		.filter((e) => sameKind(main.k, main.v, e.tags) && (!el || osmRef(e) !== osmRef(el)))
		.filter((e) => !otherPlace(e, x.refs))
		.map((e) => ({ e, d: distance(from.lat, from.lon, e.lat, e.lon) }))
		.sort((a, b) => a.d - b.d);
	return { main, kin: near };
}

/**
 * The other objects the matched site is mapped as: same-kind neighbours, and whatever else
 * carries the record's own UAI or EVSE id however far off it is. A neighbour named for
 * something else (another school in the same building), or one another record of the run
 * matched, is not one of them. A neighbour's operator may agree with the matched object's
 * rather than the record's: the registry names the network's operator where mappers wrote
 * the borne maker's brand.
 */
export function splitParts(
	x: Placed,
	el: OsmElement,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]> = new Map(),
	shared: Set<string> = new Set(),
	matchedBy: MatchedBy = new Map(),
): { e: OsmElement; d: number }[] {
	const names = [x.name, el.tags.name].filter(Boolean);
	const open = x.tags.find((t) => t.k === "access")?.v === "yes";
	const samePlace = (e: OsmElement) => {
		if (e.tags.name && !names.some((n) => nameSimilarity(n, e.tags.name) >= NAME_MATCH))
			return false;
		if (
			otherStation(e, x.refs) ||
			otherBorne(el, e) ||
			forTwoWheels(x, e) ||
			matchedElsewhere(e, x, matchedBy).length
		)
			return false;
		const who = whoSimilarity(x, e);
		const asMapped = companiesAgree(whoOn(el.tags), whoOn(e.tags));
		if (who !== null && who < NAME_MATCH && (asMapped ?? 0) < NAME_MATCH) return false;
		return !(open && /^(private|no|customers)$/.test(e.tags.access ?? ""));
	};
	const near = (kinOf(x, el, els)?.kin ?? []).filter(
		(k) => k.d <= SPLIT_RADIUS_M && samePlace(k.e),
	);
	const byRef = refHits(x, refIndex, shared, SITE_REFS)
		.filter(({ e }) => osmRef(e) !== osmRef(el) && !near.some((k) => k.e === e))
		.filter(({ e }) => !matchedElsewhere(e, x, matchedBy).length && !notThePlace(e, mainOf(x)))
		.map(({ e }) => ({ e, d: distance(el.lat, el.lon, e.lat, e.lon) }));
	return [...near, ...byRef].sort((a, b) => a.d - b.d);
}

/**
 * What a "new" record may already be mapped as: the nearest object of its kind, and the
 * nearest one mapped as something it may have been taken for (a charge point, a car park
 * with chargers, a bare school building), each within 150 m, or 300 m when run by the same
 * operator or at the same address.
 */
function duplicates(
	x: Placed,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
	matchedBy: MatchedBy,
	listed?: Set<string>,
): string[] {
	const main = mainOf(x);
	if (!main) return [];
	const stale = retiredHolders(x, null, refIndex, shared);
	const at = addressOf(tagsOf(x));
	const reach = (e: OsmElement, d: number) =>
		d <= DUPLICATE_RADIUS_M ||
		(d <= SAME_OPERATOR_RADIUS_M && (whoAgrees(x, e) || (!!at && addressOf(e.tags) === at)));
	// A record moved to its address may be mapped where the source placed it.
	const points = [x, ...(x.from ? [x.from] : [])];
	// Another station's id makes an object the less likely duplicate, and a station's other kind
	// of station nearer (its DC units beside its AC bays) is not the one to name either.
	const theirs = (e: OsmElement) => (otherStation(e, x.refs) ? 1 : 0);
	const misfit = (e: OsmElement) => (stationFit(x, e)?.types ? 1 : 0);
	const nearest = (kind: (e: OsmElement) => boolean) =>
		els
			.filter((e) => kind(e) && !otherPlace(e, x.refs))
			.map((e) => ({ e, d: Math.min(...points.map((p) => distance(p.lat, p.lon, e.lat, e.lon))) }))
			.filter(({ e, d }) => reach(e, d))
			.sort((a, b) => theirs(a.e) - theirs(b.e) || misfit(a.e) - misfit(b.e) || a.d - b.d)[0];
	const ofKind = (e: OsmElement) => sameKind(main.k, main.v, e.tags);
	const kin = nearest(ofKind);
	const alike = nearest(
		(e) => lookalike(main.k, main.v, e.tags) && !ofKind(e) && maternelleAs(x, e),
	);
	const out = [kin, alike]
		.filter((n) => n !== undefined)
		.map(({ e, d }) => {
			const k = [...MAIN, "man_made", "building"].find((key) => e.tags[key]) ?? main.k;
			const id = theirs(e) ? ` (carries ${evseTag(e)}, another station's)` : "";
			// The rest of a site mapped as several objects; one with another station's id beside
			// an id-less one is that other station.
			const more =
				e === kin?.e
					? els.filter(
							(o) =>
								o !== e &&
								ofKind(o) &&
								theirs(o) === theirs(e) &&
								distance(e.lat, e.lon, o.lat, o.lon) <= SPLIT_RADIUS_M,
						).length
					: 0;
			const site = more
				? `, and ${more} more object${more === 1 ? "" : "s"} of its kind within ${SPLIT_RADIUS_M} m of it`
				: "";
			return `Possible duplicate: ${k}=${e.tags[k]} already mapped at ${label(e, d)}${id}${site}`;
		});
	const sibling = siblingOf(x, els, matchedBy);
	if (sibling) out.push(sibling);
	return [...out, ...stale, ...unlisted(x, points, els, listed)];
}

/** Objects other than `el` carrying the record's id that are no longer the place. */
function retiredHolders(
	x: Placed,
	el: OsmElement | null,
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
): string[] {
	const main = mainOf(x);
	return refHits(x, refIndex, shared).flatMap(({ e, d }) => {
		const why = e !== el && notThePlace(e, main);
		return why
			? [`${label(e, d)} carries this record's id, but ${why}: check where the place is now`]
			: [];
	});
}

/**
 * How near a "new" school an object of its kind carrying a UAI the directory no longer lists
 * is named: Lyon's Olympe de Gouges maternelle stands 13 m from the record it may have become.
 */
const UNLISTED_REACH_M = 50;

/**
 * Objects of the record's kind beside it whose UAI the source's whole read does not list:
 * the place before a new UAI, or one closed since. Never the match, since the id is not the
 * record's; the reviewer decides.
 */
function unlisted(
	x: Placed,
	points: Pick<Extraction, "lat" | "lon">[],
	els: OsmElement[],
	listed?: Set<string>,
): string[] {
	const main = mainOf(x);
	if (!listed || !main || !x.refs[UAI]) return [];
	return els
		.filter((e) => sameKind(main.k, main.v, e.tags))
		.map((e) => ({
			e,
			uais: [...new Set(uaisOn(e))],
			d: Math.min(...points.map((p) => distance(p.lat, p.lon, e.lat, e.lon))),
		}))
		.filter(
			({ uais, d }) =>
				d <= UNLISTED_REACH_M && uais.length > 0 && !uais.some((id) => listed.has(id)),
		)
		.sort((a, b) => a.d - b.d)
		.map(
			({ e, uais, d }) =>
				`${osmRef(e)}${e.tags.name ? ` “${e.tags.name}”` : ""} ${Math.round(d)} m away carries UAI ${uais.join(", ")}, which the directory no longer lists`,
		);
}

const contactOf = (tags: Record<string, string>) =>
	[
		...["phone", "contact:phone"].map((k) => tags[k]?.replace(/\D/g, "").slice(-9)),
		...["email", "contact:email"].map((k) => tags[k]?.toLowerCase()),
	].filter((v): v is string => !!v);

/**
 * An object carrying another establishment's id is never the match, but one at the record's
 * address, reached by its phone or email, or run under its SIRET may be this place under a
 * stale id, or its sister school on one site: the reviewer has to see it. What the run's
 * records matched to that object say counts as the object's own.
 */
function siblingOf(x: Placed, els: OsmElement[], matchedBy: MatchedBy): string | null {
	const ours = tagsOf(x);
	const at = addressOf(ours);
	const contact = new Set(contactOf(ours));
	const siret = siretOf(ours);
	const reason = (tags: Record<string, string>) =>
		at && addressOf(tags) === at
			? "the same address"
			: contactOf(tags).some((c) => contact.has(c))
				? "the same phone or email"
				: siret && siretOf(tags) === siret
					? `the same ${SIRET_NAME}`
					: null;
	const hit = els
		.filter((e) => otherPlace(e, x.refs))
		.map((e) => {
			const views = [e.tags, ...matchedElsewhere(e, x, matchedBy).map(tagsOf)];
			const why = views.map(reason).find(Boolean) ?? null;
			return { e, d: distance(x.lat, x.lon, e.lat, e.lon), why };
		})
		.filter((h) => h.why && h.d <= SAME_OPERATOR_RADIUS_M)
		.sort((a, b) => a.d - b.d)[0];
	if (!hit) return null;
	const id = hit.e.tags[UAI] ? ` (${UAI}=${hit.e.tags[UAI]})` : "";
	return `Another establishment${id} with ${hit.why} is mapped at ${label(hit.e, hit.d)}: check this is not it`;
}

/**
 * Farther than this from where the source and the address base both place the record, an
 * object carrying its id is the place before it moved, or carries a stale id: what it is may
 * still be right, where it is reached is not.
 */
const FAR_FROM_ADDRESS_M = 500;

export type Located = Pick<Extraction, "lat" | "lon"> &
	Partial<Pick<Extraction, "atAddress" | "onStreet" | "from">>;

/**
 * How far `el` lies from the record, when that is too far to give it the address. Either the
 * source's point or the base's (the housenumber, or the street when that is all it knows)
 * near the object is enough: the base can put a number at the far end of a long boulevard.
 */
export function farFromAddress(x: Located, el: OsmElement): number | null {
	const points = [x, x.from, x.atAddress, x.onStreet].filter((p) => p !== undefined);
	const d = Math.min(...points.map((p) => distance(p.lat, p.lon, el.lat, el.lon)));
	return d > FAR_FROM_ADDRESS_M ? d : null;
}

/** A point kept where the source puts it is worth a line when its housenumber is this far. */
const ADDRESS_AWAY_M = 100;

/**
 * Where a "new" record's housenumber lies, when the point stayed put far from it: a station's
 * precise point is never moved, and its address is often the site's postal one.
 */
function addressAway(x: Located & Partial<Pick<Extraction, "geocode">>): string[] {
	const to = x.atAddress;
	if (!to || !x.geocode || x.from) return [];
	const d = distance(x.lat, x.lon, to.lat, to.lon);
	// Short of the distance its preset moves a point from, it is near enough by the preset's own measure.
	const reach = Number.isFinite(x.geocode.farM) ? x.geocode.farM : 0;
	return d > Math.max(ADDRESS_AWAY_M, reach)
		? [`Its address, ${to.label}, is ${metres(d)} away`]
		: [];
}

/** What a reviewer must check before trusting this match, or this "new". */
export function matchWarnings(
	x: Placed & Located & Partial<Pick<Extraction, "geocode">>,
	el: OsmElement | null,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]> = new Map(),
	shared: Set<string> = new Set(),
	matchedBy: MatchedBy = new Map(),
	listed?: Set<string>,
): string[] {
	if (!el) return [...addressAway(x), ...duplicates(x, els, refIndex, shared, matchedBy, listed)];
	const out: string[] = [];
	const main = mainOf(x);
	const far = farFromAddress(x, el);
	const d = distance(x.lat, x.lon, el.lat, el.lon);
	// Matched far off, by its id most likely: what stands where the source puts it may be the place now.
	const here =
		d > DUPLICATE_RADIUS_M
			? (kinOf(x, null, els)?.kin ?? []).find(
					(k) => k.d <= MATCH_RADIUS_M && osmRef(k.e) !== osmRef(el),
				)
			: undefined;
	const standing = here
		? `; ${osmRef(here.e)}${here.e.tags.name ? ` “${here.e.tags.name}”` : ""} stands ${Math.round(here.d)} m from the source's point`
		: "";
	if (far)
		out.push(
			`Matched to ${osmRef(el)}${el.tags.name ? ` “${el.tags.name}”` : ""}, ${metres(far)} from where the source and the address base place it: the place may have moved, or the id on this object may be stale, so its address, contacts, ${SIRET_NAME} and opening date are left out${standing}`,
		);
	// A station matched on its counts, not its id, reaches past where an operator would.
	else if (
		d > DUPLICATE_RADIUS_M ||
		(d > MATCH_RADIUS_M &&
			!!stationFit(x, el) &&
			!refHits(x, refIndex, shared).some((h) => h.e === el))
	)
		out.push(
			`Matched to ${label(el, d)} from the source's point${standing}: check it is this place`,
		);
	for (const k of ESTABLISHMENT_IDS) {
		const ours = x.tags.find((t) => t.k === k)?.v;
		if (ours && el.tags[k] && !sameValue(k, ours, el.tags[k]))
			out.push(
				`OSM has ${k}=${el.tags[k]} where the source says ${ours}: left alone, since it may be another establishment's; check which is right`,
			);
	}
	if (!refHits(x, refIndex, shared).some((h) => h.e === el))
		out.push(...retiredHolders(x, el, refIndex, shared));
	if (otherStation(el, x.refs)) out.push(`OSM carries the operator's other id ${evseTag(el)}`);
	const gone = notThePlace(el, main);
	if (gone)
		out.push(
			`This object may no longer be the place: ${gone}${main && !el.tags[main.k] ? `, so ${main.k}=${main.v} is not added` : ""}. Check it before writing to it`,
		);
	const amenity = x.tags.find((t) => t.k === "amenity" && SCHOOLS.includes(t.v));
	const grounds = amenity ? groundsOf(x, el, els) : null;
	if (grounds)
		out.push(
			`OSM maps this school as building=${el.tags.building} beside ${label(grounds, distance(el.lat, el.lon, grounds.lat, grounds.lon))}, mapped as amenity=${grounds.tags.amenity}: amenity and name are left out, so the school is not mapped twice`,
		);
	else if (amenity && schoolBuilding(el.tags))
		out.push(
			`OSM maps this school only as building=${el.tags.building}: amenity=${amenity.v} is added to the building`,
		);
	const split = splitParts(x, el, els, refIndex, shared, matchedBy);
	// A school's UAI on an object well off this one is another site of it, or a stale copy: not
	// a part of this site.
	const ours = new Set(ids(x.refs[UAI] ?? ""));
	const apart = split.filter((k) => k.d > SPLIT_RADIUS_M && uaisOn(k.e).some((id) => ours.has(id)));
	const site = split.filter((k) => !apart.includes(k));
	if (site.length)
		out.push(
			`Same site may be mapped as ${site.length + 1} objects (also ${site.map((k) => label(k.e, k.d)).join("; ")}): what is written here would land on this one only`,
		);
	for (const k of apart) out.push(`Another object carrying this UAI is ${label(k.e, k.d)}`);
	const twin = namesake(x, el, els, split, matchedBy);
	if (twin && main)
		out.push(
			`Possible duplicate of this object: ${main.k}=${twin.e.tags[main.k]} is also mapped at ${label(twin.e, twin.d)}`,
		);
	return out;
}

/**
 * An object of the record's kind under the matched one's own name a little off it, too far to
 * be part of its site: the place may be mapped twice. So is one carrying no id under that name
 * spelt a little otherwise ("privé" for "privée", "Baptiste" for "Jean-Baptiste"), but a name
 * of another kind of school is a sister school ("École maternelle Jean Mermoz" beside the
 * élémentaire). A groupe scolaire around the school holds it rather than repeats it, unless it
 * stands at the record's own address or holds no other establishment.
 */
function namesake(
	x: Placed,
	el: OsmElement,
	els: OsmElement[],
	split: { e: OsmElement }[],
	matchedBy: MatchedBy,
): { e: OsmElement; d: number } | undefined {
	const ours = el.tags.name ?? x.name;
	const at = addressOf(tagsOf(x));
	const holdsOthers = (e: OsmElement) =>
		els.some(
			(o) =>
				otherPlace(o, x.refs) &&
				properName(o.tags.name ?? "") === properName(e.tags.name) &&
				distance(o.lat, o.lon, e.lat, e.lon) <= DUPLICATE_RADIUS_M,
		) ||
		[...matchedBy.values()]
			.flat()
			.some((o) => o.key !== x.key && properName(o.name) === properName(e.tags.name));
	const named = (e: OsmElement) => {
		if (campus(e.tags))
			return (
				!!properName(e.tags.name) &&
				properName(e.tags.name) === properName(ours) &&
				((!!at && addressOf(e.tags) === at) || !holdsOthers(e))
			);
		if (!el.tags.name) return (nameScore(x, e) ?? 0) >= WHOLE_NAME;
		return (
			fold(e.tags.name) === fold(el.tags.name) ||
			(!uaisOn(e).length &&
				nameSimilarity(e.tags.name, el.tags.name) >= WHOLE_NAME &&
				kindWords(e.tags.name) === kindWords(el.tags.name))
		);
	};
	return (kinOf(x, el, els)?.kin ?? []).find(
		({ e, d }) =>
			d > SPLIT_RADIUS_M &&
			d <= DUPLICATE_RADIUS_M &&
			!!e.tags.name &&
			named(e) &&
			!split.some((s) => s.e === e) &&
			!otherStation(e, x.refs) &&
			!matchedElsewhere(e, x, matchedBy).length,
	);
}

/** Two "new" records this close are likely one place the source lists twice. */
const TWIN_RADIUS_M = 10;

/**
 * As far apart as one car park's stations, or two files' points for one site, when the
 * operator or the name agrees. Two establishments' UAIs are two places however close.
 */
const LIKE_TWIN_RADIUS_M = 60;

function twinReason(a: Extraction, b: Extraction): string | null {
	if (Math.abs(a.lat - b.lat) < LAT_PREFILTER) {
		const d = distance(a.lat, a.lon, b.lat, b.lon);
		const alike =
			!(a.refs[UAI] && b.refs[UAI]) &&
			((companiesAgree(whoOf(a), whoOf(b)) ?? 0) >= NAME_MATCH ||
				nameSimilarity(a.name, b.name) >= NAME_MATCH);
		if (d <= TWIN_RADIUS_M || (alike && d <= LIKE_TWIN_RADIUS_M))
			return `lies ${Math.round(d)} m away`;
	}
	// However far apart: one of two files' points for a site can be off by a kilometre.
	if (
		a.addr &&
		fold(a.addr) === fold(b.addr) &&
		fold(a.name) === fold(b.name) &&
		(companiesAgree(whoOf(a), whoOf(b)) ?? 0) >= NAME_MATCH
	)
		return "has the same name, address and operator";
	const siret = a.refs[SIRET];
	if (siret && siret === b.refs[SIRET]) return `has the same ${SIRET_NAME}`;
	const at = addressOf(tagsOf(a));
	return at && at === addressOf(tagsOf(b)) ? "has the same address" : null;
}

/** For each "new" record, the other "new" records of the run it may be the same place as. */
export function twinWarnings(news: Extraction[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const say = (x: Extraction, other: Extraction, why: string) =>
		out.set(x.key, [
			...(out.get(x.key) ?? []),
			`Another new candidate, “${other.name}” (${other.key}), ${why}: the two may be one place`,
		]);
	for (const [i, a] of news.entries())
		for (const b of news.slice(i + 1)) {
			const why = twinReason(a, b);
			if (!why) continue;
			say(a, b, why);
			say(b, a, why);
		}
	return out;
}

/** A survey this recent is a mapper's word against the source's. */
const RECENT_SURVEY_MS = 365 * 86_400_000;

/** The latest `check_date`/`survey:date` on the object within the year, as DD-MM-YYYY. */
function recentSurvey(current: Record<string, string>, now: number): string | null {
	let latest: { at: number; shown: string } | null = null;
	for (const [k, v] of Object.entries(current)) {
		if (k !== "survey:date" && k !== "check_date" && !k.startsWith("check_date:")) continue;
		const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v.trim());
		if (!m) continue;
		const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
		if (now - at > RECENT_SURVEY_MS || (latest && latest.at >= at)) continue;
		latest = { at, shown: [m[3], m[2], m[1]].filter(Boolean).join("-") };
	}
	return latest?.shown ?? null;
}

/** A line for every mapper's value the candidate would overwrite. */
export function modWarnings(
	ops: TagOp[],
	current: Record<string, string>,
	now = Date.now(),
): string[] {
	const surveyed = recentSurvey(current, now);
	const why = surveyed
		? `, and a mapper checked this object on ${surveyed}`
		: "; a mapper may have set it on purpose";
	const lines = ops
		.filter((o) => o.op === "mod")
		.map((o) => `OSM has ${o.k}=${o.was} where the source says ${o.v}${why}`);
	return lines;
}

export function nearbyLabels(
	at: { lat: number; lon: number },
	els: OsmElement[],
	exclude: OsmElement | null,
	limit = 3,
): string[] {
	return els
		.filter((e) => !exclude || osmRef(e) !== osmRef(exclude))
		.map((e) => ({ e, d: distance(at.lat, at.lon, e.lat, e.lon) }))
		.filter((x) => x.d <= NEARBY_RADIUS_M)
		.sort((a, b) => a.d - b.d)
		.slice(0, limit)
		.map(({ e, d }) => {
			const main = MAIN.find((k) => e.tags[k]);
			return [`${Math.round(d)} m`, main ? `${main}=${e.tags[main]}` : "", e.tags.name ?? ""]
				.filter(Boolean)
				.join("  ");
		});
}
