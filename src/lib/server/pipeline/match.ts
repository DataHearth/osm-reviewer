import OpeningHours from "opening_hours";
import { distance, houseNumber, nameSimilarity, normaliseName, tokens } from "./geo";
import { lookalike, SCHOOLS, type Selector, sameKind, schoolBuilding } from "./tagfilter";
import { type Extraction, type OsmElement, osmRef, type ProposedTag } from "./types";

/** Keys OSM mappers have used for the same identifier. */
const ALIASES: Record<string, string[]> = {
	"ref:UAI": ["ref:UAI", "ref:FR:UAI"],
	"ref:FR:SIRET": ["ref:FR:SIRET", "siret"],
};

/** Beyond this a name match is a different shop on the same street. */
export const MATCH_RADIUS_M = 50;
const NAME_MATCH = 0.5;
/** With a name missing on either side only a near-coincident point is trusted. */
const BARE_RADIUS_M = 15;
const NEARBY_RADIUS_M = 300;
/** What a mapper's name scores when every word of it is in the record's. */
const WHOLE_NAME = 0.8;
/** A name this close to the record's is the place even as far off as a directory puts it. */
const STRONG_NAME = 0.6;
/** Degrees of latitude a bit over the farthest match: a cheap cut before the haversine. */
const LAT_PREFILTER = 0.0014;

/**
 * An identifier keeps its meaning without its separators: mappers write `FR*TLS*P31555019`
 * where a registry writes `FRTLSP31555019`, and case varies.
 */
const ids = (v: string) =>
	v
		.split(";")
		.map((x) => x.replace(/[\s*]/g, "").toUpperCase())
		.filter(Boolean);

const values = (v: string) =>
	v
		.split(";")
		.map((x) => x.trim().replace(/\s+/g, ""))
		.filter(Boolean);

/** The `ce.<UAI>@ac-…` mailbox an académie gives every school names its establishment too. */
const mailUai = (e: OsmElement) =>
	/^ce\.(\d{7}[a-z])@ac-/i.exec(e.tags["contact:email"] ?? e.tags.email ?? "")?.[1].toUpperCase();

/** Whether `e` is another establishment: it carries a UAI, and none of them is the record's. */
export function otherPlace(e: OsmElement, refs: Record<string, string>): boolean {
	if (!refs["ref:UAI"]) return false;
	const ours = new Set(ids(refs["ref:UAI"]));
	const theirs = ALIASES["ref:UAI"].flatMap((k) => (e.tags[k] ? ids(e.tags[k]) : []));
	const mail = mailUai(e);
	if (mail) theirs.push(mail);
	return theirs.length > 0 && !theirs.some((x) => ours.has(x));
}

/**
 * An EVSE id the way stations are told apart. The `E`/`P` type letter goes, since mappers write
 * a point's id as a pool (`FR*GLY*PLYON2221` for `FRGLYELYON2221`). The part after the operator
 * code also stands alone when it names the station by itself, since a network that changed
 * hands keeps its pool ids under the new operator's code (`FR*E13*PDARTYLIMONEST69760*1` for
 * `FRSSDPDARTYLIMONEST697601`). An all-digit part names nothing: Toulouse's networks all number
 * their stations `<INSEE code><sequence>`, so `FRTLSP31555002` and `FR*PKG*P31555002` are two
 * operators' stations kilometres apart.
 */
function evseKeys(id: string): string[] {
	const m = /^([A-Z]{2}[A-Z0-9]{3})[EP](.+)$/.exec(id);
	if (!m) return [id];
	return m[2].length >= 8 && /[A-Z]/.test(m[2]) ? [m[1] + m[2], `~${m[2]}`] : [m[1] + m[2]];
}

const looseKey = (at: string) => at.includes("\u0000~");

/** Some files write a point as its station's id and a `P<connector>` (`FRALLEGO002084P1`). */
const CONNECTOR = /(?<=\d)P\d{1,2}$/;

const keysOf = (k: string, v: string) =>
	k === "ref:EU:EVSE"
		? [
				...new Set(
					ids(v)
						.flatMap((id) => [id, id.replace(CONNECTOR, "")])
						.flatMap(evseKeys),
				),
			]
		: [...new Set(ids(v))];

/**
 * Whether `e` carries EVSE ids none of which is this station's. A mapper's pool id is often
 * finer than the registry's (`PLYON13011` under `PLYON130`), so one id under the other still
 * agrees. It only rules out a name or distance match, and a neighbour as part of the site: the
 * duplicate banner must still see such an object.
 */
function otherStation(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = keysOf("ref:EU:EVSE", refs["ref:EU:EVSE"] ?? "");
	const theirs = keysOf("ref:EU:EVSE", evseOn(e));
	if (!ours.length || !theirs.length) return false;
	const related = (a: string, b: string) =>
		a === b || (a[0] !== "~" && b[0] !== "~" && (a.startsWith(b) || b.startsWith(a)));
	return !theirs.some((t) => ours.some((o) => related(t, o)));
}

/** `FR*TLS*E31555*059*3*1`: a point's id, connector and all, as some mappers write a plain `ref`. */
const EVSE_SHAPED = /^[A-Z]{2}\*[A-Z0-9]{3}\*[EP][A-Z0-9*]+$/i;

/** The EVSE ids an object carries, under its own key or as its plain `ref`. */
const evseOn = (e: OsmElement) =>
	[e.tags["ref:EU:EVSE"], EVSE_SHAPED.test(e.tags.ref ?? "") ? e.tags.ref : undefined]
		.filter(Boolean)
		.join(";");

/** The tag an object carries its EVSE id under, as the reviewer would look it up. */
const evseTag = (e: OsmElement) =>
	e.tags["ref:EU:EVSE"] ? `ref:EU:EVSE=${e.tags["ref:EU:EVSE"]}` : `ref=${e.tags.ref}`;

const EVSE_PARTS = /^[A-Z]{2}([A-Z0-9]{3})([EP])/;

/**
 * Whether `e` carries only station ids of the record's own network (`ELC` in
 * `FR*ELC*P12953885`), which the network has renumbered since. A point's id names a point of
 * some station, more likely a neighbour's than this one's.
 */
function renumberedPool(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = new Set(ids(refs["ref:EU:EVSE"] ?? "").map((id) => EVSE_PARTS.exec(id)?.[1]));
	const theirs = ids(evseOn(e)).map((id) => EVSE_PARTS.exec(id));
	return theirs.length > 0 && theirs.every((m) => m?.[2] === "P" && ours.has(m[1]));
}

/**
 * The record's points the object's ids name, when they name some of them and nothing else:
 * one borne of the station, `ref=FR*TLS*E31555*059*3*1` for its third point.
 */
function pointsOn(e: OsmElement, refs: Record<string, string>): { on: number; of: number } | null {
	const points = ids(refs["ref:EU:EVSE"] ?? "").filter((id) => /^[A-Z]{2}[A-Z0-9]{3}E/.test(id));
	const theirs = ids(evseOn(e));
	if (!theirs.length || !theirs.every((t) => points.some((p) => t.startsWith(p)))) return null;
	const on = points.filter((p) => theirs.some((t) => t.startsWith(p))).length;
	// A mapper who names one point but counts them all has mapped the whole station.
	if (Number.parseInt(e.tags.capacity ?? "", 10) === points.length) return null;
	return on < points.length ? { on, of: points.length } : null;
}

/**
 * One station's bornes named after it, `BRN06A` and `BRN06B`, beside another's, `BRN07A`: two
 * plain refs that read as a station and a borne letter name one station only if the stations agree.
 */
function otherBorne(a: OsmElement, b: OsmElement): boolean {
	const station = (e: OsmElement) =>
		EVSE_SHAPED.test(e.tags.ref ?? "") ? null : /^(.*\d)[A-Z]$/i.exec(e.tags.ref ?? "")?.[1];
	const [sa, sb] = [station(a), station(b)];
	return !!sa && !!sb && sa.toUpperCase() !== sb.toUpperCase();
}

const refKeys = (refs: Record<string, string>) =>
	Object.entries(refs).flatMap(([k, v]) => keysOf(k, v).map((one) => `${k}\u0000${one}`));

/** Fetched whatever else they carry: a school ground tagged only `building=school` still has its UAI. */
export const REF_SELECTORS: Record<string, Selector[]> = {
	"ref:UAI": ALIASES["ref:UAI"].map((k) => ({ k, v: null })),
	// A station mapped without its `amenity` still carries its pool id; charge points carry
	// theirs too, and would be matched as stations.
	"ref:EU:EVSE": [{ k: "ref:EU:EVSE", v: null, not: { k: "man_made", v: ["charge_point"] } }],
};

/**
 * Identifiers several records carry, which therefore pick none of them: a SIRET is the
 * organisation's, and one organisation can run several establishments.
 */
export function sharedRefs(xs: Pick<Extraction, "refs">[]): Set<string> {
	const seen = new Set<string>();
	const shared = new Set<string>();
	for (const x of xs) for (const at of refKeys(x.refs)) (seen.has(at) ? shared : seen).add(at);
	return shared;
}

/** Every element per identifier: a SIRET or an EVSE pool can sit on several objects. */
export function indexRefs(els: OsmElement[], keys: string[]): Map<string, OsmElement[]> {
	const idx = new Map<string, OsmElement[]>();
	for (const key of keys)
		for (const alias of ALIASES[key] ?? [key])
			for (const e of els) {
				const v = [e.tags[alias], key === "ref:UAI" ? mailUai(e) : undefined]
					.filter(Boolean)
					.join(";");
				for (const one of keysOf(key, v)) {
					const at = `${key}\u0000${one}`;
					const list = idx.get(at) ?? [];
					if (!list.includes(e)) idx.set(at, [...list, e]);
				}
			}
	return idx;
}

/**
 * Who runs or owns a place, which an OSM object with no name often still says. A city's
 * network is as often named by its owner as by its operator (Toulibeo, run by Bouygues).
 */
const WHO = ["operator", "network", "brand", "owner"];

const whoOf = (x: Partial<Pick<Extraction, "tags">>) =>
	(x.tags ?? []).filter((t) => WHO.includes(t.k)).map((t) => t.v);
const whoOn = (tags: Record<string, string>) => WHO.map((k) => tags[k]).filter(Boolean);

/** What a company tacks onto its name in one register and not another: "Power Dot France" is Powerdot. */
const LEGAL_TAIL =
	/( (france|fr|sas|sasu|sa|sarl|eurl|snc|cpo|gmbh|bv|ltd|group|groupe|partner network|network))+$/;
/** A company's trade name as mappers write it, under the name a registry gives it. */
const TRADING_AS: Record<string, string> = { alize: "bouygues" };
const company = (s: string) => {
	const c = normaliseName(s).replace(LEGAL_TAIL, "").replace(/ /g, "");
	return TRADING_AS[c] ?? c;
};
/** Shorter than this, one company name inside another is a coincidence. */
const COMPANY_MIN = 4;

function companySimilarity(a: string, b: string): number {
	const [ca, cb] = [company(a), company(b)];
	if (ca && ca === cb) return 1;
	const [short, long] = ca.length < cb.length ? [ca, cb] : [cb, ca];
	if (short.length >= COMPANY_MIN && long.includes(short)) return 1;
	return nameSimilarity(a, b);
}

/** How well two sides' operators, networks or owners agree; null when either side says nothing. */
function companiesAgree(ours: string[], theirs: string[]): number | null {
	if (!ours.length || !theirs.length) return null;
	return Math.max(...ours.flatMap((a) => theirs.map((b) => companySimilarity(a, b))));
}

const whoSimilarity = (x: Partial<Pick<Extraction, "tags">>, e: OsmElement) =>
	companiesAgree(whoOf(x), whoOn(e.tags));

const whoAgrees = (x: Partial<Pick<Extraction, "tags">>, e: OsmElement) =>
	(whoSimilarity(x, e) ?? 0) >= NAME_MATCH;

/** Words that say what an object is or its status, not which one it is. */
const GENERIC = new Set([
	"borne",
	"bornes",
	"recharge",
	"station",
	"stations",
	"charging",
	"irve",
	"electrique",
	"vehicules",
	"prive",
	"privee",
	"public",
	"publique",
]);

/**
 * How well an OSM name names the record, or null when it names nothing: a generic label
 * ("Recharge", "Borne de recharge Révéo") or the operator's own name ("Allego"), which leave
 * the operator to decide. A mapper's short name all inside the record's long one ("La Fourmi"
 * in "École élémentaire privée La Fourmi") counts as a strong match.
 */
type Named = Pick<Extraction, "name"> & Partial<Pick<Extraction, "tags" | "addr">>;

/**
 * The commune's words, which name half the places in it: "INSEEC MSc Toulouse" is not
 * "INSEEC Toulouse" for sharing "Toulouse".
 */
function communeWords(x: Named, e: OsmElement): Set<string> {
	const commune = /.*\d{5}\s*(\D.*)$/.exec(x.addr ?? "")?.[1] ?? "";
	const city = x.tags?.find((t) => t.k === "addr:city")?.v ?? "";
	const theirs = e.tags["addr:city"] ?? e.tags["contact:city"] ?? "";
	return new Set([commune, city, theirs].flatMap((s) => [...tokens(s)]));
}

function nameScore(x: Named, e: OsmElement): number | null {
	const commune = communeWords(x, e);
	const words = (s: string) => [...tokens(s)].filter((w) => !GENERIC.has(w) && !commune.has(w));
	const theirs = words(e.tags.name ?? "");
	const ours = new Set(words(x.name));
	const inOurs = theirs.every((w) => ours.has(w));
	// An operator named after its one place ("Association La Fourmi") does not make the
	// place's name a brand.
	const who = new Set([...whoOf(x), ...WHO.map((k) => e.tags[k] ?? "")].flatMap(words));
	if (!theirs.length || (!inOurs && theirs.every((w) => who.has(w)))) return null;
	const dice = nameSimilarity(x.name, e.tags.name, commune);
	return inOurs ? Math.max(dice, WHOLE_NAME) : dice;
}

/**
 * The objects carrying one of the record's own identifiers, nearest first. A pool id's bare
 * tail is weaker than the whole id, so it is believed only as far off as a misplaced point.
 */
function refHits(
	x: Pick<Extraction, "lat" | "lon" | "refs">,
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
	keys?: string[],
): { e: OsmElement; d: number }[] {
	const found = new Map<OsmElement, number>();
	for (const at of refKeys(x.refs)) {
		if (shared.has(at) || (keys && !keys.includes(at.split("\u0000")[0]))) continue;
		for (const e of refIndex.get(at) ?? []) {
			if (found.has(e) || otherPlace(e, x.refs)) continue;
			const d = distance(x.lat, x.lon, e.lat, e.lon);
			if (!looseKey(at) || d <= DUPLICATE_RADIUS_M) found.set(e, d);
		}
	}
	return [...found].map(([e, d]) => ({ e, d })).sort((a, b) => a.d - b.d);
}

type Findable = Pick<Extraction, "lat" | "lon" | "name" | "refs"> &
	Partial<Pick<Extraction, "tags" | "addr" | "absent">>;

type Main = { k: string; v: string };
const mainOf = (x: Partial<Pick<Extraction, "tags">>): Main | undefined =>
	x.tags?.find((t) => MAIN.includes(t.k));

/** Lifecycle prefixes a mapper puts on a place's main tag once it is no longer that place. */
const RETIRED = ["disused", "abandoned", "was"];

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

/** How many of the record's values the object already holds. */
function held(x: Partial<Pick<Extraction, "tags">>, e: OsmElement): number {
	return (x.tags ?? []).filter((p) => {
		const had = e.tags[keyOn(p.k, e.tags)];
		return had !== undefined && sameValue(p.k, p.v, had);
	}).length;
}

/**
 * The school among several objects carrying its UAI side by side, as a bare node beside the
 * grounds often does: the one named for it, then the way or relation, or whichever holds more
 * of what the record says.
 */
function bestHit(x: Findable, hits: { e: OsmElement; d: number }[]): OsmElement | null {
	const pool = hits.some((h) => !schoolBuilding(h.e.tags))
		? hits.filter((h) => !schoolBuilding(h.e.tags))
		: hits;
	if (!pool.length) return null;
	if (!x.refs["ref:UAI"]) return pool[0].e;
	const named = (e: OsmElement) => (e.tags.name && (nameScore(x, e) ?? 0) >= NAME_MATCH ? 1 : 0);
	const rank = (e: OsmElement) => held(x, e) + (e.type === "node" ? 0 : 1);
	const near = pool.filter((h) => h.d <= pool[0].d + MATCH_RADIUS_M);
	return near.sort((a, b) => named(b.e) - named(a.e) || rank(b.e) - rank(a.e) || a.d - b.d)[0].e;
}

/**
 * The object mapped as the school that a school building stands in or beside: one of its kind
 * next to it, or one named like the record a little farther, since only centres are known and
 * a building inside large grounds stands well off theirs.
 */
function groundsOf(x: Findable, building: OsmElement, els: OsmElement[]): OsmElement | null {
	const main = mainOf(x);
	if (!main || !schoolBuilding(building.tags)) return null;
	return (
		els
			.filter((e) => e !== building && sameKind(main.k, main.v, e.tags))
			.map((e) => ({ e, d: distance(building.lat, building.lon, e.lat, e.lon) }))
			.filter(
				({ e, d }) =>
					d <= SPLIT_RADIUS_M || (d <= MATCH_RADIUS_M && (nameScore(x, e) ?? 0) >= NAME_MATCH),
			)
			.sort((a, b) => a.d - b.d)[0]?.e ?? null
	);
}

/** Whether the grounds a matched school building stands in are this school's, not a neighbour's. */
function ownGrounds(x: Findable, grounds: OsmElement): boolean {
	const level = x.tags?.find((t) => t.k === "school:FR")?.v;
	const theirs = grounds.tags["school:FR"];
	return (
		!otherPlace(grounds, x.refs) &&
		(!grounds.tags.name || (nameScore(x, grounds) ?? 0) >= NAME_MATCH) &&
		(!level || !theirs || sameLevel(level, theirs))
	);
}

/** Upper bounds, in kW, of the power classes a connector's output falls in. */
const POWER_CLASSES = [8, 22, 60];
const powerClass = (v: string) => {
	const kw = Number.parseFloat(v);
	return Number.isNaN(kw) ? null : POWER_CLASSES.filter((top) => kw > top).length;
};

const DC = /^(type2_combo|type1_combo|chademo|tesla_supercharger.*)$/;

/** Whether a station's connectors are all direct current, all alternating, or both. */
function current(keys: string[]): "ac" | "dc" | null {
	const types = new Set(
		keys.flatMap((k) => /^socket:(?!unknown)([^:]+)(:output)?$/.exec(k)?.[1] ?? []),
	);
	const dc = [...types].filter((t) => DC.test(t)).length;
	return !types.size || (dc && dc < types.size) ? null : dc ? "dc" : "ac";
}

/**
 * How well an object fits the station a record describes, from what both state: a capacity,
 * a connector count or a power class they share agrees or not, and so does a connector the
 * source rules out. `types` is a fast DC unit for an AC station, or the other way round,
 * which is another station of the site rather than a stale count on this one.
 */
function stationFit(
	x: Partial<Pick<Extraction, "tags" | "absent" | "fit">>,
	e: OsmElement,
): { agree: number; against: number; types: boolean } | null {
	let agree = 0;
	let against = (x.absent ?? []).filter((k) => e.tags[k] !== undefined).length;
	const listed = [...(x.tags ?? []), ...(x.fit ?? [])];
	for (const t of listed) {
		if (!/^(capacity|socket:(?!unknown)[^:]+(:output)?)$/.test(t.k)) continue;
		const had = e.tags[t.k];
		if (had === undefined) continue;
		const [a, b] = t.k.endsWith(":output")
			? [powerClass(t.v), powerClass(had)]
			: [Number.parseInt(t.v, 10), Number.parseInt(had, 10)];
		// `socket:type2=yes` counts nothing.
		if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b)) continue;
		if (a === b) agree += 1;
		else against += 1;
	}
	const [ours, theirs] = [current(listed.map((t) => t.k)), current(Object.keys(e.tags))];
	const types = !!ours && !!theirs && ours !== theirs;
	if (types) against += 1;
	return agree + against ? { agree, against, types } : null;
}

const fitScore = (f: ReturnType<typeof stationFit>) => (f ? f.agree - f.against : 0);

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
		return grounds && ownGrounds(x, grounds) ? grounds : byRef;
	}

	let best: { el: OsmElement; score: number } | null = null;
	for (const e of els) {
		if (otherPlace(e, x.refs)) continue;
		if (Math.abs(e.lat - x.lat) > LAT_PREFILTER) continue;
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

/** `+33 5 61…` and `05 61…` are the same line. */
const digits = (s: string) => s.replace(/\D/g, "").replace(/^(0033|33)(?=\d{9}$)/, "0");

function url(s: string): { https: boolean; host: string; path: string } | null {
	try {
		const u = new URL(/^https?:\/\//i.test(s.trim()) ? s.trim() : `http://${s.trim()}`);
		const path = u.pathname.replace(/\/+$/, "").toLowerCase();
		return { https: u.protocol === "https:", host: u.hostname.replace(/^www\./, ""), path };
	} catch {
		return null;
	}
}

const withoutTld = (host: string) => host.replace(/\.[^.]+$/, "");

/**
 * Whether the directory's site `a` adds nothing to the mapper's `b`: the same site at a page
 * of it or its root, or the same name under another TLD, which a directory alone does not
 * settle. Nor does an ENT, a school's pupil-and-parent login portal, replace its public site,
 * and a mapper's https is never taken back to http.
 */
function sameSite(a: string, b: string): boolean {
	const [pa, pb] = [url(a), url(b)];
	if (!pa || !pb) return a.trim().toLowerCase() === b.trim().toLowerCase();
	if (/(^|\.)ent\./.test(pa.host)) return true;
	if (pa.host !== pb.host) return withoutTld(pa.host) === withoutTld(pb.host);
	if (pb.https && !pa.https) return true;
	return pa.path.startsWith(pb.path) || pb.path.startsWith(pa.path);
}

/** Accents, case, punctuation and `&` for "et" are how a registry and a mapper differ, not what they say. */
const NAMES = ["name", "operator", "network", "brand", "owner", "addr:street", "addr:city"];
const fold = (s: string) => normaliseName(s.replace(/&/g, " et "));

/** Registries write "open all day" as the last minute they bother to count to. */
const allDay = (s: string) =>
	/^(Mo-Su )?00:00-(24:00|23:5\d|00:00)$/.test(s.trim()) ? "24/7" : s.trim();

/** A week of opening hours compared hour by hour, so `Mo 00:00-23:59, Tu …` is `Mo-Fr 00:00-24:00`. */
function sameHours(a: string, b: string): boolean {
	if (allDay(a) === allDay(b)) return true;
	const read = (s: string) => new OpeningHours(s.trim().replace(/23:5\d\b/g, "24:00"), null, 0);
	try {
		// Typed as a boolean, but answers `[equal, differences?]`.
		const [equal] = read(a).isEqualTo(read(b), new Date(Date.UTC(2024, 0, 1))) as unknown as [
			boolean,
		];
		return equal;
	} catch {
		return false;
	}
}

/** The coarser value an `operator:type` refines: a non-profit school is a private one. */
const OPERATOR_TYPE: Record<string, string> = {
	private_non_profit: "private",
	private_for_profit: "private",
	religious: "private",
	community: "private",
	government: "public",
	municipal: "public",
};

/**
 * The level a `school:FR` value sits in: a lycée professionnel is a lycée, a lycée secondary.
 * Not a maternelle a primaire: whether a school has its maternelle classes, the directory knows.
 */
const parentLevel = (v: string): string | null =>
	/^lycée\s/.test(v) ? "lycée" : v === "lycée" || v === "collège" ? "secondaire" : null;

function levels(v: string): string[] {
	const out: string[] = [];
	for (let at: string | null = v; at; at = parentLevel(at)) out.push(at);
	return out;
}

const schoolLevels = (v: string) =>
	v
		.split(";")
		.map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
		.filter(Boolean);

/**
 * A mapper's level that is finer than the directory's, or that takes it in, already says it:
 * "lycée professionnel" is a lycée, "secondaire" covers a collège.
 */
const sameLevel = (a: string, b: string) =>
	schoolLevels(a).every((x) =>
		schoolLevels(b).some((y) => levels(x).includes(y) || levels(y).includes(x)),
	);

/**
 * Whether the proposed value `a` says what the object's `b` already does, so a re-spaced
 * phone number is not an edit, nor a coarser word for what a mapper wrote finely.
 */
export function sameValue(key: string, a: string, b: string): boolean {
	if (a === b) return true;
	const k = key.replace(/^contact:/, "");
	if (NAMES.includes(k)) return fold(a) === fold(b);
	if (k === "opening_hours") return sameHours(a, b);
	if (k.endsWith(":output")) return Number.parseFloat(a) === Number.parseFloat(b);
	if (k === "phone" || k === "fax" || k === "mobile") return digits(a) === digits(b);
	if (k === "website") return sameSite(a, b);
	if (k === "addr:housenumber" || k === "housenumber") return houseNumber(a) === houseNumber(b);
	if (k === "operator:type") return OPERATOR_TYPE[b] === a;
	if (k === "school:FR") return sameLevel(a, b);
	// One object often carries several establishments' ids (a collège and its SEGPA):
	// the record's own id among them agrees, and replacing the list would delete the others.
	if (k.startsWith("ref:")) {
		const had = new Set(ids(b));
		return ids(a).every((x) => had.has(x));
	}
	if (a.includes(";") || b.includes(";")) {
		const sa = new Set(values(a));
		const sb = new Set(values(b));
		// One value among the object's several is that value: a cité scolaire is
		// `school:FR=collège;primaire;lycée` to each of its establishments.
		if (sa.size === 1 && sb.has([...sa][0])) return true;
		return sa.size === sb.size && [...sa].every((x) => sb.has(x));
	}
	return a.trim() === b.trim();
}

export interface TagOp extends ProposedTag {
	op: "add" | "mod" | "del";
	was: string | null;
	/** The key of the other half of a move, which is only right taken together with this one. */
	pair?: string;
}

const CONTACT = ["phone", "website", "email", "fax", "mobile"];

/** A detail the object may already carry under another key: a station's phone is usually its operator's line. */
const PHONES = ["phone", "contact:phone", "mobile", "contact:mobile"];
const SAME_AS: Record<string, string[]> = { phone: PHONES, "operator:phone": PHONES };

/** What the object already says that rules a proposed value out: a station surveyed as badge-only. */
const RULED_OUT: Record<string, (current: Record<string, string>) => boolean> = {
	"authentication:none": (c) =>
		c["payment:membership_card"] === "yes" ||
		Object.entries(c).some(
			([k, v]) => k.startsWith("authentication:") && k !== "authentication:none" && v === "yes",
		),
};

/**
 * The key this object keeps `k` under: mappers write contact details as `contact:phone`
 * as often as `phone`, and an object already using the `contact:` scheme gets the new
 * detail in the same scheme rather than a second copy beside it.
 */
function keyOn(k: string, current: Record<string, string>): string {
	if (current[k] !== undefined || !CONTACT.includes(k)) return k;
	const scheme = `contact:${k}`;
	if (current[scheme] !== undefined) return scheme;
	return CONTACT.some((c) => current[`contact:${c}`] !== undefined) ? scheme : k;
}

const ADDRESS_HELD = /^contact:(housenumber|street|postcode|city)$/;

/**
 * An address proposed whole, or not at all when any part differs from the object's. One the
 * object holds as `contact:housenumber`… (how the 2016–2018 Éducation nationale imports wrote
 * it) is its address all the same, and moves to `addr:*`, where OSM keeps one, rather than
 * gaining a second copy beside it.
 */
function addressOps(parts: ProposedTag[], current: Record<string, string>): TagOp[] {
	if (!parts.length) return [];
	const held = (k: string) => current[k] ?? current[k.replace(/^addr:/, "contact:")];
	if (parts.some((p) => held(p.k) !== undefined && !sameValue(p.k, p.v, held(p.k)))) return [];
	const ops: TagOp[] = [];
	for (const from of Object.keys(current).filter((k) => ADDRESS_HELD.test(k))) {
		const to = from.replace(/^contact:/, "addr:");
		if (current[to] !== undefined) continue;
		const v = current[from];
		const ev = parts.find((p) => p.k === to) ?? {
			...parts[0],
			path: from,
			kind: "OSM",
			parts: [
				{ text: `${from}: `, mark: false },
				{ text: v, mark: true },
			],
		};
		ops.push({ ...ev, k: to, v, op: "add", was: null, pair: from });
		ops.push({ ...ev, k: from, v, op: "del", was: null, pair: to });
	}
	for (const p of parts) if (held(p.k) === undefined) ops.push({ ...p, op: "add", was: null });
	return ops;
}

/** A count of connectors of no stated type, which typed counts replace rather than add to. */
const UNTYPED = ["socket:unknown", "socket:unknown:output"];

/** A registry's bare `24/7` is what it writes when nobody filled the hours in, not a survey. */
const addOnly = (p: ProposedTag) => p.addOnly || (p.k === "opening_hours" && p.v.trim() === "24/7");

/** Tag operations that turn the element's tags into what the source says; nothing for what already agrees. */
export function updateOps(proposed: ProposedTag[], current: Record<string, string>): TagOp[] {
	const ops: TagOp[] = addressOps(
		proposed.filter((p) => p.group === "addr"),
		current,
	);
	for (const p of proposed) {
		if (p.group === "addr" || RULED_OUT[p.k]?.(current)) continue;
		// A main tag beside its own `disused:` twin would reopen the place on the source's word.
		if (MAIN.includes(p.k) && RETIRED.some((r) => current[`${r}:${p.k}`] !== undefined)) continue;
		const k = keyOn(p.k, current);
		const elsewhere = SAME_AS[p.k]?.filter((o) => o !== k);
		if (elsewhere?.some((o) => current[o] && digits(current[o]) === digits(p.v))) continue;
		const had = current[k];
		if (had === undefined) ops.push({ ...p, k, op: "add", was: null });
		else if (!addOnly(p) && ![p.v, ...(p.also ?? [])].some((v) => sameValue(p.k, v, had)))
			ops.push({ ...p, k, op: "mod", was: had });
	}
	const typed = ops.find((o) => /^socket:(?!unknown)[^:]+$/.test(o.k));
	if (typed)
		for (const k of UNTYPED)
			if (current[k] !== undefined) ops.push({ ...typed, k, v: current[k], op: "del", was: null });
	const amenity = ops.find((o) => o.k === "amenity")?.v ?? current.amenity;
	return amenity === "social_facility" ? ops : ops.filter((o) => o.k !== "social_facility:for");
}

export function newOps(proposed: ProposedTag[]): TagOp[] {
	return proposed.map((p) => ({ ...p, op: "add" as const, was: null }));
}

const MAIN = ["amenity", "shop", "office", "tourism", "leisure", "craft", "healthcare"];

/** A closed place keeps its mapping as `disused:`, and loses the details that no longer apply. */
export function closureOps(
	by: NonNullable<Extraction["closedBy"]>,
	current: Record<string, string>,
	conf: number,
): TagOp[] {
	const key = MAIN.find((k) => current[k]);
	if (!key) return [];
	const ev = { conf, path: by.path, parts: by.parts, kind: by.kind };
	const ops: TagOp[] = [
		{ ...ev, op: "mod", k: `disused:${key}`, v: current[key], was: `${key}=${current[key]}` },
	];
	for (const k of ["opening_hours", "phone"])
		if (current[k]) ops.push({ ...ev, op: "del", k, v: current[k], was: null });
	return ops;
}

/**
 * An object of the same kind this close to a "new" POI is most likely it, mapped without the
 * name or identifier that would have matched it. IRVE points and directory addresses sit
 * up to ~125 m from where mappers put the object.
 */
const DUPLICATE_RADIUS_M = 150;
/** Objects of one kind this close to a match are one site mapped as several objects. */
const SPLIT_RADIUS_M = 25;

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

type Placed = Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name" | "from"> &
	Partial<Pick<Extraction, "key">>;

/** Each matched object's records in this run, by the object's OSM ref. */
export type MatchedBy = Map<string, Pick<Extraction, "key" | "name" | "tags" | "refs">[]>;

/** The run's other records matched to `e`. */
const matchedElsewhere = (e: OsmElement, x: Placed, matchedBy: MatchedBy) =>
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

/** The identifiers that name one site; a SIRET is the whole organisation's. */
const SITE_REFS = ["ref:UAI", "ref:EU:EVSE"];

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
		if (otherStation(e, x.refs) || otherBorne(el, e) || matchedElsewhere(e, x, matchedBy).length)
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

/** A maternelle is often mapped as the kindergarten it looks like, under its own name. */
const maternelleAs = (x: Placed, e: OsmElement) =>
	e.tags.amenity !== "kindergarten" ||
	(/maternelle/.test(tagsOf(x)["school:FR"] ?? "") && (nameScore(x, e) ?? 0) >= NAME_MATCH);

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
): string[] {
	const main = mainOf(x);
	if (!main) return [];
	const stale = refHits(x, refIndex, shared).flatMap(({ e, d }) => {
		const why = notThePlace(e, main);
		return why
			? [`${label(e, d)} carries this record's id, but ${why}: check where the place is now`]
			: [];
	});
	const at = addressOf(tagsOf(x));
	const reach = (e: OsmElement, d: number) =>
		d <= DUPLICATE_RADIUS_M ||
		(d <= SAME_OPERATOR_RADIUS_M && (whoAgrees(x, e) || (!!at && addressOf(e.tags) === at)));
	// A record moved to its address may be mapped where the source placed it.
	const points = [x, ...(x.from ? [x.from] : [])];
	// A station's other kind of station nearer (its DC units beside its AC bays) is not the one to name.
	const misfit = (e: OsmElement) => (stationFit(x, e)?.types ? 1 : 0);
	const nearest = (kind: (e: OsmElement) => boolean) =>
		els
			.filter((e) => kind(e) && !otherPlace(e, x.refs))
			.map((e) => ({ e, d: Math.min(...points.map((p) => distance(p.lat, p.lon, e.lat, e.lon))) }))
			.filter(({ e, d }) => reach(e, d))
			.sort((a, b) => misfit(a.e) - misfit(b.e) || a.d - b.d)[0];
	const kin = nearest((e) => sameKind(main.k, main.v, e.tags));
	const alike = nearest(
		(e) =>
			lookalike(main.k, main.v, e.tags) && !sameKind(main.k, main.v, e.tags) && maternelleAs(x, e),
	);
	const out = [kin, alike]
		.filter((n) => n !== undefined)
		.map(({ e, d }) => {
			const k = [...MAIN, "man_made", "building"].find((key) => e.tags[key]) ?? main.k;
			return `Possible duplicate: ${k}=${e.tags[k]} already mapped at ${label(e, d)}`;
		});
	const sibling = siblingOf(x, els, matchedBy);
	if (sibling) out.push(sibling);
	return [...out, ...stale];
}

const contactOf = (tags: Record<string, string>) =>
	[
		...["phone", "contact:phone"].map((k) => tags[k]?.replace(/\D/g, "").slice(-9)),
		...["email", "contact:email"].map((k) => tags[k]?.toLowerCase()),
	].filter((v): v is string => !!v);

const siretOf = (tags: Record<string, string>) =>
	(tags["ref:FR:SIRET"] ?? tags.siret ?? "").replace(/\s/g, "") || null;

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
					? "the same SIRET"
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
	const id = hit.e.tags["ref:UAI"] ? ` (ref:UAI=${hit.e.tags["ref:UAI"]})` : "";
	return `Another establishment${id} with ${hit.why} is mapped at ${label(hit.e, hit.d)}: check this is not it`;
}

/**
 * Farther than this from where the source and the address base both place the record, an
 * object carrying its id is the place before it moved, or carries a stale id: what it is may
 * still be right, where it is reached is not.
 */
const FAR_FROM_ADDRESS_M = 500;

type Located = Pick<Extraction, "lat" | "lon"> &
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

const metres = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);

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
): string[] {
	if (!el) return [...addressAway(x), ...duplicates(x, els, refIndex, shared, matchedBy)];
	const out: string[] = [];
	const main = mainOf(x);
	const far = farFromAddress(x, el);
	const d = distance(x.lat, x.lon, el.lat, el.lon);
	if (far)
		out.push(
			`Matched to ${osmRef(el)}${el.tags.name ? ` “${el.tags.name}”` : ""}, ${metres(far)} from where the source and the address base place it: the place may have moved, or the id on this object may be stale, so its address, contacts and SIRET are left out`,
		);
	else if (d > DUPLICATE_RADIUS_M)
		out.push(`Matched to ${label(el, d)} from the source's point: check it is this place`);
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
	if (split.length)
		out.push(
			`Same site may be mapped as ${split.length + 1} objects (also ${split.map((k) => label(k.e, k.d)).join("; ")}): what is written here would land on this one only`,
		);
	const twin = namesake(x, el, els, split, matchedBy);
	if (twin && main)
		out.push(
			`Possible duplicate of this object: ${main.k}=${twin.e.tags[main.k]} is also mapped at ${label(twin.e, twin.d)}`,
		);
	return out;
}

/**
 * An object of the record's kind under the matched one's own name a little off it, too far to
 * be part of its site: the place may be mapped twice. A name merely alike is a sister school
 * ("École maternelle Jean Mermoz" beside the élémentaire), and a groupe scolaire around it
 * holds it rather than repeats it.
 */
function namesake(
	x: Placed,
	el: OsmElement,
	els: OsmElement[],
	split: { e: OsmElement }[],
	matchedBy: MatchedBy,
): { e: OsmElement; d: number } | undefined {
	const named = (e: OsmElement) =>
		el.tags.name ? fold(e.tags.name) === fold(el.tags.name) : (nameScore(x, e) ?? 0) >= WHOLE_NAME;
	return (kinOf(x, el, els)?.kin ?? []).find(
		({ e, d }) =>
			d > SPLIT_RADIUS_M &&
			d <= DUPLICATE_RADIUS_M &&
			!!e.tags.name &&
			named(e) &&
			!campus(e.tags) &&
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
			!(a.refs["ref:UAI"] && b.refs["ref:UAI"]) &&
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
	const siret = a.refs["ref:FR:SIRET"];
	if (siret && siret === b.refs["ref:FR:SIRET"]) return "has the same SIRET";
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
	const lycee = /lycée/i.test(current["school:FR"] ?? "")
		? `school:FR=${current["school:FR"]}`
		: /^lycée/i.test(current.name ?? "")
			? `name=${current.name}`
			: null;
	if (lycee && ops.some((o) => o.op === "mod" && o.k === "amenity" && o.v === "college"))
		lines.push(
			`The object reads as a lycée (${lycee}), which amenity=college would no longer say: check whether the post-bac school is mapped apart from it`,
		);
	return lines;
}

/** What a source counts for a whole site, which no single part of a split site carries. */
const SITE_COUNTS = /^(capacity|socket:.+)$/;
/** A connector's power is the same whichever record states it; how many there are is not. */
const isCount = (o: TagOp) => SITE_COUNTS.test(o.k) && (o.op === "del" || !o.k.endsWith(":output"));
const SPLIT_COUNTS_NOTE =
	"Capacity and sockets are left out: the source counts the whole site, not this one object";
const SHARED_COUNTS_NOTE =
	"Capacity and sockets are left out: several records were matched to this object, and each counts only its own";

/** Where the place is reached, and the organisation's SIRET, which a far object's may not be. */
const reachedAt = (o: TagOp) =>
	o.group === "addr" ||
	/^(addr|contact):/.test(o.k) ||
	CONTACT.includes(o.k) ||
	o.k === "ref:FR:SIRET";

/** Whether `e` carries, besides the record's own UAI, another establishment's. */
function sharedByOthers(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = new Set(ids(refs["ref:UAI"] ?? ""));
	return (
		ours.size > 0 &&
		ALIASES["ref:UAI"].some((k) => ids(e.tags[k] ?? "").some((id) => !ours.has(id)))
	);
}

/** A school's level in its name: an école of any kind, a collège, a lycée. */
const LEVEL_WORDS: Record<string, string> = {
	ecole: "primaire",
	maternelle: "primaire",
	elementaire: "primaire",
	primaire: "primaire",
	college: "collège",
	lycee: "lycée",
};

/**
 * One object for several establishments: a cité scolaire, a "groupe scolaire", an
 * "Établissement (École, Collège, Lycée)". Whichever of them a record is, its opening is not
 * the object's.
 */
function campus(tags: Record<string, string>): boolean {
	const level = tags["school:FR"] ?? "";
	if (level === "secondaire" || level.includes(";")) return true;
	const name = normaliseName(tags.name ?? "");
	if (/\b(groupe|cite) scolaire\b/.test(name)) return true;
	return new Set(name.split(" ").flatMap((w) => LEVEL_WORDS[w] ?? [])).size > 1;
}

/**
 * Whether two records give one site. Against OSM a page and its site's root agree (`sameSite`),
 * but two establishments giving a root and a page of it are giving two pages.
 */
function sameUrl(a: string, b: string): boolean {
	const [pa, pb] = [url(a), url(b)];
	if (!pa || !pb) return a.trim().toLowerCase() === b.trim().toLowerCase();
	return pa.host === pb.host && pa.path === pb.path;
}

const agreeBetween = (k: string, a: string, b: string) =>
	k.replace(/^contact:/, "") === "website" ? sameUrl(a, b) : sameValue(k, a, b);

/**
 * The operations among `ops` another record matched to the same object contradicts, compared
 * under the key the object would get each value under. A move or an address goes whole.
 */
export function disputedOps(
	ops: TagOp[],
	others: Pick<Extraction, "tags">[],
	current: Record<string, string>,
): TagOp[] {
	const direct = ops.filter(
		(o) =>
			o.op !== "del" &&
			others.some((other) =>
				other.tags.some((t) => keyOn(t.k, current) === o.k && !agreeBetween(t.k, t.v, o.v)),
			),
	);
	const groups = new Set(direct.map((o) => o.group).filter(Boolean));
	const keys = new Set(direct.map((o) => o.k));
	return ops.filter(
		(o) =>
			direct.includes(o) ||
			(o.group !== undefined && groups.has(o.group)) ||
			(o.pair !== undefined && keys.has(o.pair)),
	);
}

export interface Plan {
	ops: TagOp[];
	notes: string[];
	/** How far the object lies from the record, when that left some of its operations out. */
	far?: number;
}

/**
 * What a matched record writes to its object, and what the reviewer is told was left out:
 * the site's counts on one part of it, values another record on the object disputes, and
 * where it is reached when the object lies far from the record's address.
 */
export function planUpdate(
	x: Placed & Located,
	el: OsmElement,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]> = new Map(),
	shared: Set<string> = new Set(),
	matchedBy: MatchedBy = new Map(),
): Plan {
	let ops = updateOps(x.tags, el.tags);
	const notes: string[] = [];
	const others = matchedElsewhere(el, x, matchedBy);
	const leave = (out: (o: TagOp) => boolean) => {
		ops = ops.filter((o) => !out(o));
	};
	const split = splitParts(x, el, els, refIndex, shared, matchedBy).length > 0;
	const borne = pointsOn(el, x.refs);
	const counts =
		split || borne
			? ops.filter((o) => SITE_COUNTS.test(o.k))
			: others.length
				? ops.filter(isCount)
				: [];
	if (counts.length) {
		leave((o) => counts.includes(o));
		notes.push(
			borne
				? `Capacity and sockets are left out: this object's ${evseTag(el)} names ${borne.on} of the station's ${borne.of} points, so the source's counts are not its own`
				: split
					? SPLIT_COUNTS_NOTE
					: SHARED_COUNTS_NOTE,
		);
	}
	const far = farFromAddress(x, el);
	const before = ops.length;
	// Far off and mapped as no place at all, the object is a building that kept the id: what
	// the place is, its name and its level would land there as much as its address would.
	if (far)
		leave(
			MAIN.some((k) => el.tags[k]) ? reachedAt : (o) => reachedAt(o) || !o.k.startsWith("ref:"),
		);
	const farOut = far && ops.length < before ? far : undefined;
	const main = mainOf(x);
	if (groundsOf(x, el, els)) leave((o) => o.k === "amenity" || o.k === "name");
	// A place closed, being built or turned into something else is not reopened on the
	// source's word, nor dated by it.
	if (notThePlace(el, main)) leave((o) => o.k === main?.k || o.k === "start_date");
	// A group's object (a primaire and its collège, a cité scolaire) opened once for each of them.
	if (others.length || sharedByOthers(el, x.refs) || campus(el.tags))
		leave((o) => o.k === "start_date");
	// Nor does one of its establishments give it a single level.
	if (campus(el.tags)) leave((o) => o.k === "school:FR" && o.op === "add");
	// Several establishments on one object (a cité scolaire) each propose their own phone,
	// SIRET or UAI for it; whichever a reviewer accepted last would win.
	const disputed = disputedOps(ops, others, el.tags);
	if (disputed.length) {
		leave((o) => disputed.includes(o));
		notes.push(
			`Left out, since another record on this object says otherwise: ${[...new Set(disputed.map((o) => o.k))].join(", ")}`,
		);
	}
	notes.push(...modWarnings(ops, el.tags));
	return { ops, notes, ...(farOut ? { far: farOut } : {}) };
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

/**
 * What tells a reviewer this is the right object comes first: what kind of object it is, and
 * the identifiers and level it already carries. The address, which rarely settles it, comes last.
 */
const CONTEXT_KEYS = [
	...MAIN,
	"name",
	"ref:UAI",
	"ref:EU:EVSE",
	"ref:FR:SIRET",
	"school:FR",
	"operator",
	"brand",
	"opening_hours",
	"phone",
	"contact:phone",
	"email",
	"contact:email",
	"website",
	"contact:website",
];

const contextRank = (k: string) => {
	const at = CONTEXT_KEYS.indexOf(k);
	if (at >= 0) return at;
	return k.startsWith("addr:") || ADDRESS_HELD.test(k) ? CONTEXT_KEYS.length : -1;
};

/**
 * The element's tags the candidate leaves alone, all of them. A closure's `disused:amenity`
 * replaces the bare `amenity`, which is therefore not left alone either.
 */
export function unchangedTags(current: Record<string, string>, touched: Set<string>) {
	return Object.entries(current)
		.filter(([k]) => !touched.has(k) && !touched.has(`disused:${k}`))
		.map(([k, v]) => ({ k, v }));
}

/** The few of them a reviewer looks at for context. */
export function contextTags(unchanged: { k: string; v: string }[]) {
	return unchanged
		.filter((x) => contextRank(x.k) >= 0)
		.sort((a, b) => contextRank(a.k) - contextRank(b.k))
		.slice(0, 6);
}
