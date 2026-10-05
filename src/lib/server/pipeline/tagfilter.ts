import { institute, KIN, LOOKALIKE_KINDS, SCHOOLS } from "./fr/kinds";

/** `socket:*` allows everything under the prefix; a bare key allows exactly that key. An empty list restricts nothing. */
export function allowedBy(patterns: string[], key: string): boolean {
	if (patterns.length === 0) return true;
	return patterns.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));
}

export interface Selector {
	k: string;
	/** Null matches any value. */
	v: string[] | null;
	/** Elements to leave out even when they match. */
	not?: { k: string; v: string[] };
}

const TERM = /^([A-Za-z0-9_:]+)=(\S+)$/;

/**
 * `amenity=school amenity=kindergarten`, `shop=bakery|butcher`, `website=*`; terms are
 * alternatives. A term without `=` is not one, so the legacy free text a fixture source
 * carries parses to nothing and counts as no filter.
 */
export function parseMatching(text: string): Selector[] {
	const out: Selector[] = [];
	for (const raw of text.split(/[\s,;]+/)) {
		const m = TERM.exec(raw);
		if (!m) continue;
		out.push({ k: m[1], v: m[2] === "*" ? null : m[2].split("|") });
	}
	return out;
}

const MAIN_KEYS = [
	"amenity",
	"shop",
	"office",
	"tourism",
	"leisure",
	"craft",
	"healthcare",
	"public_transport",
];

const kinValues = (k: string, v: string) => KIN[k]?.[v] ?? [v];

/** Whether an object tagged `tags` is a `k=v` place as some mapper would have mapped it. */
export function sameKind(k: string, v: string, tags: Record<string, string>): boolean {
	if (!tags[k] || !kinValues(k, v).includes(tags[k])) return false;
	return tags[k] !== "social_facility" || institute(tags);
}

/** A school mapped as nothing but its building. */
export const schoolBuilding = (tags: Record<string, string>) =>
	SCHOOLS.includes(tags.building) && !MAIN_KEYS.some((k) => tags[k]);

/**
 * What a place may be mapped as without being one to match against: a station drawn only as
 * its charge points or as the car park it equips, an institute mapped as the health centre it
 * shares an address with, a maternelle mapped as a kindergarten. They are fetched so a "new"
 * one is checked against them, and for nothing else.
 */
const LOOKALIKES: Record<string, Selector[]> = {
	"amenity=charging_station": [
		{ k: "man_made", v: ["charge_point"] },
		{ k: "capacity:charging", v: null },
	],
	...LOOKALIKE_KINDS,
};

export const lookalikeSelectors = (tags: { k: string; v: string }[]) =>
	mergeSelectors(...tags.map((t) => LOOKALIKES[`${t.k}=${t.v}`] ?? []));

/** Places a bare school building may stand for: a school, or an institute's classrooms. */
const IN_SCHOOL_BUILDINGS = [...SCHOOLS, "social_facility"];

/**
 * Whether an object may be a `k=v` place mapped as something else. A school building with no
 * name is matched by nothing, so it is only ever seen here.
 */
export function lookalike(k: string, v: string, tags: Record<string, string>): boolean {
	if (k === "amenity" && IN_SCHOOL_BUILDINGS.includes(v) && schoolBuilding(tags) && !tags.name)
		return true;
	return (LOOKALIKES[`${k}=${v}`] ?? []).some((s) => selects(s, tags));
}

/** What a source's extracted tags say its records are, so a filter written for one kind still finds the other. */
export function selectorsFromTags(tags: { k: string; v: string }[]): Selector[] {
	const byKey = new Map<string, Set<string>>();
	for (const t of tags) {
		if (!MAIN_KEYS.includes(t.k)) continue;
		const set = byKey.get(t.k) ?? new Set();
		for (const v of kinValues(t.k, t.v)) set.add(v);
		byKey.set(t.k, set);
	}
	const out = [...byKey].map(([k, v]) => ({ k, v: [...v] }));
	// Many schools are mapped as nothing but their building.
	if (SCHOOLS.some((v) => byKey.get("amenity")?.has(v))) out.push({ k: "building", v: SCHOOLS });
	return out;
}

/** Whether an object with these tags is one `s` fetches. */
export function selects(s: Selector, tags: Record<string, string>): boolean {
	const v = tags[s.k];
	if (v === undefined || (s.v !== null && !s.v.includes(v))) return false;
	return !s.not?.v.includes(tags[s.not.k] ?? "");
}

export function mergeSelectors(...lists: Selector[][]): Selector[] {
	const seen = new Map<string, Selector>();
	for (const s of lists.flat()) {
		const key = `${s.k}=${s.v ? [...s.v].sort().join("|") : "*"}`;
		seen.set(key, s);
	}
	return [...seen.values()];
}

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The bracket filter of one Overpass statement. */
export function overpassFilter(s: Selector): string {
	const not = s.not ? `[${q(s.not.k)}!~${q(`^(${s.not.v.map(reEscape).join("|")})$`)}]` : "";
	if (s.v === null) return `[${q(s.k)}]${not}`;
	if (s.v.length === 1) return `[${q(s.k)}=${q(s.v[0])}]${not}`;
	return `[${q(s.k)}~${q(`^(${s.v.map(reEscape).join("|")})$`)}]${not}`;
}
