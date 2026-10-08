import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { ZodType } from "zod";
import {
	functions,
	notesFunctions,
	steps as registeredSteps,
	sitesFunctions,
	skipFunctions,
} from "../fr/functions";
import { KITS } from "../kits";
import { lib } from "../match/kinds";
import { type KitFactory, METHODS } from "../match/kit";
import { allowedBy } from "../tagfilter";
import { compile, type Program, renameRow } from "./compile";
import { evaluate } from "./evaluate";
import {
	type Example,
	type Mapping,
	mappingSchema,
	type Official,
	type Renaming,
	renamingSchema,
} from "./schema";

export interface Report {
	file: string;
	summary: string;
	problems: string[];
}

const stable = (o: unknown) =>
	JSON.stringify(o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).sort() : o);

function yamlFiles(dir: string): string[] {
	try {
		return readdirSync(dir, { recursive: true, withFileTypes: true })
			.filter((e) => e.isFile() && e.name.endsWith(".yaml"))
			.map((e) => join(e.parentPath, e.name))
			.sort();
	} catch {
		return [];
	}
}

function load<T>(file: string, schema: ZodType<T>, problems: string[]): T | null {
	let raw: unknown;
	try {
		raw = parse(readFileSync(file, "utf8"));
	} catch (error) {
		problems.push(`not YAML: ${(error as Error).message.split("\n")[0]}`);
		return null;
	}
	const parsed = schema.safeParse(raw);
	if (parsed.success) return parsed.data;
	for (const issue of parsed.error.issues) {
		problems.push(`${issue.path.join(".") || "file"}: ${issue.message}`);
	}
	return null;
}

function runExamples(
	program: Program,
	examples: Pick<Example, "about" | "rows" | "expect" | "notes">[],
	toInputs: (row: Record<string, string>) => Record<string, string>,
	problems: string[],
): number {
	let passed = 0;
	for (const [i, example] of examples.entries()) {
		const label = `example ${i + 1} (${example.about})`;
		try {
			const got = evaluate(program, example.rows.map(toInputs), functions);
			const gotTags = got && Object.fromEntries(got.tags.map((t) => [t.key, t.value]));
			const tagsOk = stable(gotTags) === stable(example.expect);
			const notesOk = got === null || stable(got.notes) === stable(example.notes ?? []);
			if (tagsOk && notesOk) passed++;
			if (!tagsOk) {
				problems.push(`${label}: want ${stable(example.expect)}, got ${stable(gotTags)}`);
			}
			if (!notesOk) {
				problems.push(
					`${label}: notes want ${stable(example.notes ?? [])}, got ${stable(got?.notes)}`,
				);
			}
		} catch (error) {
			problems.push(`${label}: ${(error as Error).message}`);
		}
	}
	return passed;
}

/** Every function a mapping names is registered, and `any` or the mapping's country scopes it, then optionally its kind: `fr.school/name`. */
function checkFunctions(mapping: Mapping, problems: string[]) {
	const [country, kind] = mapping.id.toLowerCase().split(":");
	const named = [
		...Object.entries(mapping.tags).flatMap(([key, tag]) =>
			"function" in tag ? [{ where: `tags.${key}`, name: tag.function, table: functions }] : [],
		),
		...(
			[
				["skipBy", skipFunctions],
				["sitesBy", sitesFunctions],
				["notesBy", notesFunctions],
			] as const
		).flatMap(([by, table]) => {
			const own = mapping.record[by];
			return own ? [{ where: `record.${by}`, name: own.function, table }] : [];
		}),
	];
	for (const { where, name, table } of named) {
		if (!Object.hasOwn(table, name)) problems.push(`${where}: function ${name} is not registered`);
		const [scopeCountry, scopeKind] = name.split("/")[0].split(".");
		if (scopeCountry !== "any" && scopeCountry !== country) {
			problems.push(`${where}: function ${name} is scoped to another country`);
		} else if (scopeKind !== undefined && scopeKind !== kind) {
			problems.push(`${where}: function ${name} is scoped to another kind of place`);
		}
	}
}

/** A tag with no reads and no quote would show the reviewer an evidence row with nothing in it. */
function checkEvidence(program: Program, problems: string[]) {
	for (const { key, tag, reads } of program.tags) {
		if (reads.length === 0 && !tag.quote) {
			problems.push(`tags.${key}: reads no input and has no quote, so it has no evidence to show`);
		}
	}
}

/** What the block says a kind is: its keys are written and shown by the mapping, and its kit is its own. */
function checkMatching(mapping: Mapping, kits: Record<string, KitFactory>, problems: string[]) {
	const m = mapping.matching;
	const [country, kind] = mapping.id.toLowerCase().split(":");
	if (m.main.length === 0) problems.push("matching.main: names no key");
	for (const k of m.main) {
		if (!(k in mapping.tags)) problems.push(`matching.main: ${k} is not written by any tag`);
		if (!mapping.examples.some((e) => e.expect && k in e.expect))
			problems.push(`matching.main: no example expects ${k}`);
	}
	if (m.shell && !m.main.includes(m.shell.of))
		problems.push(`matching.shell.of: ${m.shell.of} is not among main`);
	for (const [table, pairs] of [
		["kin", m.kin],
		["lookalikes", m.lookalikes],
	] as const)
		for (const pair of Object.keys(pairs ?? {}))
			if (!m.main.includes(pair.split("=")[0]))
				problems.push(`matching.${table}.${pair}: its key is not among main`);
	for (const key of Object.keys(m.refs ?? {})) {
		const tag = mapping.tags[key];
		if (!tag?.ref) problems.push(`matching.refs.${key}: is not a tag with ref: true`);
	}
	if (!m.kit) return;
	const factory = kits[m.kit];
	if (!factory) {
		problems.push(`matching.kit: ${m.kit} is not registered in kits.ts`);
		return;
	}
	const [scopeCountry, scopeKind] = m.kit.split(".");
	if (scopeCountry !== "any" && scopeCountry !== country) {
		problems.push(`matching.kit: ${m.kit} is scoped to another country`);
	} else if (scopeKind !== kind) {
		problems.push(`matching.kit: ${m.kit} is scoped to another kind of place`);
	}
	const kit = factory(lib());
	const members = [...METHODS, "words", "accepts", "lookalikes", "same", "refs"];
	for (const member of Object.keys(kit))
		if (!members.includes(member)) problems.push(`matching.kit: ${m.kit} has unknown ${member}`);
	const named = (what: string, table: object | undefined, declared: object | undefined) => {
		for (const key of Object.keys(table ?? {}))
			if (!(key in (declared ?? {})))
				problems.push(
					`matching.kit: ${m.kit} has ${what} ${key}, which the block does not declare`,
				);
	};
	named("accepts", kit.accepts, m.kin);
	named("lookalikes", kit.lookalikes, m.lookalikes);
	named("refs", kit.refs, m.refs);
	for (const key of Object.keys(kit.same ?? {}))
		if (!(key.split(".")[0] in mapping.tags))
			problems.push(`matching.kit: ${m.kit} has same ${key}, which no tag of the mapping writes`);
}

/** Tables merge by key across mappings, so a key two files declare must be declared alike. */
function checkAcrossMappings(mappings: Mapping[], kits: Record<string, KitFactory>): string[] {
	const problems: string[] = [];
	const seen = new Map<string, { id: string; text: string }>();
	for (const m of mappings) {
		const tables = {
			kin: m.matching.kin,
			lookalikes: m.matching.lookalikes,
			refs: m.matching.refs,
		};
		for (const [table, entries] of Object.entries(tables))
			for (const [key, value] of Object.entries(entries ?? {})) {
				const at = `${table} ${key}`;
				const text = JSON.stringify(value);
				const other = seen.get(at);
				if (other && other.text !== text)
					problems.push(`matching.${table}.${key}: ${m.id} and ${other.id} declare it differently`);
				else if (!other) seen.set(at, { id: m.id, text });
			}
	}
	const used = [...new Set(mappings.flatMap((m) => (m.matching.kit ? [m.matching.kit] : [])))];
	const hooks = new Map<string, string>();
	for (const name of used) {
		const factory = kits[name];
		if (!factory) continue;
		const kit = factory(lib());
		const own = [
			...Object.keys(kit.accepts ?? {}).map((k) => `accepts ${k}`),
			...Object.keys(kit.lookalikes ?? {}).map((k) => `lookalikes ${k}`),
			...Object.keys(kit.same ?? {}).map((k) => `same ${k}`),
			...Object.entries(kit.refs ?? {}).flatMap(([k, h]) =>
				Object.keys(h).map((hook) => `refs ${k} ${hook}`),
			),
		];
		for (const hook of own) {
			const other = hooks.get(hook);
			if (other && other !== name) problems.push(`kits ${other} and ${name} both define ${hook}`);
			hooks.set(hook, name);
		}
	}
	return problems;
}

function checkMapping(
	file: string,
	root: string,
	kits: Record<string, KitFactory>,
): { report: Report; mapping: Mapping | null } {
	const problems: string[] = [];
	const mapping = load(file, mappingSchema, problems);
	if (!mapping) return { report: { file, summary: "", problems }, mapping };
	const [country, kind] = mapping.id.toLowerCase().split(":");
	const expected = join(root, "mappings", country, `${kind}.yaml`);
	if (file !== expected) problems.push(`id ${mapping.id} belongs in ${relative(root, expected)}`);
	checkFunctions(mapping, problems);
	checkMatching(mapping, kits, problems);
	const { program, problems: compiled } = compile(mapping);
	problems.push(...compiled);
	if (program) checkEvidence(program, problems);
	let passed = 0;
	if (program) passed = runExamples(program, mapping.examples, (row) => row, problems);
	const byFunction = Object.values(mapping.tags).filter((t) => "function" in t).length;
	return {
		mapping,
		report: {
			file,
			summary: `${passed}/${mapping.examples.length} examples, ${Object.keys(mapping.inputs).length} inputs, ${Object.keys(mapping.tags).length - byFunction} tags by rule, ${byFunction} by function`,
			problems,
		},
	};
}

function checkRenaming(
	file: string,
	root: string,
	mappings: Map<string, Mapping>,
): { report: Report; renaming: Renaming | null } {
	const problems: string[] = [];
	const renaming = load(file, renamingSchema, problems);
	if (!renaming) return { report: { file, summary: "", problems }, renaming };
	const expected = join(root, "sources", `${renaming.source}.yaml`);
	if (file !== expected)
		problems.push(`source ${renaming.source} belongs in ${relative(root, expected)}`);
	const mapping = mappings.get(renaming.mapping);
	if (!mapping) {
		problems.push(`mapping ${renaming.mapping} does not exist`);
		return { report: { file, summary: "", problems }, renaming };
	}
	checkColumns(renaming, mapping, problems);
	if (renaming.official) checkOfficial(renaming.official, mapping, problems);
	const { program, problems: compiled } = compile(mapping, renaming);
	problems.push(...compiled);
	if (program) checkEvidence(program, problems);
	const examples = renaming.examples ?? [];
	let passed = 0;
	if (program) passed = runExamples(program, examples, (row) => renameRow(program, row), problems);
	return {
		renaming,
		report: {
			file,
			summary: `${passed}/${examples.length} examples, ${Object.keys(renaming.rename).length} columns renamed, ${Object.keys(renaming.ignored ?? {}).length} ignored, ${(renaming.steps ?? []).length} code steps, ${Object.keys(renaming.overrides?.tags ?? {}).length} overrides`,
			problems,
		},
	};
}

/** What a `sources` row made from the file will need to read the source at all. */
function checkOfficial(official: Official, mapping: Mapping, problems: string[]) {
	const { source } = official;
	for (const key of Object.keys(mapping.tags)) {
		if (!allowedBy(source.allow, key))
			problems.push(`official: source.allow does not let ${mapping.id}'s tag ${key} through`);
	}
	if (source.formerEndpoints?.includes(source.endpoint))
		problems.push("official: source.endpoint is also listed as a former endpoint");
}

function checkColumns(renaming: Renaming, mapping: Mapping, problems: string[]) {
	const columns = new Set(renaming.columns);
	const steps = renaming.steps ?? [];
	const readByStep = new Set(steps.flatMap((s) => s.reads));
	const ignored = renaming.ignored ?? {};
	const sourceScope = `${renaming.source.replace("/", ".")}/`;
	for (const step of steps) {
		if (!step.name.startsWith(sourceScope))
			problems.push(`step ${step.name} is not scoped to ${renaming.source}`);
		if (!Object.hasOwn(registeredSteps, step.name))
			problems.push(`step ${step.name} is not registered`);
	}
	for (const column of readByStep) {
		if (!columns.has(column)) problems.push(`a step reads "${column}", which is not a column`);
	}
	for (const [column, input] of Object.entries(renaming.rename)) {
		if (!columns.has(column)) problems.push(`renames "${column}", which is not a column`);
		if (!(input in mapping.inputs)) {
			problems.push(`renames "${column}" to "${input}", which is not an input of ${mapping.id}`);
		}
	}
	for (const column of Object.keys(ignored)) {
		if (!columns.has(column)) problems.push(`ignores "${column}", which is not a column`);
	}
	for (const column of columns) {
		if (!(column in renaming.rename) && !(column in ignored) && !readByStep.has(column)) {
			problems.push(`column "${column}" is neither renamed, read by a step, nor ignored`);
		}
	}
}

/** Every mapping under `mappings/` and column renaming under `sources/`, checked and their examples run. */
export function validate(dir: string, kits: Record<string, KitFactory> = KITS): Report[] {
	const root = resolve(dir);
	const reports: Report[] = [];
	const mappings = new Map<string, Mapping>();
	for (const file of yamlFiles(join(root, "mappings"))) {
		const { report, mapping } = checkMapping(file, root, kits);
		if (mapping && mappings.has(mapping.id)) report.problems.push(`id ${mapping.id} is used twice`);
		if (mapping) mappings.set(mapping.id, mapping);
		reports.push(report);
	}
	const endpoints = new Map<string, string>();
	for (const file of yamlFiles(join(root, "sources"))) {
		const { report, renaming } = checkRenaming(file, root, mappings);
		const { endpoint, formerEndpoints = [] } = renaming?.official?.source ?? {};
		for (const address of endpoint ? [endpoint, ...formerEndpoints] : []) {
			const other = endpoints.get(address);
			if (other) report.problems.push(`${address} is also ${relative(root, other)}'s endpoint`);
			else endpoints.set(address, file);
		}
		reports.push(report);
	}
	const shown = reports.map((r) => ({ ...r, file: relative(root, r.file) }));
	const all = [...mappings.values()];
	if (all.length > 0)
		shown.push({
			file: "matching",
			summary: "",
			problems: checkAcrossMappings(all, kits),
		});
	return shown;
}
