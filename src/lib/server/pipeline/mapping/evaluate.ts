import { coord } from "../row";
import type { Program } from "./compile";

export interface EvaluatedTag {
	key: string;
	value: string;
	conf: number;
	rule?: string;
	addOnly: boolean;
	unless?: { k: string; v: string };
	mappedWithin?: number;
	group?: string;
	/** The mapping inputs the rule read; `Program.columnOf` names the columns they came from. */
	reads: string[];
}

export interface Evaluated {
	key: string;
	position: [number, number] | null;
	closed: boolean;
	tags: EvaluatedTag[];
	notes: string[];
}

/** Code the app ships for a tag no rule can write; it answers with the tags it makes, none when it is not sure. */
export type TagFunction = (
	reads: Record<string, string>,
	rows: Record<string, string>[],
) => Record<string, string>;

/** Rows are one record's, already under input names. Null when the record is skipped. */
export function evaluate(
	program: Program,
	given: Record<string, string>[],
	functions: Record<string, TagFunction> = {},
): Evaluated | null {
	if (given.length === 0) throw new Error(`${program.id}: a record has at least one row`);
	if (given.length > 1 && !program.grouped) {
		throw new Error(`${program.id} has no record.groupBy, so a record is one row`);
	}
	const rows = given.map((row) =>
		Object.fromEntries(program.inputs.map((input) => [input, row[input] ?? ""])),
	);
	const context: Record<string, unknown> = { ...rows[0] };
	if (program.grouped) context.rows = rows;

	const run = (check: { run: (c: Record<string, unknown>) => unknown }, where: string) => {
		try {
			return check.run(context);
		} catch (error) {
			throw new Error(`${program.id} ${where}: ${(error as Error).message.split("\n")[0]}`);
		}
	};

	for (const { name, check } of program.lets) context[name] = run(check, `let.${name}`);
	const { record } = program;
	if (record.skip && run(record.skip, "record.skip")) return null;

	const tags: EvaluatedTag[] = [];
	for (const { key, tag, value, fill, unless, reads } of program.tags) {
		const made: Record<string, string> = value
			? { [key]: String(run(value, `tags.${key}`)) }
			: (functions[(tag as { function: string }).function]?.(
					Object.fromEntries(reads.map((r) => [r, rows[0][r]])),
					rows,
				) ?? {});
		const addOnly = typeof fill === "boolean" ? fill : !!run(fill, `tags.${key}.fill`);
		const unlessValue = unless ? String(run(unless, `tags.${key}.unless.value`)) : null;
		for (const [k, v] of Object.entries(made)) {
			if (v === "" || (!key.endsWith("*") && k !== key)) continue;
			tags.push({
				key: k,
				value: v,
				conf: tag.conf,
				rule: tag.rule,
				addOnly,
				unless: tag.unless && unlessValue ? { k: tag.unless.key, v: unlessValue } : undefined,
				mappedWithin: tag.mappedWithin,
				group: tag.group,
				reads,
			});
		}
	}

	return {
		key: String(run(record.key, "record.key")),
		position: coord(run(record.lat, "record.lat"), run(record.lon, "record.lon")),
		closed: record.closed ? !!run(record.closed, "record.closed") : false,
		tags,
		notes: program.notes.filter((n) => run(n.when, `notes.${n.text}`)).map((n) => n.text),
	};
}
