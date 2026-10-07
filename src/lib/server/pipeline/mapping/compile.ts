import { str } from "../row";
import type { Row } from "../types";
import { type Checked, Scope } from "./cel";
import { type Mapping, type Renaming, type Tag, tagSchema } from "./schema";

type Ok = Extract<Checked, { ok: true }>;

export interface CompiledTag {
	key: string;
	tag: Tag;
	conf: Ok | number;
	/** Present for a tag written as a rule; a tag made by a shipped function has none. */
	value: Ok | null;
	fill: Ok | boolean;
	unless: Ok | null;
	/** The mapping inputs the tag's rule reads, lets followed. */
	reads: string[];
}

export interface Program {
	id: string;
	inputs: string[];
	grouped: boolean;
	/** Which source column an input came from, for the evidence panel (the first listed where several are renamed to it); empty without a renaming. */
	columnOf: ReadonlyMap<string, string>;
	rename: ReadonlyMap<string, string>;
	lets: { name: string; check: Ok }[];
	record: {
		key: Ok;
		lat: Ok;
		lon: Ok;
		groupBy: string | null;
		skip: Ok | null;
		closed: Ok | null;
		/** The inputs `closed` read, which are its evidence. */
		closedReads: string[];
		address: Ok | null;
		/** Metres, or a rule giving them; null where the record carries no address to move to. */
		farM: Ok | number | null;
		wrongM: number | null;
		pick: "nearest" | null;
		tieBreak: string | null;
		withheld: string[];
		/** The lets the key, position, skip and address need, in order: all a reader evaluates beside them. */
		lets: { name: string; check: Ok }[];
	};
	tags: CompiledTag[];
	notes: { text: string; when: Ok }[];
}

/** An override replaces the mapping's rule for a tag; one that switches kind drops the other kind's fields. */
function mergeTags(mapping: Mapping, renaming: Renaming | undefined, problems: string[]) {
	const merged: Record<string, Tag> = { ...mapping.tags };
	for (const [key, override] of Object.entries(renaming?.overrides?.tags ?? {})) {
		if (override === null) {
			delete merged[key];
			continue;
		}
		const base: Record<string, unknown> = { ...merged[key] };
		if ("value" in override) {
			delete base.function;
			delete base.reads;
		}
		if ("function" in override) delete base.value;
		const parsed = tagSchema.safeParse({ ...base, ...override });
		if (parsed.success) merged[key] = parsed.data;
		else problems.push(`overrides.tags.${key}: ${parsed.error.issues[0]?.message}`);
	}
	return merged;
}

/**
 * Type-checks every rule against the declared inputs and merges a renaming's overrides. A program
 * comes back only when nothing is wrong. An input nothing reads is the mapping's fault, so it is
 * reported only when compiling the mapping alone: an override may drop the last rule that read one.
 */
export function compile(
	mapping: Mapping,
	renaming?: Renaming,
): { program: Program | null; problems: string[] } {
	const problems: string[] = [];
	const inputs = Object.keys(mapping.inputs);
	const isInput = new Set(inputs);
	const groupBy = mapping.record.groupBy ?? null;
	const scope = new Scope(inputs, groupBy !== null);
	const read = new Set<string>();
	const letReads = new Map<string, Set<string>>();
	const letNames = new Map<string, ReadonlySet<string>>();

	const readsOf = (names: ReadonlySet<string>) => {
		const reads = new Set<string>();
		for (const n of names) {
			if (isInput.has(n)) reads.add(n);
			for (const r of letReads.get(n) ?? []) reads.add(r);
		}
		for (const r of reads) read.add(r);
		return [...reads];
	};

	const check = (source: string, where: string, type: "string" | "bool" | "double"): Ok | null => {
		const checked = scope.check(source);
		if (!checked.ok) {
			problems.push(`${where}: ${checked.error}`);
			return null;
		}
		if (checked.type !== type) {
			problems.push(`${where}: gives ${checked.type}, expected ${type}`);
			return null;
		}
		readsOf(checked.names);
		return checked;
	};

	const lets: Program["lets"] = [];
	for (const [name, source] of Object.entries(mapping.let ?? {})) {
		const checked = scope.check(source);
		if (!checked.ok) {
			problems.push(`let.${name}: ${checked.error}`);
			continue;
		}
		letReads.set(name, new Set(readsOf(checked.names)));
		letNames.set(name, checked.names);
		scope.declare(name, checked.type);
		lets.push({ name, check: checked });
	}

	const { record } = mapping;
	if (groupBy !== null && !isInput.has(groupBy)) {
		problems.push(`record.groupBy: "${groupBy}" is not an input`);
	} else if (groupBy !== null) {
		read.add(groupBy);
	}
	const key = check(record.key, "record.key", "string");
	const lat = check(record.lat, "record.lat", "string");
	const lon = check(record.lon, "record.lon", "string");
	const skip = record.skip ? check(record.skip, "record.skip", "bool") : null;
	const closed = record.closed ? check(record.closed, "record.closed", "bool") : null;
	const closedReads = closed ? readsOf(closed.names) : [];
	const address = record.address ? check(record.address, "record.address", "string") : null;
	const farM =
		typeof record.farM === "string"
			? check(record.farM, "record.farM", "double")
			: (record.farM ?? null);
	for (const key of ["farM", "wrongM"] as const)
		if (record[key] !== undefined && !address)
			problems.push(`record.${key}: there is no record.address`);
	if (record.pick && !address) problems.push("record.pick: there is no record.address");
	if (record.pick && groupBy !== null)
		problems.push("record.pick: a record that picks one of its rows cannot also group them");
	if (record.tieBreak && !record.pick) problems.push("record.tieBreak: there is no record.pick");
	for (const input of [...(record.tieBreak ? [record.tieBreak] : []), ...(record.withheld ?? [])])
		if (!isInput.has(input)) problems.push(`record: "${input}" is not an input`);
	if (record.tieBreak) read.add(record.tieBreak);

	const tags: CompiledTag[] = [];
	for (const [tagKey, tag] of Object.entries(mergeTags(mapping, renaming, problems))) {
		const where = `tags.${tagKey}`;
		const fill =
			typeof tag.fill === "string" ? check(tag.fill, `${where}.fill`, "bool") : !!tag.fill;
		const unless = tag.unless ? check(tag.unless.value, `${where}.unless.value`, "string") : null;
		const conf =
			typeof tag.conf === "string" ? check(tag.conf, `${where}.conf`, "double") : tag.conf;
		let value: Ok | null = null;
		let reads: string[];
		for (const q of tag.quote ?? []) {
			if (isInput.has(q)) read.add(q);
			else problems.push(`${where}.quote: "${q}" is not an input`);
		}
		if ("function" in tag) {
			for (const r of tag.reads) {
				if (isInput.has(r)) read.add(r);
				else problems.push(`${where}: reads "${r}", which is not an input`);
			}
			reads = tag.reads;
		} else {
			value = check(tag.value, where, "string");
			reads = value ? readsOf(value.names) : [];
		}
		if (fill === null || conf === null || ("value" in tag && value === null)) continue;
		tags.push({ key: tagKey, tag, conf, value, fill, unless, reads });
	}

	const notes: Program["notes"] = [];
	for (const [i, note] of (mapping.notes ?? []).entries()) {
		const when = check(note.when, `notes[${i}].when`, "bool");
		if (when) notes.push({ text: note.text, when });
	}

	for (const input of inputs) {
		if (!renaming && !read.has(input)) problems.push(`input "${input}" is read by nothing`);
	}
	if (problems.length > 0 || !key || !lat || !lon) return { program: null, problems };

	const rename = new Map(Object.entries(renaming?.rename ?? {}));
	const columnOf = new Map<string, string>();
	for (const [column, input] of rename) if (!columnOf.has(input)) columnOf.set(input, column);
	const recordLets = new Set<string>();
	const need = (name: string) => {
		const own = letNames.get(name);
		if (!own || recordLets.has(name)) return;
		recordLets.add(name);
		for (const n of own) need(n);
	};
	for (const c of [key, lat, lon, skip, address]) for (const n of c?.names ?? []) need(n);
	return {
		program: {
			id: mapping.id,
			inputs,
			grouped: groupBy !== null,
			columnOf,
			rename,
			lets,
			record: {
				key,
				lat,
				lon,
				groupBy,
				skip,
				closed,
				closedReads,
				address,
				farM,
				wrongM: record.wrongM ?? null,
				pick: record.pick ?? null,
				tieBreak: record.tieBreak ?? null,
				withheld: record.withheld ?? [],
				lets: lets.filter((l) => recordLets.has(l.name)),
			},
			tags,
			notes,
		},
		problems,
	};
}

/**
 * A source row under the mapping's input names; columns the renaming does not name are dropped.
 * Where several columns are renamed to one input, the first of them, in the order the renaming
 * lists them, that holds a value gives it.
 */
export function renameRow(program: Program, row: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [column, input] of program.rename) {
		if (column in row && !(out[input] ?? "").trim()) out[input] = row[column];
	}
	return out;
}

/** A source row, whatever its values' types, under the mapping's input names. */
export const inputsOf = (program: Program, row: Row): Record<string, string> =>
	renameRow(
		program,
		Object.fromEntries([...program.rename.keys()].map((column) => [column, str(row, column)])),
	);
