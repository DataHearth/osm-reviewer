import { distance } from "../geo";
import type { Selector } from "../tagfilter";
import { ids } from "../text";
import type { Extraction, OsmElement } from "../types";
import { registry, type Scheme } from "./kinds";
import type { Level } from "./kit";
import { DUPLICATE_RADIUS_M } from "./radii";

const schemes = () => registry().schemes;

const looseKey = (at: string) => at.includes("\u0000~");

const keysOf = (k: string, v: string) => schemes().get(k)?.keys?.(v) ?? [...new Set(ids(v))];

const refKeys = (refs: Record<string, string>) =>
	Object.entries(refs).flatMap(([k, v]) => keysOf(k, v).map((one) => `${k}\u0000${one}`));

export const refSelectors = (key: string): Selector[] => schemes().get(key)?.fetch ?? [];

/** The ids an object carries under a scheme: its alias tags and whatever the scheme reads besides. */
const held = (s: Scheme, e: OsmElement) =>
	s.holds?.(e) ?? [...s.aliases.map((a) => e.tags[a]), s.also?.(e)].filter(Boolean).join(";");

/** Every id `e` carries under `key`, in the scheme's own forms. */
export const idsOn = (key: string, e: OsmElement): string[] => {
	const s = schemes().get(key);
	return s ? keysOf(key, held(s, e)) : [];
};

const withLevel = (level: Level) => [...schemes().values()].filter((s) => s.rules === level);

/**
 * Whether `e` carries ids of a scheme that rules objects out and none of them is the record's:
 * another place. `hard` objects are never a hit, a candidate, a kin, a site part or a namesake;
 * `soft` ones only block a name or distance match, a site part and a namesake, so the duplicate
 * banner still sees them.
 */
export function rulesOut(e: OsmElement, refs: Record<string, string>, level: Level): boolean {
	for (const s of withLevel(level)) {
		const ours = keysOf(s.key, refs[s.key] ?? "");
		const theirs = keysOf(s.key, held(s, e));
		if (!ours.length || !theirs.length) continue;
		const related = s.related ?? ((a: string, b: string) => a === b);
		if (!theirs.some((t) => ours.some((o) => related(t, o)))) return true;
	}
	return false;
}

/** Whether `e` carries an id of a scheme that rules out `hard`. */
export const carriesHard = (e: OsmElement) =>
	withLevel("hard").some((s) => idsOn(s.key, e).length > 0);

/**
 * Whether `e` carries, besides the record's own id of a `hard` scheme, another's, under the keys
 * mappers write it on (never the mailbox that also names one).
 */
export function heldWithOthers(e: OsmElement, refs: Record<string, string>): boolean {
	return withLevel("hard").some((s) => {
		const ours = keysOf(s.key, refs[s.key] ?? "");
		return (
			ours.length > 0 &&
			s.aliases.some((a) => keysOf(s.key, e.tags[a] ?? "").some((id) => !ours.includes(id)))
		);
	});
}

/** Whether an object names an establishment through some other tag than its id (a mailbox). */
export const namesOne = (e: Pick<OsmElement, "tags">) =>
	[...schemes().values()].some((s) => s.also?.(e) !== undefined);

export const hardKeys = () => withLevel("hard").map((s) => s.key);

export const neverReplaced = (key: string) => schemes().get(key)?.neverReplace;

/** The ids that name an establishment-like thing, never replaced, with the noun a banner calls it. */
export const neverReplaceKeys = () =>
	[...schemes().values()]
		.filter((s) => s.neverReplace)
		.map((s) => ({ key: s.key, noun: s.neverReplace as string }));

/** The organisation-level ids, which name who runs a place and not the place, with their labels. */
export const organisations = () =>
	[...schemes().values()]
		.filter((s) => s.organisation)
		.map((s) => ({ key: s.key, label: s.organisation as string }));

export const rivalOf = (e: OsmElement) =>
	withLevel("soft")
		.map((s) => s.rival?.(e))
		.find(Boolean);

/**
 * Identifiers several records carry, which therefore pick none of them: an
 * organisation's id is carried by every place it runs.
 */
export function sharedRefs(xs: Pick<Extraction, "refs">[]): Set<string> {
	const seen = new Set<string>();
	const shared = new Set<string>();
	for (const x of xs) for (const at of refKeys(x.refs)) (seen.has(at) ? shared : seen).add(at);
	return shared;
}

/** Every element per identifier: an id can sit on several objects. */
export function indexRefs(els: OsmElement[], keys: string[]): Map<string, OsmElement[]> {
	const idx = new Map<string, OsmElement[]>();
	for (const key of keys) {
		const s = schemes().get(key);
		for (const alias of s?.aliases ?? [key])
			for (const e of els) {
				const v = [e.tags[alias], s?.also?.(e)].filter(Boolean).join(";");
				for (const one of keysOf(key, v)) {
					const at = `${key}\u0000${one}`;
					const list = idx.get(at) ?? [];
					if (!list.includes(e)) idx.set(at, [...list, e]);
				}
			}
	}
	return idx;
}

/**
 * The objects carrying one of the record's own identifiers, nearest first. A pool id's bare
 * tail is weaker than the whole id, so it is believed only as far off as a misplaced point.
 */
export function refHits(
	x: Pick<Extraction, "lat" | "lon" | "refs">,
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
	keys?: string[],
): { e: OsmElement; d: number }[] {
	const found = new Map<OsmElement, number>();
	for (const at of refKeys(x.refs)) {
		if (shared.has(at) || (keys && !keys.includes(at.split("\u0000")[0]))) continue;
		for (const e of refIndex.get(at) ?? []) {
			if (found.has(e) || rulesOut(e, x.refs, "hard")) continue;
			const d = distance(x.lat, x.lon, e.lat, e.lon);
			if (!looseKey(at) || d <= DUPLICATE_RADIUS_M) found.set(e, d);
		}
	}
	return [...found].map(([e, d]) => ({ e, d })).sort((a, b) => a.d - b.d);
}

export const siteRefs = () => [...schemes().values()].filter((s) => s.site).map((s) => s.key);
