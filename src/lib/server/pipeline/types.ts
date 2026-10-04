export type Row = Record<string, unknown>;

/** One thing a source said, before any OSM tag is proposed for it. */
export interface RawRecord {
	key: string;
	url: string;
	/** A station is several rows in the IRVE file, a school one; the preset decides what a record is made of. */
	rows: Row[];
	/** Crawl only: the page text, and the OSM element the page was found through. */
	text?: string;
	element?: OsmElement;
	/** Crawl: the page reads as it did last run, so the model is not asked again. */
	unchanged?: boolean;
}

export interface ProposedTag {
	k: string;
	v: string;
	conf: number;
	/** Field path the value came from, or the page path. */
	path: string;
	/** What the evidence panel shows: the quoted text, with the span relied on marked. */
	parts: { text: string; mark: boolean }[];
	kind: string;
	/** Proposed only where OSM has no value: the source is too coarse to overrule what a mapper set. */
	addOnly?: boolean;
	/**
	 * Tags that only make sense together, like an address's parts: when one of them differs
	 * from what the object has, none of them is proposed.
	 */
	group?: string;
	/** Why the value cannot be written as it stands; the reviewer sees it and has to type over it. */
	invalid?: string;
	/**
	 * Other values the same source gives for this key (another row of one establishment
	 * listed at several sites): OSM holding any of them agrees with the source.
	 */
	also?: string[];
}

export interface Extraction {
	key: string;
	url: string;
	name: string;
	addr: string;
	lat: number;
	lon: number;
	/** What says the place has closed, when something does. */
	closedBy?: { path: string; parts: { text: string; mark: boolean }[]; kind: string };
	/** Identifiers OSM may already carry, matched before any distance is looked at. */
	refs: Record<string, string>;
	tags: ProposedTag[];
	/** Keys the source rules out: an OSM object still carrying one is shown to the reviewer, not edited. */
	absent?: string[];
	/** What the source says that no tag can carry, for the reviewer to weigh. */
	notes?: string[];
	/**
	 * The address to ask the national address base for, and how far the source's point may
	 * sit from its housenumber before the point is the one taken to be wrong.
	 */
	geocode?: { q: string; farM: number };
	/**
	 * Where the address base places the record's own housenumber, on a street that agrees
	 * with the source's. Set by `placeAddress`; the point moves there only once matching at
	 * the source's own point has had its say (`settlePoints`).
	 */
	atAddress?: { lat: number; lon: number; label: string };
	/** The source's own point, when the record was moved off it to its address. */
	from?: { lat: number; lon: number };
	/** Contact details the source gave that read as a person's own, and were left out. */
	withheld?: number;
}

export interface OsmElement {
	type: "node" | "way" | "relation";
	id: number;
	version: number;
	user?: string;
	lat: number;
	lon: number;
	tags: Record<string, string>;
}

export class PipelineError extends Error {}

export const osmRef = (e: Pick<OsmElement, "type" | "id">) => `${e.type}/${e.id}`;
