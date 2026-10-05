import { otherPlace, schemes } from "../fr/school";
import { distance } from "../geo";
import type { Selector } from "../tagfilter";
import { ids } from "../text";
import type { Extraction, OsmElement } from "../types";
import { evse } from "./charging";
import { DUPLICATE_RADIUS_M } from "./radii";

/**
 * How one identifier is carried on OSM objects and compared. A key with no scheme is carried
 * under its own name and compared whole.
 */
export interface RefScheme {
	/** Keys OSM mappers have used for the same identifier. */
	aliases?: string[];
	/** The identifier read off the object some other way than under its keys. */
	also?(e: OsmElement): string | undefined;
	/** Every form a value is found under. One starting with `~` is weaker, and believed only nearby. */
	keys?(v: string): string[];
	/** What to fetch so that an object carrying it is found whatever else it is mapped as. */
	selectors?: Selector[];
	/** Names one site, where a SIRET is the whole organisation's. */
	site?: boolean;
}

const SCHEMES: Record<string, RefScheme> = {
	"ref:EU:EVSE": evse,
	...schemes,
};

const looseKey = (at: string) => at.includes("\u0000~");

const keysOf = (k: string, v: string) => SCHEMES[k]?.keys?.(v) ?? [...new Set(ids(v))];

const refKeys = (refs: Record<string, string>) =>
	Object.entries(refs).flatMap(([k, v]) => keysOf(k, v).map((one) => `${k}\u0000${one}`));

export const refSelectors = (key: string) => SCHEMES[key]?.selectors ?? [];

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
		for (const alias of SCHEMES[key]?.aliases ?? [key])
			for (const e of els) {
				const v = [e.tags[alias], SCHEMES[key]?.also?.(e)].filter(Boolean).join(";");
				for (const one of keysOf(key, v)) {
					const at = `${key}\u0000${one}`;
					const list = idx.get(at) ?? [];
					if (!list.includes(e)) idx.set(at, [...list, e]);
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
			if (found.has(e) || otherPlace(e, x.refs)) continue;
			const d = distance(x.lat, x.lon, e.lat, e.lon);
			if (!looseKey(at) || d <= DUPLICATE_RADIUS_M) found.set(e, d);
		}
	}
	return [...found].map(([e, d]) => ({ e, d })).sort((a, b) => a.d - b.d);
}

export const SITE_REFS = Object.keys(SCHEMES).filter((k) => SCHEMES[k].site);
