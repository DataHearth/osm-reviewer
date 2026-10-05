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
	/** Where a function says the value was read, when it knows better than the rule's `reads`. */
	evidence?: Evidence;
	/** The mapping inputs the rule read; `Program.columnOf` names the columns they came from. */
	reads: string[];
}

/** An input the value was read from, what to show of it where it is not the input's own text, and how it was got. */
export interface Evidence {
	input: string;
	shown?: string;
	kind?: string;
}

/** What a function may say about one tag beyond its value: where a record's tags differ in trust or evidence. */
export interface Answer {
	value: string;
	conf?: number;
	addOnly?: boolean;
	evidence?: Evidence;
}

export interface Evaluated {
	key: string;
	position: [number, number] | null;
	closed: boolean;
	tags: EvaluatedTag[];
	notes: string[];
}

/**
 * Code the app ships for a tag no rule can write; it answers with the tags it makes, none when
 * it is not sure. `site` is what a code step gathered about the record beyond its rows, opaque
 * here: a function that needs it works from the rows alone when there is none.
 */
export type TagFunction = (
	reads: Record<string, string>,
	rows: Record<string, string>[],
	site?: unknown,
) => Record<string, string | Answer | undefined>;

/** Rows are one record's, already under input names. Null when the record is skipped. */
export function evaluate(
	program: Program,
	given: Record<string, string>[],
	functions: Record<string, TagFunction> = {},
	site?: unknown,
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
	for (const { key, tag, conf: compiledConf, value, fill, unless, reads } of program.tags) {
		const made: Record<string, string | Answer | undefined> = value
			? { [key]: String(run(value, `tags.${key}`)) }
			: (functions[(tag as { function: string }).function]?.(
					Object.fromEntries(reads.map((r) => [r, rows[0][r]])),
					rows,
					site,
				) ?? {});
		const conf =
			typeof compiledConf === "number"
				? compiledConf
				: Number(run(compiledConf, `tags.${key}.conf`));
		const addOnly = typeof fill === "boolean" ? fill : !!run(fill, `tags.${key}.fill`);
		const unlessValue = unless ? String(run(unless, `tags.${key}.unless.value`)) : null;
		for (const [k, answer] of Object.entries(made)) {
			if (answer === undefined) continue;
			const given = typeof answer === "string" ? { value: answer } : answer;
			if (given.value === "" || (!key.endsWith("*") && k !== key)) continue;
			tags.push({
				key: k,
				value: given.value,
				conf: given.conf ?? conf,
				rule: tag.rule,
				evidence: given.evidence,
				addOnly: given.addOnly ?? addOnly,
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
