import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { ZodType } from "zod";
import { functions } from "../fr/functions";
import { compile, type Program, renameRow } from "./compile";
import { evaluate } from "./evaluate";
import { type Example, type Mapping, mappingSchema, type Renaming, renamingSchema } from "./schema";

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

/** `any` or the mapping's country, then optionally the mapping's kind: `fr.school/name`. */
function checkFunctionScopes(mapping: Mapping, problems: string[]) {
	const [country, kind] = mapping.id.toLowerCase().split(":");
	for (const [key, tag] of Object.entries(mapping.tags)) {
		if (!("function" in tag)) continue;
		const [scopeCountry, scopeKind] = tag.function.split("/")[0].split(".");
		if (scopeCountry !== "any" && scopeCountry !== country) {
			problems.push(`tags.${key}: function ${tag.function} is scoped to another country`);
		} else if (scopeKind !== undefined && scopeKind !== kind) {
			problems.push(`tags.${key}: function ${tag.function} is scoped to another kind of place`);
		}
	}
}

function checkMapping(file: string, root: string): { report: Report; mapping: Mapping | null } {
	const problems: string[] = [];
	const mapping = load(file, mappingSchema, problems);
	if (!mapping) return { report: { file, summary: "", problems }, mapping };
	const [country, kind] = mapping.id.toLowerCase().split(":");
	const expected = join(root, "mappings", country, `${kind}.yaml`);
	if (file !== expected) problems.push(`id ${mapping.id} belongs in ${relative(root, expected)}`);
	checkFunctionScopes(mapping, problems);
	const { program, problems: compiled } = compile(mapping);
	problems.push(...compiled);
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

function checkRenaming(file: string, root: string, mappings: Map<string, Mapping>): Report {
	const problems: string[] = [];
	const renaming = load(file, renamingSchema, problems);
	if (!renaming) return { file, summary: "", problems };
	const expected = join(root, "sources", `${renaming.source}.yaml`);
	if (file !== expected)
		problems.push(`source ${renaming.source} belongs in ${relative(root, expected)}`);
	const mapping = mappings.get(renaming.mapping);
	if (!mapping) {
		problems.push(`mapping ${renaming.mapping} does not exist`);
		return { file, summary: "", problems };
	}
	checkColumns(renaming, mapping, problems);
	const { program, problems: compiled } = compile(mapping, renaming);
	problems.push(...compiled);
	const examples = renaming.examples ?? [];
	let passed = 0;
	if (program) passed = runExamples(program, examples, (row) => renameRow(program, row), problems);
	return {
		file,
		summary: `${passed}/${examples.length} examples, ${Object.keys(renaming.rename).length} columns renamed, ${Object.keys(renaming.ignored ?? {}).length} ignored, ${(renaming.steps ?? []).length} code steps, ${Object.keys(renaming.overrides?.tags ?? {}).length} overrides`,
		problems,
	};
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
	const targets = Object.values(renaming.rename);
	if (new Set(targets).size !== targets.length)
		problems.push("two columns are renamed to one input");
}

/** Every mapping under `mappings/` and column renaming under `sources/`, checked and their examples run. */
export function validate(dir: string): Report[] {
	const root = resolve(dir);
	const reports: Report[] = [];
	const mappings = new Map<string, Mapping>();
	for (const file of yamlFiles(join(root, "mappings"))) {
		const { report, mapping } = checkMapping(file, root);
		if (mapping && mappings.has(mapping.id)) report.problems.push(`id ${mapping.id} is used twice`);
		if (mapping) mappings.set(mapping.id, mapping);
		reports.push(report);
	}
	for (const file of yamlFiles(join(root, "sources"))) {
		reports.push(checkRenaming(file, root, mappings));
	}
	return reports.map((r) => ({ ...r, file: relative(root, r.file) }));
}
