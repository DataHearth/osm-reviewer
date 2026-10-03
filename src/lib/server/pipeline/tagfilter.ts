/** `socket:*` allows everything under the prefix; a bare key allows exactly that key. An empty list restricts nothing. */
export function allowedBy(patterns: string[], key: string): boolean {
	if (patterns.length === 0) return true;
	return patterns.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));
}

export interface Selector {
	k: string;
	/** Null matches any value. */
	v: string[] | null;
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

/** What a source's extracted tags say its records are, so a filter written for one kind still finds the other. */
export function selectorsFromTags(tags: { k: string; v: string }[]): Selector[] {
	const byKey = new Map<string, Set<string>>();
	for (const t of tags) {
		if (!MAIN_KEYS.includes(t.k)) continue;
		byKey.set(t.k, (byKey.get(t.k) ?? new Set()).add(t.v));
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
	if (s.v === null) return `[${q(s.k)}]`;
	if (s.v.length === 1) return `[${q(s.k)}=${q(s.v[0])}]`;
	return `[${q(s.k)}~${q(`^(${s.v.map(reEscape).join("|")})$`)}]`;
}
