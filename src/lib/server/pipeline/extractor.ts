import { COUNTRIES } from "./fr/country";
import { functions, notesFunctions, sitesFunctions, skipFunctions, steps } from "./fr/functions";
import { distance } from "./geo";
import { columnsByInput, compile, inputsOf, type Program } from "./mapping/compile";
import { evaluate } from "./mapping/evaluate";
import { mappingFor, programFor } from "./mapping/files";
import {
	closedEvidence,
	type Head,
	notedBy,
	pickRow,
	proposedTags,
	readRecord,
	settledBy,
	skippedBy,
} from "./mapping/record";
import { stepColumns } from "./mapping/rename";
import type { Renaming } from "./mapping/schema";
import type { Extraction, Row } from "./types";

type Inputs = Record<string, string>;

/**
 * What a source's columns are read through: the shipped renaming the source's kind of place has,
 * and which column of the source is which input of its mapping, which is that renaming's own or
 * a stored one the model made.
 */
export interface Table {
	shipped: Renaming;
	/** Source column to mapping input, in the order the columns are tried. */
	rename: Record<string, string>;
	/** A model's table: source column to the step that reads it and the column of the shipped file it stands for. */
	steps: Record<string, { name: string; as: string }>;
	/** Whether the table is the shipped renaming itself, which is what its overrides apply to. */
	own: boolean;
}

const own = new Map<string, Table>();

/** The shipped renaming read as a table: one per file, so what is built from it is built once. */
export function shippedTable(shipped: Renaming): Table {
	const known = own.get(shipped.source);
	if (known) return known;
	const table: Table = { shipped, rename: shipped.rename, steps: {}, own: true };
	own.set(shipped.source, table);
	return table;
}

/** What an extractor needs to read the rows of one source: the table, and how a record's rows are rebuilt and joined into sites. */
export interface Extractor {
	/** The mapping whose rules make this source's tags, such as `FR:school`. */
	mapping: string;
	/** The source column its own stable id lives in, which is also how a record is looked up again. */
	keyField: string | null;
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
	/** The country's address base, for a mapping whose records carry a `geocode`. */
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
 * Code a source's shipped renaming declares for what is cleaning specific to one register. It
 * reads the register's own columns, which a table gives it under the shipped file's names.
 */
export interface Step {
	/**
	 * Rebuilds a record's rows before the mapping reads them: the inputs it takes from them, and
	 * what it gathered besides, which the mapping's functions receive. Null when it finds no place.
	 */
	rebuild?(rows: Row[], inputs: (row: Row) => Inputs): { inputs: Inputs[]; site: unknown } | null;
	site?(row: Row): string | null;
	link?(row: Row, record: Row[]): SiteLink[];
}

const stepsOf = (shipped: Renaming): Step[] =>
	(shipped.steps ?? []).map((s) => {
		const found = steps[s.name];
		if (!found) throw new Error(`${shipped.source}: step ${s.name} is not registered`);
		return found;
	});

function programOf(table: Table): Program {
	const { shipped } = table;
	if (table.own) return programFor(shipped.source);
	// A step reads the shipped file's columns, so a table with steps is read through that file's names.
	if ((shipped.steps ?? []).length > 0)
		return {
			...programFor(shipped.source, { overrides: false }),
			columnOf: columnsByInput(Object.entries(table.rename)),
		};
	const { program, problems } = compile(mappingFor(shipped.mapping), {
		...shipped,
		columns: Object.keys(table.rename),
		rename: table.rename,
		ignored: {},
		overrides: undefined,
		steps: undefined,
		examples: undefined,
	});
	if (!program) throw new Error(`${shipped.mapping}: ${problems.join("; ")}`);
	return program;
}

/** The input a record's key is read from: the one that groups its rows, else the only one its rule reads. */
export function keyInput(program: Program): string | null {
	if (program.record.groupBy) return program.record.groupBy;
	const read = [...program.record.key.names].filter((n) => program.inputs.includes(n));
	return read.length === 1 ? read[0] : null;
}

/** The column of a table that holds the record's key, where its mapping says which input does. */
export function keyColumnOf(table: Table): string | null {
	const input = keyInput(programFor(table.shipped.source));
	return (input && columnsByInput(Object.entries(table.rename)).get(input)) || null;
}

const built = new WeakMap<Table, Extractor>();

/** The extractor for rows read through a table, made once per table. */
export function extractorOf(table: Table): Extractor {
	const known = built.get(table);
	if (known) return known;
	const made = build(table);
	built.set(table, made);
	return made;
}

function build(table: Table): Extractor {
	const program = programOf(table);
	const code = stepsOf(table.shipped);
	const rebuild = code.find((s) => s.rebuild)?.rebuild;
	const site = code.find((s) => s.site)?.site;
	const link = code.find((s) => s.link)?.link;

	const native = !table.own && code.length > 0 ? stepColumns(table.shipped, table) : null;
	const named = new WeakMap<Row, Row>();
	const toNative = (row: Row): Row => {
		if (!native) return row;
		const known = named.get(row);
		if (known) return known;
		const out: Row = {};
		for (const [column, as] of native) if (column in row) out[as] = row[column];
		named.set(row, out);
		return out;
	};
	const nativeInputs = (row: Row) => inputsOf(program, row);
	const toInputs = (row: Row) => nativeInputs(toNative(row));

	const heads = new WeakMap<Row, Head>();
	const head = (row: Row) => {
		let known = heads.get(row);
		if (!known) {
			known = readRecord(program, toInputs(row));
			heads.set(row, known);
		}
		return known;
	};
	const key = (row: Row) => head(row).key;

	return {
		mapping: table.shipped.mapping,
		keyField: keyColumnOf(table),
		key,
		position: (row) => head(row).position,
		skip: (row) => head(row).skip,
		siteQuery: (row) => (program.record.pick ? head(row).address || null : null),
		address: COUNTRIES[program.id.split(":")[0]]?.address,
		site: site && ((row) => site(toNative(row))),
		link: link && ((row, record) => link(toNative(row), record.map(toNative))),
		extract(rows, url, gaps, rowsOf) {
			let given: Inputs[];
			let gathered: unknown;
			let main = 0;
			if (rebuild) {
				const rebuilt = rebuild(rows.map(toNative), nativeInputs);
				if (!rebuilt) return null;
				given = rebuilt.inputs;
				gathered = rebuilt.site;
			} else {
				const picked = pickRow(program, rows, toInputs, gaps);
				main = rows.indexOf(picked);
				given = [toInputs(picked)];
			}
			if (skippedBy(program, skipFunctions, given[0], rowsOf && ((k) => rowsOf(k)?.map(toInputs))))
				return null;
			const made = evaluate(program, given, functions, gathered);
			// The key `mergeSites` gave the record, whichever of its rows is newest.
			const keyed = rows
				.map(key)
				.filter((k) => k !== null)
				.sort((a, b) => a.localeCompare(b))[0];
			if (!made?.position || !keyed) return null;

			const tags = proposedTags(program, made.tags, given);
			const settled = program.record.sitesBy
				? settledBy(program, sitesFunctions, rows.map(toInputs), main, tags)
				: [];
			return {
				key: keyed,
				kind: program.id,
				url,
				name: tags.find((t) => t.k === "name")?.v ?? made.name,
				addr: made.addr,
				lat: made.position[0],
				lon: made.position[1],
				closedBy: made.closed ? closedEvidence(program, given[0]) : undefined,
				refs: made.refs,
				tags,
				fit: made.fit,
				absent: made.absent,
				notes: [...settled, ...made.notes, ...notedBy(program, notesFunctions, given[0])],
				geocode: made.geocode,
				withheld: made.withheld,
			};
		},
	};
}

/** The extractor for rows in the shipped renaming's own columns. */
export const shippedExtractor = (shipped: Renaming): Extractor =>
	extractorOf(shippedTable(shipped));

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
	extractor: Pick<Extractor, "siteQuery" | "position" | "address">,
): Promise<Map<Row, number>> {
	const gaps = new Map<Row, number>();
	for (const r of rows) {
		const q = extractor.siteQuery?.(r);
		const pos = extractor.position(r);
		const at = q && pos ? await extractor.address?.locate(q) : null;
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
	extractor: Extractor | null | undefined,
): R[] {
	const site = extractor?.site;
	if (!extractor || !site) return records;
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
	const link = extractor.link;
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
			const at = extractor.position(row);
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
