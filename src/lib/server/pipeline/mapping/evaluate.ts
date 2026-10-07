import { COUNTRIES } from "../fr/country";
import { MAILBOX } from "../fr/mailbox";
import { coord } from "../row";
import type { Program } from "./compile";
import { scopeOf } from "./record";

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
	/** The inputs the evidence shows instead of `reads`, when the tag names some. */
	quote?: string[];
	/** What the evidence says of the value, where the tag declares it. */
	kind?: string;
}

/** An input the value was read from, what to show of it where it is not the input's own text, and how it was got. */
export interface Evidence {
	input: string;
	shown?: string;
	kind?: string;
}

/**
 * What a function may say about one tag beyond its value: where a record's tags differ in trust or
 * evidence, and what it found about the record that no tag carries. An answer with an empty
 * value proposes no tag but its `ref`, `absent`, `fit` and `notes` still count.
 */
export interface Answer {
	value: string;
	conf?: number;
	addOnly?: boolean;
	evidence?: Evidence;
	/** For a `ref` tag, the identifiers to match on where they are not the tag's own value. */
	ref?: string;
	/** Keys the source rules out: an object still carrying one is shown to the reviewer, not edited. */
	absent?: string[];
	/** Counts the source lists but does not propose, weighed only when telling which object is the place. */
	fit?: { k: string; v: string }[];
	/** Lines for the reviewer, after the mapping's own. */
	notes?: string[];
}

export interface Evaluated {
	key: string;
	position: [number, number] | null;
	closed: boolean;
	tags: EvaluatedTag[];
	notes: string[];
	/** Each `ref` tag's key and the identifiers it matches on. */
	refs: Record<string, string>;
	absent: string[];
	fit: { k: string; v: string }[];
	/** Where to ask the address base about the record, and how far its point may sit from the answer. */
	geocode?: { q: string; farM: number; wrongM?: number };
	/** How many of `record.withheld`'s inputs read as a phone number or a mailbox and reach no tag. */
	withheld: number;
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
	const { rows, context, run } = scopeOf(program, given);

	for (const { name, check } of program.lets) context[name] = run(check, `let.${name}`);
	const { record } = program;
	if (record.skip && run(record.skip, "record.skip")) return null;

	const tags: EvaluatedTag[] = [];
	const refs: Record<string, string> = {};
	const absent: string[] = [];
	const fit: { k: string; v: string }[] = [];
	const found: string[] = [];
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
			const given: Answer = typeof answer === "string" ? { value: answer } : answer;
			if (!key.endsWith("*") && k !== key) continue;
			absent.push(...(given.absent ?? []));
			fit.push(...(given.fit ?? []));
			found.push(...(given.notes ?? []));
			const ref = given.ref ?? given.value;
			if (tag.ref && ref !== "") refs[k] = ref;
			if (given.value === "") continue;
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
				...(tag.quote ? { quote: tag.quote } : {}),
				...(tag.kind ? { kind: tag.kind } : {}),
			});
		}
	}

	const farM =
		record.farM === null || typeof record.farM === "number"
			? record.farM
			: Number(run(record.farM, "record.farM"));
	const address = record.address ? String(run(record.address, "record.address")) : "";
	const reached = new Set(tags.flatMap((t) => t.reads));
	const country = COUNTRIES[program.id.split(":")[0]];
	const withheld = record.withheld.filter((input) => {
		const v = rows[0][input];
		return v !== "" && !reached.has(input) && (country?.phone(v) != null || MAILBOX.test(v));
	}).length;

	return {
		key: String(run(record.key, "record.key")),
		position: coord(run(record.lat, "record.lat"), run(record.lon, "record.lon")),
		closed: record.closed ? !!run(record.closed, "record.closed") : false,
		tags,
		notes: [
			...program.notes.filter((n) => run(n.when, `notes.${n.text}`)).map((n) => n.text),
			...found,
		],
		refs,
		absent,
		fit,
		geocode: address
			? {
					q: address,
					farM: farM !== null && farM > 0 ? farM : Number.POSITIVE_INFINITY,
					...(record.wrongM ? { wrongM: record.wrongM } : {}),
				}
			: undefined,
		withheld,
	};
}
