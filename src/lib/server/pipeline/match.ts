import { distance, nameSimilarity, normaliseName } from "./geo";
import { kinValues, type Selector } from "./tagfilter";
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
/** Degrees of latitude a bit over the match radius: a cheap cut before the haversine. */
const LAT_PREFILTER = 0.0006;

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

/** `FR*TLS*P31555019` belongs to operator `FRTLS`. */
const operatorCodes = (v: string) =>
	new Set(ids(v).flatMap((x) => /^[A-Z]{2}[A-Z0-9]{3}(?=[EP])/.exec(x)?.[0] ?? []));

/**
 * Whether `e` carries only another operator's EVSE ids. A mapper's pool id is often finer than
 * the registry's, so whole ids prove nothing, but the operator code does. It only rules out a
 * name or distance match: a network that changed hands keeps its old code on OSM, and the
 * duplicate banner must still see it.
 */
function otherOperator(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = operatorCodes(refs["ref:EU:EVSE"] ?? "");
	const theirs = operatorCodes(e.tags["ref:EU:EVSE"] ?? "");
	return ours.size > 0 && theirs.size > 0 && ![...theirs].some((x) => ours.has(x));
}

const refKeys = (refs: Record<string, string>) =>
	Object.entries(refs).flatMap(([k, v]) => [...new Set(ids(v))].map((one) => `${k}\u0000${one}`));

/**
 * Identifiers several records carry, which therefore pick none of them: a SIRET is the
 * organisation's, and one organisation can run several establishments.
 */
/** Fetched whatever else they carry: a school ground tagged only `building=school` still has its UAI. */
export const REF_SELECTORS: Record<string, Selector[]> = {
	"ref:UAI": ALIASES["ref:UAI"].map((k) => ({ k, v: null })),
};

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
				const v = e.tags[alias];
				if (!v) continue;
				for (const one of ids(v)) {
					const at = `${key}\u0000${one}`;
					const list = idx.get(at) ?? [];
					if (!list.includes(e)) idx.set(at, [...list, e]);
				}
			}
	return idx;
}

/** Who runs a place, which an OSM object with no name often still says. */
const WHO = ["operator", "network", "brand"];

/** How well the record's operator or network agrees with an unnamed object's; null when either side says nothing. */
function whoSimilarity(x: Pick<Extraction, "tags">, e: OsmElement): number | null {
	const ours = (x.tags ?? []).filter((t) => WHO.includes(t.k)).map((t) => t.v);
	const theirs = WHO.map((k) => e.tags[k]).filter(Boolean);
	if (!ours.length || !theirs.length) return null;
	return Math.max(...ours.flatMap((a) => theirs.map((b) => nameSimilarity(a, b))));
}

export function findMatch(
	x: Pick<Extraction, "lat" | "lon" | "name" | "refs"> & Partial<Pick<Extraction, "tags">>,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string> = new Set(),
): OsmElement | null {
	const hits = refKeys(x.refs)
		.filter((at) => !shared.has(at))
		.flatMap((at) => refIndex.get(at) ?? []);
	const byRef = hits
		.filter((e) => !otherPlace(e, x.refs))
		.map((e) => ({ e, d: distance(x.lat, x.lon, e.lat, e.lon) }))
		.sort((a, b) => a.d - b.d)[0];
	if (byRef) return byRef.e;

	let best: { el: OsmElement; score: number } | null = null;
	for (const e of els) {
		if (otherPlace(e, x.refs) || otherOperator(e, x.refs)) continue;
		if (Math.abs(e.lat - x.lat) > LAT_PREFILTER) continue;
		const d = distance(x.lat, x.lon, e.lat, e.lon);
		if (d > MATCH_RADIUS_M) continue;
		const en = e.tags.name;
		// Most charging stations on OSM have no name, and the registry places them up to tens of
		// metres off; the operator agreeing is what lets one match beyond a coincident point.
		const who = en ? null : whoSimilarity({ tags: x.tags ?? [] }, e);
		const sim =
			en && x.name ? nameSimilarity(x.name, en) : who !== null && who >= NAME_MATCH ? who : null;
		const ok = sim === null ? d <= BARE_RADIUS_M : sim >= NAME_MATCH;
		if (!ok) continue;
		const score = (sim ?? 0.4) - d / 1000;
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
	/^(Mo-Su )?00:00-(24:00|23:5\d)$/.test(s.trim()) ? "24/7" : s.trim();

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
		return sa.size === sb.size && [...sa].every((x) => sb.has(x));
	}
	return a.trim() === b.trim();
}

export interface TagOp extends ProposedTag {
	op: "add" | "mod" | "del";
	was: string | null;
}

const CONTACT = ["phone", "website", "email", "fax", "mobile"];

/** A detail the object may already carry under another key: a station's phone is usually its operator's line. */
const SAME_AS: Record<string, string[]> = { "operator:phone": ["phone", "contact:phone"] };

/**
 * The key this object keeps `k` under: mappers write contact details as `contact:phone`
 * as often as `phone`, and an object already using the `contact:` scheme gets the new
 * detail in the same scheme rather than a second copy beside it.
 */
function keyOn(k: string, current: Record<string, string>): string {
	if (current[k] !== undefined || !CONTACT.includes(k)) return k;
	const scheme = `contact:${k}`;
	if (current[scheme] !== undefined) return scheme;
	return Object.keys(current).some((x) => x.startsWith("contact:")) ? scheme : k;
}

/** Tag operations that turn the element's tags into what the source says; nothing for what already agrees. */
export function updateOps(proposed: ProposedTag[], current: Record<string, string>): TagOp[] {
	const clash = new Set(
		proposed
			.filter((p) => p.group && current[p.k] !== undefined && !sameValue(p.k, p.v, current[p.k]))
			.map((p) => p.group),
	);
	const ops: TagOp[] = [];
	for (const p of proposed) {
		if (p.group && clash.has(p.group)) continue;
		if (SAME_AS[p.k]?.some((o) => current[o] && digits(current[o]) === digits(p.v))) continue;
		const k = keyOn(p.k, current);
		const had = current[k];
		if (had === undefined) ops.push({ ...p, k, op: "add", was: null });
		else if (!p.addOnly && !sameValue(p.k, p.v, had)) ops.push({ ...p, k, op: "mod", was: had });
	}
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

const kinOf = (
	x: Pick<Extraction, "lat" | "lon" | "tags" | "refs">,
	el: OsmElement | null,
	els: OsmElement[],
) => {
	const main = x.tags.find((t) => MAIN.includes(t.k));
	if (!main) return null;
	const from = el ?? x;
	const kin = kinValues(main.k, main.v);
	const near = els
		.filter((e) => kin.includes(e.tags[main.k]) && (!el || osmRef(e) !== osmRef(el)))
		.filter((e) => !otherPlace(e, x.refs))
		.map((e) => ({ e, d: distance(from.lat, from.lon, e.lat, e.lon) }))
		.sort((a, b) => a.d - b.d);
	return { main, kin: near };
};

/**
 * The other objects the matched site is mapped as. A neighbour named for something else
 * (another school in the same building) is not one of them.
 */
export function splitParts(
	x: Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name">,
	el: OsmElement,
	els: OsmElement[],
): { e: OsmElement; d: number }[] {
	const names = [x.name, el.tags.name].filter(Boolean);
	const samePlace = (e: OsmElement) =>
		!e.tags.name || names.some((n) => nameSimilarity(n, e.tags.name) >= NAME_MATCH);
	return (kinOf(x, el, els)?.kin ?? []).filter((k) => k.d <= SPLIT_RADIUS_M && samePlace(k.e));
}

/** What a reviewer must check before trusting this match, or this "new". */
export function matchWarnings(
	x: Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name">,
	el: OsmElement | null,
	els: OsmElement[],
): string[] {
	if (!el) {
		const found = kinOf(x, null, els);
		const near = found?.kin[0];
		return found && near && near.d <= DUPLICATE_RADIUS_M
			? [
					`Possible duplicate: ${found.main.k}=${found.main.v} already mapped at ${label(near.e, near.d)}`,
				]
			: [];
	}
	const split = splitParts(x, el, els);
	return split.length
		? [
				`Same site may be mapped as ${split.length + 1} objects (also ${split.map((k) => label(k.e, k.d)).join("; ")}): what is written here would land on this one only`,
			]
		: [];
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
 * What tells a reviewer this is the right object comes first: the identifiers and level it
 * already carries. The address, which rarely settles it, comes last.
 */
const CONTEXT_KEYS = [
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
	return k.startsWith("addr:") ? CONTEXT_KEYS.length : -1;
};

/** The element's tags the candidate leaves alone, the ones a reviewer looks at for context. */
export function unchangedTags(current: Record<string, string>, touched: Set<string>) {
	return Object.entries(current)
		.filter(([k]) => !touched.has(k) && contextRank(k) >= 0)
		.sort(([a], [b]) => contextRank(a) - contextRank(b))
		.slice(0, 6)
		.map(([k, v]) => ({ k, v }));
}
