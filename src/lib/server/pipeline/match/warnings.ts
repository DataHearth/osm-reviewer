import { fold } from "../fr/text";
import { distance, metres } from "../geo";
import { lookalike, lookalikeKey, sameKind } from "../tagfilter";
import { nameSimilarity } from "../text";
import { type Extraction, type OsmElement, osmRef } from "../types";
import {
	addressOf,
	label,
	type MatchedBy,
	matchedElsewhere,
	type Placed,
	shown,
	tagsOf,
} from "./describe";
import { notThePlace } from "./find";
import { groundsOf } from "./grounds";
import { kit, labelKeys, lookalikeHook, mainKeys, registry, wordsOf } from "./kinds";
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
import { ADDRESS_KEY, CONTACT, mainOf, type TagOp } from "./ops";
import {
	DUPLICATE_RADIUS_M,
	latDegrees,
	MATCH_RADIUS_M,
	SAME_OPERATOR_RADIUS_M,
	SPLIT_RADIUS_M,
} from "./radii";
import {
	carriesHard,
	hardKeys,
	neverReplaceKeys,
	organisations,
	refHits,
	rivalOf,
	rulesOut,
	siteRefs,
} from "./refs";
import { sameValue } from "./values";

export { type MatchedBy, matchedElsewhere, type Placed };

const NEARBY_RADIUS_M = 300;

/** Objects of the record's kind other than `el`, nearest to it (or to the record) first. */
function kinOf(x: Placed, el: OsmElement | null, els: OsmElement[]) {
	const main = mainOf(x);
	if (!main) return null;
	const from = el ?? x;
	const near = els
		.filter((e) => sameKind(main.k, main.v, e.tags) && (!el || osmRef(e) !== osmRef(el)))
		.filter((e) => !rulesOut(e, x.refs, "hard"))
		.map((e) => ({ e, d: distance(from.lat, from.lon, e.lat, e.lon) }))
		.sort((a, b) => a.d - b.d);
	return { main, kin: near };
}

/**
 * The other objects the matched site is mapped as: same-kind neighbours, and whatever else
 * carries the record's own id of a site scheme however far off it is. A neighbour named for
 * something else (another place in the same building), or one another record of the run
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
	const excludes = kit(x, "excludes");
	const samePlace = (e: OsmElement) => {
		if (e.tags.name && !names.some((n) => nameSimilarity(n, e.tags.name) >= NAME_MATCH))
			return false;
		if (
			rulesOut(e, x.refs, "soft") ||
			excludes?.(x, e, el) ||
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
	const byRef = refHits(x, refIndex, shared, siteRefs())
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
	const theirs = (e: OsmElement) => (rulesOut(e, x.refs, "soft") ? 1 : 0);
	const fitOf = kit(x, "fit");
	const misfit = (e: OsmElement) => (fitOf?.(x, e)?.types ? 1 : 0);
	const nearest = (kind: (e: OsmElement) => boolean) =>
		els
			.filter((e) => kind(e) && !rulesOut(e, x.refs, "hard"))
			.map((e) => ({ e, d: Math.min(...points.map((p) => distance(p.lat, p.lon, e.lat, e.lon))) }))
			.filter(({ e, d }) => reach(e, d))
			.sort((a, b) => theirs(a.e) - theirs(b.e) || misfit(a.e) - misfit(b.e) || a.d - b.d)[0];
	const ofKind = (e: OsmElement) => sameKind(main.k, main.v, e.tags);
	const kin = nearest(ofKind);
	const alike = nearest(
		(e) =>
			lookalike(main.k, main.v, e.tags) &&
			!ofKind(e) &&
			(lookalikeHook(`${main.k}=${main.v}`)?.(x, e) ?? true),
	);
	const out = [kin, alike]
		.filter((n) => n !== undefined)
		.map(({ e, d }) => {
			const k =
				(e === alike?.e && lookalikeKey(main.k, main.v, e.tags)) ||
				(labelKeys().find((key) => e.tags[key]) ?? main.k);
			const rival = theirs(e) ? rivalOf(e) : undefined;
			const id = rival ? ` (${rival.inline})` : "";
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
	const banners = kit(x, "newBanners")?.(x, { points, els, matchedBy, listed });
	if (banners?.sibling) out.push(banners.sibling);
	return [...out, ...stale, ...(banners?.unlisted ?? [])];
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

const listed = (items: string[]) =>
	items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");

/** What a far match leaves out, of what the record's kind writes at all. */
function leftOut(x: Placed): string {
	const writes = (x.kind && registry().writes.get(x.kind)) || [];
	const items = [
		...(writes.some((k) => ADDRESS_KEY.test(k)) ? ["address"] : []),
		...(writes.some((k) => CONTACT.includes(k)) ? ["contacts"] : []),
		...organisations()
			.filter((r) => writes.includes(r.key))
			.map((r) => r.label),
		...(writes.includes("start_date") ? ["opening date"] : []),
	];
	return items.length
		? `, so its ${listed(items)} ${items.length > 1 ? "are" : "is"} left out`
		: "";
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
			`Matched to ${osmRef(el)}${el.tags.name ? ` “${el.tags.name}”` : ""}, ${metres(far)} from where the source and the address base place it: the place may have moved, or the id on this object may be stale${leftOut(x)}${standing}`,
		);
	// A station matched on its counts, not its id, reaches past where an operator would.
	else if (
		d > DUPLICATE_RADIUS_M ||
		(d > MATCH_RADIUS_M &&
			!!kit(x, "fit")?.(x, el) &&
			!refHits(x, refIndex, shared).some((h) => h.e === el))
	)
		out.push(
			`Matched to ${label(el, d)} from the source's point${standing}: check it is this place`,
		);
	for (const { key: k, noun } of neverReplaceKeys()) {
		const ours = x.tags.find((t) => t.k === k)?.v;
		if (ours && el.tags[k] && !sameValue(k, ours, el.tags[k]))
			out.push(
				`OSM has ${k}=${el.tags[k]} where the source says ${ours}: left alone, since it may be another ${noun}'s; check which is right`,
			);
	}
	if (!refHits(x, refIndex, shared).some((h) => h.e === el))
		out.push(...retiredHolders(x, el, refIndex, shared));
	const rival = rulesOut(el, x.refs, "soft") ? rivalOf(el) : undefined;
	if (rival) out.push(rival.line);
	const gone = notThePlace(el, main);
	if (gone)
		out.push(
			`This object may no longer be the place: ${gone}${main && !el.tags[main.k] ? `, so ${main.k}=${main.v} is not added` : ""}. Check it before writing to it`,
		);
	const split = splitParts(x, el, els, refIndex, shared, matchedBy);
	const banners = kit(x, "matchedBanners")?.(x, el, {
		grounds: groundsOf(x, el, els),
		split,
		els,
	}) ?? { before: [], here: split, after: [] };
	out.push(...banners.before);
	if (banners.here.length)
		out.push(
			`Same site may be mapped as ${banners.here.length + 1} objects (also ${banners.here.map((k) => label(k.e, k.d)).join("; ")}): what is written here would land on this one only`,
		);
	out.push(...banners.after);
	const twin = namesakeOf(x, el, els, split, matchedBy);
	if (twin && main)
		out.push(
			`Possible duplicate of this object: ${main.k}=${twin.e.tags[main.k]} is also mapped at ${label(twin.e, twin.d)}`,
		);
	return out;
}

/**
 * An object of the record's kind under the matched one's own name a little off it, too far to
 * be part of its site: the place may be mapped twice. Which names count as one place is the
 * kit's; without one, a name that is the record's whole name, the same name or a close
 * spelling of it, on an object carrying no id of a ruling-out scheme.
 */
function namesakeOf(
	x: Placed,
	el: OsmElement,
	els: OsmElement[],
	split: { e: OsmElement }[],
	matchedBy: MatchedBy,
): { e: OsmElement; d: number } | undefined {
	const own = kit(x, "namesake");
	const named = (e: OsmElement) => {
		if (own) return own(x, el, e, { els, matchedBy });
		if (!el.tags.name) return (nameScore(x, e, wordsOf(x)) ?? 0) >= WHOLE_NAME;
		return (
			fold(e.tags.name ?? "") === fold(el.tags.name) ||
			(!carriesHard(e) && nameSimilarity(e.tags.name ?? "", el.tags.name) >= WHOLE_NAME)
		);
	};
	return (kinOf(x, el, els)?.kin ?? []).find(
		({ e, d }) =>
			d > SPLIT_RADIUS_M &&
			d <= DUPLICATE_RADIUS_M &&
			!!e.tags.name &&
			named(e) &&
			!split.some((s) => s.e === e) &&
			!rulesOut(e, x.refs, "soft") &&
			!matchedElsewhere(e, x, matchedBy).length,
	);
}

/** Two "new" records this close are likely one place the source lists twice. */
const TWIN_RADIUS_M = 10;

/**
 * As far apart as one car park's stations, or two files' points for one site, when the
 * operator or the name agrees. Two places carrying different ids of a ruling-out scheme are two however close.
 */
const LIKE_TWIN_RADIUS_M = 60;

function twinReason(a: Extraction, b: Extraction): string | null {
	if (Math.abs(a.lat - b.lat) < latDegrees(LIKE_TWIN_RADIUS_M)) {
		const d = distance(a.lat, a.lon, b.lat, b.lon);
		const alike =
			!hardKeys().some((k) => a.refs[k] && b.refs[k]) &&
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
	for (const { key, label: name } of organisations())
		if (a.refs[key] && a.refs[key] === b.refs[key]) return `has the same ${name}`;
	const at = addressOf(tagsOf(a));
	return at && at === addressOf(tagsOf(b)) ? "has the same address" : null;
}

/** For each "new" record, the other "new" records of the run it may be the same place as. */
export function twinWarnings(news: Extraction[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const say = (x: Extraction, other: Extraction, why: string) =>
		out.set(x.key, [
			...(out.get(x.key) ?? []),
			`Another new candidate, “${shown(other)}” (${other.key}), ${why}: the two may be one place`,
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
			const main = mainKeys().find((k) => e.tags[k]);
			return [`${Math.round(d)} m`, main ? `${main}=${e.tags[main]}` : "", e.tags.name ?? ""]
				.filter(Boolean)
				.join("  ");
		});
}
