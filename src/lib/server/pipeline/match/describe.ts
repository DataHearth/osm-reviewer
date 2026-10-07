import { fold } from "../fr/text";
import { type Extraction, type OsmElement, osmRef } from "../types";

export const label = (e: OsmElement, d: number) =>
	`${osmRef(e)}${e.tags.name ? ` “${e.tags.name}”` : ""}, ${Math.round(d)} m away`;

export const tagsOf = (x: Pick<Extraction, "tags">) =>
	Object.fromEntries(x.tags.map((t) => [t.k, t.v]));

/** Housenumber and street, in whichever scheme the object holds them. */
export function addressOf(tags: Record<string, string>): string | null {
	const n = tags["addr:housenumber"] ?? tags["contact:housenumber"];
	const street = tags["addr:street"] ?? tags["contact:street"];
	return n && street ? `${fold(n)} ${fold(street)}` : null;
}

export type Placed = Pick<Extraction, "lat" | "lon" | "tags" | "refs" | "name" | "from"> &
	Partial<Pick<Extraction, "key" | "kind">>;

/** Each matched object's records in this run, by the object's OSM ref. */
export type MatchedBy = Map<string, Pick<Extraction, "key" | "name" | "tags" | "refs">[]>;

/** The run's other records matched to `e`. */
export const matchedElsewhere = (
	e: OsmElement,
	x: Partial<Pick<Extraction, "key">>,
	matchedBy: MatchedBy,
) => (matchedBy.get(osmRef(e)) ?? []).filter((o) => o.key !== x.key);
