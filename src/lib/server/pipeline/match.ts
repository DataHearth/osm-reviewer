import { distance, nameSimilarity, normaliseName, tokens } from "./geo";
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

const keysOf = (k: string, v: string) =>
	k === "ref:EU:EVSE" ? [...new Set(ids(v).flatMap(evseKeys))] : [...new Set(ids(v))];

/**
 * Whether `e` carries EVSE ids none of which is this station's. A mapper's pool id is often
 * finer than the registry's (`PLYON13011` under `PLYON130`), so one id under the other still
 * agrees. It only rules out a name or distance match, and a neighbour as part of the site: the
 * duplicate banner must still see such an object.
 */
function otherStation(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = keysOf("ref:EU:EVSE", refs["ref:EU:EVSE"] ?? "");
	const theirs = keysOf("ref:EU:EVSE", e.tags["ref:EU:EVSE"] ?? "");
	if (!ours.length || !theirs.length) return false;
	const related = (a: string, b: string) =>
		a === b || (a[0] !== "~" && b[0] !== "~" && (a.startsWith(b) || b.startsWith(a)));
	return !theirs.some((t) => ours.some((o) => related(t, o)));
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

/** Who runs a place, which an OSM object with no name often still says. */
const WHO = ["operator", "network", "brand"];

const whoOf = (x: Partial<Pick<Extraction, "tags">>) =>
	(x.tags ?? []).filter((t) => WHO.includes(t.k)).map((t) => t.v);

/** What a company tacks onto its name in one register and not another: "Power Dot France" is Powerdot. */
const LEGAL_TAIL =
	/( (france|fr|sas|sasu|sa|sarl|eurl|snc|cpo|gmbh|bv|ltd|group|groupe|partner network|network))+$/;
const company = (s: string) => normaliseName(s).replace(LEGAL_TAIL, "").replace(/ /g, "");
/** Shorter than this, one company name inside another is a coincidence. */
const COMPANY_MIN = 4;

function companySimilarity(a: string, b: string): number {
	const [ca, cb] = [company(a), company(b)];
	if (ca && ca === cb) return 1;
	const [short, long] = ca.length < cb.length ? [ca, cb] : [cb, ca];
	if (short.length >= COMPANY_MIN && long.includes(short)) return 1;
	return nameSimilarity(a, b);
}

/** How well the record's operator or network agrees with an unnamed object's; null when either side says nothing. */
function whoSimilarity(x: Partial<Pick<Extraction, "tags">>, e: OsmElement): number | null {
	const ours = whoOf(x);
	const theirs = WHO.map((k) => e.tags[k]).filter(Boolean);
	if (!ours.length || !theirs.length) return null;
	return Math.max(...ours.flatMap((a) => theirs.map((b) => companySimilarity(a, b))));
}

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
	return inOurs ? Math.max(dice, 0.8) : dice;
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

export function findMatch(
	x: Pick<Extraction, "lat" | "lon" | "name" | "refs"> & Partial<Pick<Extraction, "tags" | "addr">>,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string> = new Set(),
): OsmElement | null {
	const hits = refHits(x, refIndex, shared);
	const byRef = hits.find((h) => !schoolBuilding(h.e.tags)) ?? hits[0];
	if (byRef) return byRef.e;

	let best: { el: OsmElement; score: number } | null = null;
	for (const e of els) {
		if (otherPlace(e, x.refs) || otherStation(e, x.refs)) continue;
		if (Math.abs(e.lat - x.lat) > LAT_PREFILTER) continue;
		const building = schoolBuilding(e.tags);
		if (building && !e.tags.name) continue;
		const d = distance(x.lat, x.lon, e.lat, e.lon);
		const named = e.tags.name && x.name ? nameScore(x, e) : null;
		// Most charging stations on OSM have no name, and the registry places them up to tens of
		// metres off; the operator agreeing is what lets one match beyond a coincident point.
		const who = named === null ? whoSimilarity(x, e) : null;
		const sim = named ?? (who !== null && who >= NAME_MATCH ? who : null);
		if (d > (sim !== null && sim >= STRONG_NAME ? DUPLICATE_RADIUS_M : MATCH_RADIUS_M)) continue;
		const ok = sim === null ? d <= BARE_RADIUS_M : sim >= NAME_MATCH;
		if (!ok) continue;
		// A named block inside grounds mapped as the school is not the school: the building
		// stands for it only when nothing mapped as one matches.
		const score = (sim ?? 0.4) - d / 1000 - (building ? 1 : 0);
		if (!best || score > best.score) best = { el: e, score };
	}
	return best?.el ?? null;
}

/** `+33 5 61…` and `05 61…` are the same line. */
const digits = (s: string) => s.replace(/\D/g, "").replace(/^(0033|33)(?=\d{9}$)/, "0");
const site = (s: string) =>
	s
		.toLowerCase()
		.replace(/^https?:\/\/(www\.)?/, "")
		.replace(/\/$/, "");

/** Accents, case, punctuation and `&` for "et" are how a registry and a mapper differ, not what they say. */
const NAMES = ["name", "operator", "network", "brand", "owner", "addr:street", "addr:city"];
const fold = (s: string) => normaliseName(s.replace(/&/g, " et "));

/** Registries write "open all day" as the last minute they bother to count to. */
const allDay = (s: string) =>
	/^(Mo-Su )?00:00-(24:00|23:5\d|00:00)$/.test(s.trim()) ? "24/7" : s.trim();

/**
 * Whether the proposed value `a` says what the object's `b` already does, so a re-spaced
 * phone number is not an edit.
 */
export function sameValue(k: string, a: string, b: string): boolean {
	if (a === b) return true;
	if (NAMES.includes(k)) return fold(a) === fold(b);
	if (k === "opening_hours") return allDay(a) === allDay(b);
	if (k.endsWith(":output")) return Number.parseFloat(a) === Number.parseFloat(b);
	if (k === "phone" || k === "fax") return digits(a) === digits(b);
	if (k === "website") return site(a) === site(b);
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

/** Tag operations that turn the element's tags into what the source says; nothing for what already agrees. */
export function updateOps(proposed: ProposedTag[], current: Record<string, string>): TagOp[] {
	const ops: TagOp[] = addressOps(
		proposed.filter((p) => p.group === "addr"),
		current,
	);
	for (const p of proposed) {
		if (p.group === "addr" || RULED_OUT[p.k]?.(current)) continue;
		const k = keyOn(p.k, current);
		const elsewhere = SAME_AS[p.k]?.filter((o) => o !== k);
		if (elsewhere?.some((o) => current[o] && digits(current[o]) === digits(p.v))) continue;
		const had = current[k];
		if (had === undefined) ops.push({ ...p, k, op: "add", was: null });
		else if (!p.addOnly && !sameValue(p.k, p.v, had)) ops.push({ ...p, k, op: "mod", was: had });
	}
	const typed = ops.find((o) => /^socket:(?!unknown)[^:]+$/.test(o.k));
	if (typed)
		for (const k of UNTYPED)
			if (current[k] !== undefined) ops.push({ ...typed, k, v: current[k], op: "del", was: null });
	return ops;
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

type Placed = Pick<Extraction, "lat" | "lon" | "tags" | "refs">;

/** Objects of the record's kind other than `el`, nearest to it (or to the record) first. */
function kinOf(x: Placed, el: OsmElement | null, els: OsmElement[]) {
	const main = x.tags.find((t) => MAIN.includes(t.k));
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
 * something else (another school in the same building) is not one of them.
 */
export function splitParts(
	x: Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name">,
	el: OsmElement,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]> = new Map(),
	shared: Set<string> = new Set(),
): { e: OsmElement; d: number }[] {
	const names = [x.name, el.tags.name].filter(Boolean);
	const open = x.tags.find((t) => t.k === "access")?.v === "yes";
	const samePlace = (e: OsmElement) => {
		if (e.tags.name && !names.some((n) => nameSimilarity(n, e.tags.name) >= NAME_MATCH))
			return false;
		if (otherStation(e, x.refs)) return false;
		const who = whoSimilarity(x, e);
		if (who !== null && who < NAME_MATCH) return false;
		return !(open && /^(private|no|customers)$/.test(e.tags.access ?? ""));
	};
	const near = (kinOf(x, el, els)?.kin ?? []).filter(
		(k) => k.d <= SPLIT_RADIUS_M && samePlace(k.e),
	);
	const byRef = refHits(x, refIndex, shared, SITE_REFS)
		.filter(({ e }) => osmRef(e) !== osmRef(el) && !near.some((k) => k.e === e))
		.map(({ e }) => ({ e, d: distance(el.lat, el.lon, e.lat, e.lon) }));
	return [...near, ...byRef].sort((a, b) => a.d - b.d);
}

/**
 * What a "new" record may already be mapped as: the nearest object of its kind, and the
 * nearest one mapped as something it may have been taken for (a charge point, a bare school
 * building), each within 150 m, or 300 m when run by the same operator or at the same address.
 */
function duplicates(x: Placed, els: OsmElement[]): string[] {
	const main = x.tags.find((t) => MAIN.includes(t.k));
	if (!main) return [];
	const at = addressOf(tagsOf(x));
	const reach = (e: OsmElement, d: number) =>
		d <= DUPLICATE_RADIUS_M ||
		(d <= SAME_OPERATOR_RADIUS_M && (whoAgrees(x, e) || (!!at && addressOf(e.tags) === at)));
	const nearest = (kind: (tags: Record<string, string>) => boolean) =>
		els
			.filter((e) => kind(e.tags) && !otherPlace(e, x.refs))
			.map((e) => ({ e, d: distance(x.lat, x.lon, e.lat, e.lon) }))
			.filter(({ e, d }) => reach(e, d))
			.sort((a, b) => a.d - b.d)[0];
	const kin = nearest((tags) => sameKind(main.k, main.v, tags));
	const alike = nearest(
		(tags) => lookalike(main.k, main.v, tags) && !sameKind(main.k, main.v, tags),
	);
	return [kin, alike]
		.filter((n) => n !== undefined)
		.map(({ e, d }) => {
			const k = [...MAIN, "man_made", "building"].find((key) => e.tags[key]) ?? main.k;
			return `Possible duplicate: ${k}=${e.tags[k]} already mapped at ${label(e, d)}`;
		});
}

/** What a reviewer must check before trusting this match, or this "new". */
export function matchWarnings(
	x: Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name">,
	el: OsmElement | null,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]> = new Map(),
	shared: Set<string> = new Set(),
): string[] {
	if (!el) return duplicates(x, els);
	const out: string[] = [];
	const d = distance(x.lat, x.lon, el.lat, el.lon);
	if (d > DUPLICATE_RADIUS_M)
		out.push(`Matched to ${label(el, d)} from the source's point: check it is this place`);
	const amenity = x.tags.find((t) => t.k === "amenity" && SCHOOLS.includes(t.v));
	if (amenity && schoolBuilding(el.tags))
		out.push(
			`OSM maps this school only as building=${el.tags.building}: amenity=${amenity.v} is added to the building`,
		);
	const split = splitParts(x, el, els, refIndex, shared);
	if (split.length)
		out.push(
			`Same site may be mapped as ${split.length + 1} objects (also ${split.map((k) => label(k.e, k.d)).join("; ")}): what is written here would land on this one only`,
		);
	return out;
}

/** Two "new" records this close are likely one place the source lists twice. */
const TWIN_RADIUS_M = 10;

function twinReason(a: Extraction, b: Extraction): string | null {
	if (Math.abs(a.lat - b.lat) < LAT_PREFILTER) {
		const d = distance(a.lat, a.lon, b.lat, b.lon);
		if (d <= TWIN_RADIUS_M) return `lies ${Math.round(d)} m away`;
	}
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
	return ops
		.filter((o) => o.op === "mod")
		.map((o) => `OSM has ${o.k}=${o.was} where the source says ${o.v}${why}`);
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
