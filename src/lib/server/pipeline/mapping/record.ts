import { coord } from "../row";
import type { ProposedTag } from "../types";
import type { Program } from "./compile";
import type { EvaluatedTag } from "./evaluate";

/** What a reader needs of a row before the record it belongs to is made: its key, point and address. */
export interface Head {
	key: string | null;
	position: [number, number] | null;
	skip: boolean;
	/** The line to ask the address base for, empty where the row has none. */
	address: string;
}

type Context = Record<string, unknown>;

/** The values a program's rules see for a record's rows, and how to run one of them, naming the rule that fails. */
export function scopeOf(program: Program, given: Record<string, string>[]) {
	const rows = given.map((row) =>
		Object.fromEntries(program.inputs.map((input) => [input, row[input] ?? ""])),
	);
	const context: Context = { ...rows[0] };
	if (program.grouped) context.rows = rows;
	const run = (check: { run: (c: Context) => unknown }, where: string) => {
		try {
			return check.run(context);
		} catch (error) {
			throw new Error(`${program.id} ${where}: ${(error as Error).message.split("\n")[0]}`);
		}
	};
	return { rows, context, run };
}

/** One row's key, point, skip and address, evaluating only the lets they need. */
export function readRecord(program: Program, row: Record<string, string>): Head {
	const { context, run } = scopeOf(program, [row]);
	const { record } = program;
	for (const { name, check } of record.lets) context[name] = run(check, `let.${name}`);
	return {
		key: String(run(record.key, "record.key")) || null,
		position: coord(run(record.lat, "record.lat"), run(record.lon, "record.lon")),
		skip: !!record.skip && !!run(record.skip, "record.skip"),
		address: record.address ? String(run(record.address, "record.address")) : "",
	};
}

/** Addresses this close to the point are one site as far as the point can tell. */
const ONE_ADDRESS_M = 100;

/**
 * One key over several sites comes as several rows, each at the one point the source has for the
 * key: the main site is the one whose address is at that point (`gaps`, from `addressGaps`). Where
 * the address base cannot tell, or several are as near, the `tieBreak` input's shortest value
 * wins, the main row carrying the plain name and its annexes a suffix.
 */
export function pickRow<R>(
	program: Program,
	rows: R[],
	inputs: (row: R) => Record<string, string>,
	gaps?: Map<R, number>,
): R {
	const { pick, tieBreak } = program.record;
	if (pick !== "nearest" || rows.length === 1) return rows[0];
	const gap = (r: R) => gaps?.get(r) ?? Number.POSITIVE_INFINITY;
	const nearest = Math.min(...rows.map(gap));
	const size = (r: R) => (tieBreak ? (inputs(r)[tieBreak] ?? "").length : 0);
	return rows.filter((r) => gap(r) <= nearest + ONE_ADDRESS_M).sort((a, b) => size(a) - size(b))[0];
}

type Inputs = Record<string, string>;

/** Another record's rows under input names, where the read has any. */
export type RowsOf = (key: string) => Inputs[] | undefined;

/** Says a record is not a place of its own, given the inputs the mapping declares it reads and the rest of the read. */
export type SkipFunction = (reads: Inputs, rowsOf: RowsOf) => boolean;

/**
 * Given every row of a key at its several sites (the inputs it reads) and which of them is the
 * record's, completes the record's proposed tags in place (`also`, a value) and answers lines for
 * the reviewer.
 */
export type SitesFunction = (rows: Inputs[], main: number, tags: ProposedTag[]) => string[];

/** Lines for the reviewer about a record, from the inputs the mapping declares it reads. */
export type NotesFunction = (reads: Inputs) => string[];

const readsOf = (reads: string[], row: Inputs): Inputs =>
	Object.fromEntries(reads.map((input) => [input, row[input] ?? ""]));

const registered = <F>(table: Record<string, F>, name: string, program: Program): F => {
	const found = table[name];
	if (!found) throw new Error(`${program.id}: function ${name} is not registered`);
	return found;
};

/** Whether the mapping's `skipBy` function says this record is no place of its own. */
export function skippedBy(
	program: Program,
	table: Record<string, SkipFunction>,
	row: Inputs,
	rowsOf: RowsOf = () => undefined,
): boolean {
	const by = program.record.skipBy;
	return !!by && registered(table, by.function, program)(readsOf(by.reads, row), rowsOf);
}

/** Runs the mapping's `sitesBy` function over the key's rows; the lines it answers. */
export function settledBy(
	program: Program,
	table: Record<string, SitesFunction>,
	rows: Inputs[],
	main: number,
	tags: ProposedTag[],
): string[] {
	const by = program.record.sitesBy;
	if (!by) return [];
	return registered(table, by.function, program)(
		rows.map((row) => readsOf(by.reads, row)),
		main,
		tags,
	);
}

/** The lines the mapping's `notesBy` function answers for a record's first row. */
export function notedBy(program: Program, table: Record<string, NotesFunction>, row: Inputs) {
	const by = program.record.notesBy;
	return by ? registered(table, by.function, program)(readsOf(by.reads, row)) : [];
}

const MOST_VALUES_SHOWN = 3;

interface Shown {
	input: string;
	value: string;
}

/** What an evidence row quotes: each input under the column it came from, its value marked. */
function quoting(program: Program, shown: Shown[]) {
	const column = (input: string) => program.columnOf.get(input) ?? input;
	return {
		path: shown[0] ? column(shown[0].input) : "",
		parts: shown.flatMap(({ input, value }, i) => [
			{ text: `${i > 0 ? ", " : ""}${column(input)}: `, mark: false },
			{ text: value || "—", mark: true },
		]),
	};
}

/** What says a record has closed: the inputs `record.closed` read, each quoted with the column it came from. */
export function closedEvidence(program: Program, row: Record<string, string>) {
	const { path, parts } = quoting(
		program,
		program.record.closedReads.map((input) => ({ input, value: row[input] ?? "" })),
	);
	return { path, kind: "dataset row", parts };
}

/**
 * A record's tags as the queue holds them, each with the evidence row it quotes: the input a
 * function says it read, else the tag's `quote`, else what its rule read. Of several inputs, the
 * ones with no value are left out, unless none has one. Of a record's several rows, an input
 * shows its distinct values in row order, three at most.
 */
export function proposedTags(
	program: Program,
	tags: EvaluatedTag[],
	rows: Record<string, string>[],
): ProposedTag[] {
	const values = (input: string) => {
		const distinct = [...new Set(rows.map((row) => row[input] ?? "").filter((v) => v !== ""))];
		return distinct.length > MOST_VALUES_SHOWN
			? `${distinct.slice(0, MOST_VALUES_SHOWN).join(", ")}, …`
			: distinct.join(", ");
	};
	const shown = (t: EvaluatedTag): Shown[] => {
		if (t.evidence)
			return [{ input: t.evidence.input, value: t.evidence.shown ?? values(t.evidence.input) }];
		const given = (t.quote ?? t.reads).map((input) => ({ input, value: values(input) }));
		const present = given.filter((s) => s.value !== "");
		return present.length > 0 ? present : given.slice(0, 1);
	};
	return tags.map((t) => {
		const { path, parts } = quoting(program, shown(t));
		return {
			k: t.key,
			v: t.value,
			conf: t.conf,
			path,
			kind: t.evidence?.kind ?? t.kind ?? "dataset row",
			parts,
			...(t.addOnly ? { addOnly: true } : {}),
			...(t.unless ? { unless: t.unless } : {}),
			...(t.mappedWithin ? { mappedWithin: t.mappedWithin } : {}),
			...(t.group ? { group: t.group } : {}),
		};
	});
}
