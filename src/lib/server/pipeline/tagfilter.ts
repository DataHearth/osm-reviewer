import { kinValues, registry, selectorKeys } from "./match/kinds";

/** `phone:*` allows everything under the prefix; a bare key allows exactly that key. An empty list restricts nothing. */
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
 * `shop=bakery shop=deli`, `shop=bakery|butcher`, `website=*`; terms are
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

/** Whether an object tagged `tags` is a `k=v` place as some mapper would have mapped it. */
export function sameKind(k: string, v: string, tags: Record<string, string>): boolean {
	if (!tags[k] || !kinValues(k, v).includes(tags[k])) return false;
	const accepts = registry().accepts.get(`${k}=${tags[k]}`);
	return accepts ? accepts(tags) : true;
}

/** A place mapped as nothing but its building. */
export function shell(tags: Record<string, string>): boolean {
	const s = registry().shell;
	return !!s && s.v.includes(tags[s.k]) && !selectorKeys().some((k) => tags[k]);
}

/** Whether a record of `k=v` stands for the place a shell is the building of. */
const hasShell = (k: string, v: string) => {
	const s = registry().shell;
	return !!s && k === s.of && kinValues(k, v).some((x) => s.v.includes(x));
};

export const lookalikeSelectors = (tags: { k: string; v: string }[]) =>
	mergeSelectors(...tags.map((t) => registry().lookalikes.get(`${t.k}=${t.v}`) ?? []));

/**
 * Whether an object may be a `k=v` place mapped as something else. A shell with no name is
 * matched by nothing, so it is only ever seen here.
 */
export function lookalike(k: string, v: string, tags: Record<string, string>): boolean {
	if (hasShell(k, v) && shell(tags) && !tags.name) return true;
	return (registry().lookalikes.get(`${k}=${v}`) ?? []).some((s) => selects(s, tags));
}

/** The key of the first selector that makes an object a lookalike of `k=v`, which is the tag a reviewer sees it by. */
export const lookalikeKey = (k: string, v: string, tags: Record<string, string>) =>
	(registry().lookalikes.get(`${k}=${v}`) ?? []).find((s) => selects(s, tags))?.k;

/** What a source's extracted tags say its records are, so a filter written for one kind still finds the other. */
export function selectorsFromTags(tags: { k: string; v: string }[]): Selector[] {
	const keys = selectorKeys();
	const byKey = new Map<string, Set<string>>();
	for (const t of tags) {
		if (!keys.includes(t.k)) continue;
		const set = byKey.get(t.k) ?? new Set();
		for (const v of kinValues(t.k, t.v)) set.add(v);
		byKey.set(t.k, set);
	}
	const out = [...byKey].map(([k, v]) => ({ k, v: [...v] }));
	const s = registry().shell;
	if (s?.v.some((v) => byKey.get(s.of)?.has(v))) out.push({ k: s.k, v: s.v });
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
