import { coord } from "../row";
import type { Program } from "./compile";

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

/** What says a record has closed: the inputs `record.closed` read, each quoted with the column it came from. */
export function closedEvidence(program: Program, row: Record<string, string>) {
	const quoted = program.record.closedReads.map((input) => ({
		column: program.columnOf.get(input) ?? input,
		value: row[input] ?? "",
	}));
	return {
		path: quoted[0]?.column ?? "",
		kind: "dataset row",
		parts: quoted.flatMap(({ column, value }, i) => [
			{ text: `${i > 0 ? ", " : ""}${column}: `, mark: false },
			{ text: value || "—", mark: true },
		]),
	};
}
