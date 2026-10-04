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

/**
 * Kinds a mapper picks between for one place, so a record of one finds the others: a lycée's
 * STS is often mapped as the lycée's school, a private post-bac school as a university, and a
 * medico-social institute as a school. `amenity=kindergarten` is a crèche in France, another
 * place altogether.
 */
const SCHOOLS = ["school", "college", "university"];
const KIN: Record<string, Record<string, string[]>> = {
	amenity: {
		school: SCHOOLS,
		college: SCHOOLS,
		university: SCHOOLS,
		social_facility: ["social_facility", "school"],
	},
};

export const kinValues = (k: string, v: string) => KIN[k]?.[v] ?? [v];

/** What a source's extracted tags say its records are, so a filter written for one kind still finds the other. */
export function selectorsFromTags(tags: { k: string; v: string }[]): Selector[] {
	const byKey = new Map<string, Set<string>>();
	for (const t of tags) {
		if (!MAIN_KEYS.includes(t.k)) continue;
		const set = byKey.get(t.k) ?? new Set();
		for (const v of kinValues(t.k, t.v)) set.add(v);
		byKey.set(t.k, set);
	}
	return [...byKey].map(([k, v]) => ({ k, v: [...v] }));
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
