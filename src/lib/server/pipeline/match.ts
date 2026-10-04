import { distance, nameSimilarity } from "./geo";
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

/** Identifiers that name one establishment, so an object carrying another value is another place. */
const ONE_PLACE = ["ref:UAI"];

/** Whether `e` carries one of these identifiers with a value the record does not have. */
function otherPlace(e: OsmElement, refs: Record<string, string>): boolean {
	return ONE_PLACE.some((k) => {
		if (!refs[k]) return false;
		const ours = new Set(ids(refs[k]));
		return (ALIASES[k] ?? [k]).some((alias) => {
			const v = e.tags[alias];
			return v !== undefined && !ids(v).some((x) => ours.has(x));
		});
	});
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

export function findMatch(
	x: Pick<Extraction, "lat" | "lon" | "name" | "refs">,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
): OsmElement | null {
	const hits = Object.entries(x.refs).flatMap(([k, v]) =>
		ids(v).flatMap((one) => refIndex.get(`${k}\u0000${one}`) ?? []),
	);
	const byRef = hits
		.filter((e) => !otherPlace(e, x.refs))
		.map((e) => ({ e, d: distance(x.lat, x.lon, e.lat, e.lon) }))
		.sort((a, b) => a.d - b.d)[0];
	if (byRef) return byRef.e;

	let best: { el: OsmElement; score: number } | null = null;
	for (const e of els) {
		if (otherPlace(e, x.refs)) continue;
		if (Math.abs(e.lat - x.lat) > LAT_PREFILTER) continue;
		const d = distance(x.lat, x.lon, e.lat, e.lon);
		if (d > MATCH_RADIUS_M) continue;
		const en = e.tags.name;
		const sim = en && x.name ? nameSimilarity(x.name, en) : null;
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

/** Whether two values say the same thing, so a re-spaced phone number is not an edit. */
export function sameValue(k: string, a: string, b: string): boolean {
	if (a === b) return true;
	if (k === "phone" || k === "fax") return digits(a) === digits(b);
	if (k === "website") return site(a) === site(b);
	if (k.startsWith("ref:")) {
		const sa = new Set(ids(a));
		const sb = new Set(ids(b));
		return sa.size === sb.size && [...sa].every((x) => sb.has(x));
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

/** Tag operations that turn the element's tags into what the source says; nothing for what already agrees. */
export function updateOps(proposed: ProposedTag[], current: Record<string, string>): TagOp[] {
	const ops: TagOp[] = [];
	for (const p of proposed) {
		const had = current[p.k];
		if (had === undefined) ops.push({ ...p, op: "add", was: null });
		else if (!p.addOnly && !sameValue(p.k, p.v, had)) ops.push({ ...p, op: "mod", was: had });
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

const CONTEXT_KEYS = ["name", "opening_hours", "phone", "website", "operator", "brand"];

/** The element's tags the candidate leaves alone, the ones a reviewer looks at for context. */
export function unchangedTags(current: Record<string, string>, touched: Set<string>) {
	const picked = Object.entries(current).filter(
		([k]) => !touched.has(k) && (CONTEXT_KEYS.includes(k) || k.startsWith("addr:")),
	);
	return picked.slice(0, 6).map(([k, v]) => ({ k, v }));
}
