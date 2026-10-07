import { distance } from "./geo";
import { inputsOf, type Program } from "./mapping/compile";
import { type Head, readRecord } from "./mapping/record";
import { str } from "./row";
import type { Extraction, ProposedTag, Row } from "./types";

export interface Preset {
	id: string;
	label: string;
	/** The mapping whose rules make this preset's tags, such as `FR:school`. */
	mapping: string;
	/** The shipped column renaming of the source the preset was written for, such as `fr/annuaire-education`: the columns its code reads. */
	source: string;
	/** The same preset reading through another compiled program of its mapping, such as one without the shipped source's overrides. */
	withProgram(program: Program): Preset;
	/** The column the source's own stable id lives in, which is also how a record is looked up again. */
	keyField: string;
	detect(columns: string[]): boolean;
	key(row: Row): string | null;
	position(row: Row): [number, number] | null;
	/** The mapping says this row is not a place: it is dropped from the read, and not counted as unreadable. */
	skip(row: Row): boolean;
	/**
	 * `rows` are every row that shares the key; `url` is the record's own address; `gaps`, for
	 * a key at several sites, how far each row's address lies from its point (`addressGaps`);
	 * `rowsOf`, another key's rows in the same read, where it has any.
	 */
	extract(
		rows: Row[],
		url: string,
		gaps?: Map<Row, number>,
		rowsOf?: (key: string) => Row[] | undefined,
	): Extraction | null;
	/** The country's address base, for a preset whose records carry a `geocode`. */
	address?: AddressBase;
	/** What to ask the address base for one row's own address, for a key at several sites. */
	siteQuery?(row: Row): string | null;
	/** Records whose rows give the same site are one place, whatever their keys say. */
	site?(row: Row): string | null;
	/**
	 * What names one thing in every declaration of it (a charge point's id), so records sharing
	 * one close enough are one site even where their keys and positions differ. `record` is
	 * every row of the record `row` belongs to.
	 */
	link?(row: Row, record: Row[]): SiteLink[];
}

/**
 * A row's key, position, skip and address line as the program's `record` block reads them. A
 * row is renamed and read once, however many of them are asked for. The address is asked for
 * only where the mapping picks among the rows of a key by it.
 */
export function readingOf(
	programOf: () => Program,
): Pick<Preset, "key" | "position" | "skip" | "siteQuery"> {
	const heads = new WeakMap<Row, Head>();
	const head = (row: Row) => {
		let known = heads.get(row);
		if (!known) {
			const program = programOf();
			known = readRecord(program, inputsOf(program, row));
			heads.set(row, known);
		}
		return known;
	};
	return {
		key: (row) => head(row).key,
		position: (row) => head(row).position,
		skip: (row) => head(row).skip,
		siteQuery: (row) => (programOf().record.pick ? head(row).address || null : null),
	};
}

/** What a country's address base answers. */
export interface AddressBase {
	/** The record with its address in the base's spelling, or without one, and where the base places it. */
	place(x: Extraction): Promise<Extraction>;
	/** Where the base places an address line, when it is sure of it: latitude, longitude. */
	locate(q: string): Promise<[number, number] | null>;
}

/**
 * For a key the source lists at several sites, how far each row's own address lies from the
 * row's point (Infinity where the base cannot place it): the site the point stands at is
 * the main one. The main row's question is the one `address.place` then asks again.
 */
export async function addressGaps(
	rows: Row[],
	preset: Pick<Preset, "siteQuery" | "position" | "address">,
): Promise<Map<Row, number>> {
	const gaps = new Map<Row, number>();
	for (const r of rows) {
		const q = preset.siteQuery?.(r);
		const pos = preset.position(r);
		const at = q && pos ? await preset.address?.locate(q) : null;
		gaps.set(r, pos && at ? distance(pos[0], pos[1], at[0], at[1]) : Number.POSITIVE_INFINITY);
	}
	return gaps;
}

export interface SiteLink {
	id: string;
	/** How far apart two declarations of it can be placed. */
	withinM: number;
	/**
	 * Set where the id names a place rather than a thing (a station's name): records sharing it
	 * join only when one of them is a lone charge point, the way some operators declare each
	 * point of a car park as a station, and two stations of one name otherwise stay two.
	 */
	lone?: boolean;
}

/**
 * Some operators declare every charge point of a car park as a station of its own, which
 * would make one candidate per point, all on the same spot, and a site re-declared under new
 * station ids keeps some of its point ids, often at a slightly different position. Records on
 * one site become one, under the smallest key, so an existing candidate keeps its id and the
 * others are swept as gone.
 */
export function mergeSites<R extends { key: string; rows: Row[] }>(
	records: R[],
	preset: Preset | null | undefined,
): R[] {
	const site = preset?.site;
	if (!preset || !site) return records;
	const bySite = new Map<string, R>();
	const out: R[] = [];
	for (const rec of [...records].sort((a, b) => a.key.localeCompare(b.key))) {
		const s = rec.rows[0] ? site(rec.rows[0]) : null;
		const into = s ? bySite.get(s) : undefined;
		if (into) {
			into.rows.push(...rec.rows);
			continue;
		}
		const own = { ...rec, rows: [...rec.rows] };
		if (s) bySite.set(s, own);
		out.push(own);
	}
	const link = preset.link;
	if (!link) return out;

	// `out` is in key order, so the root a record joins is always the one with the smaller key.
	const root = new Map<R, R>();
	const find = (r: R): R => {
		const up = root.get(r);
		return up ? find(up) : r;
	};
	const holders = new Map<string, { rec: R; at: [number, number]; lone?: boolean }[]>();
	for (const rec of out)
		for (const row of rec.rows) {
			const at = preset.position(row);
			if (!at) continue;
			for (const { id, withinM, lone } of link(row, rec.rows)) {
				const seen = holders.get(id) ?? [];
				for (const other of seen) {
					const a = find(other.rec);
					const b = find(rec);
					if (a === b || distance(at[0], at[1], other.at[0], other.at[1]) > withinM) continue;
					if (lone === false && other.lone === false) continue;
					if (out.indexOf(a) < out.indexOf(b)) root.set(b, a);
					else root.set(a, b);
				}
				if (!seen.some((o) => o.rec === rec)) holders.set(id, [...seen, { rec, at, lone }]);
			}
		}
	for (const rec of out) {
		const r = find(rec);
		if (r !== rec) r.rows.push(...rec.rows);
	}
	return out.filter((r) => find(r) === r);
}

export class Tags {
	readonly list: ProposedTag[] = [];
	constructor(private readonly row: Row) {}

	/** `field` names where `value` was read, and is what the evidence row quotes. */
	add(k: string, v: string, conf: number, field: string, shown?: string, kind = "dataset row") {
		if (!v) return;
		const value = shown ?? str(this.row, field);
		const tag: ProposedTag = {
			k,
			v,
			conf,
			path: field,
			kind,
			parts: [
				{ text: `${field}: `, mark: false },
				{ text: value || "—", mark: true },
			],
		};
		this.list.push(tag);
		return tag;
	}
}

/** Proposed only where OSM has nothing: the source is too coarse to overrule a mapper. */
export const fill = (tag: ProposedTag | undefined) => {
	if (tag) tag.addOnly = true;
};
