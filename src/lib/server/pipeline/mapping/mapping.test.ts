import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "./compile";
import { evaluate } from "./evaluate";
import { type Mapping, mappingSchema, type Renaming, renamingSchema } from "./schema";
import { validate } from "./validate";

const mapping = (over: Record<string, unknown> = {}): Mapping =>
	mappingSchema.parse({
		format: 1,
		id: "XX:thing",
		language: "cel",
		title: "Things",
		inputs: { id: "its id", free: "yes/no", note: "remarks", lat: "latitude", lon: "longitude" },
		record: { key: "id", lat: "lat", lon: "lon" },
		tags: {
			amenity: { value: '"thing"', conf: 0.9 },
			fee: { value: 'truthy(free) ? "no" : ""', conf: 0.8, rule: "Free means no fee." },
			note: { value: "note", conf: 0.5 },
		},
		examples: [],
		...over,
	});

const program = (m: Mapping, renaming?: Renaming) => {
	const { program, problems } = compile(m, renaming);
	if (!program) throw new Error(problems.join("; "));
	return program;
};

const row = (o: Record<string, string>) => ({ id: "A", lat: "45", lon: "5", ...o });

describe("compile", () => {
	it("names a rule that reads something undeclared", () => {
		const { program, problems } = compile(mapping({ tags: { x: { value: "nope", conf: 0.5 } } }));
		expect(program).toBeNull();
		expect(problems.join()).toContain("tags.x");
	});

	it("refuses a rule that gives a boolean where a tag wants text", () => {
		const { problems } = compile(mapping({ tags: { x: { value: "truthy(free)", conf: 0.5 } } }));
		expect(problems).toContain("tags.x: gives bool, expected string");
	});

	it("reports an input nothing reads, one read only through a let counting as read", () => {
		const inputs = { id: "its id", spare: "used by a let", lat: "latitude", lon: "longitude" };
		const tags = { x: { value: '"yes"', conf: 0.5 } };
		expect(compile(mapping({ inputs, tags })).problems).toEqual([
			'input "spare" is read by nothing',
		]);
		const viaLet = mapping({
			inputs,
			let: { has: 'spare != ""' },
			tags: { x: { value: 'has ? "yes" : ""', conf: 0.5 } },
		});
		expect(compile(viaLet).problems).toEqual([]);
	});

	it("takes a tag's reads through the lets it uses and through rows", () => {
		const m = mapping({
			record: { key: "id", groupBy: "id", lat: "lat", lon: "lon" },
			let: { anyFree: "rows.exists(r, truthy(r.free))" },
			tags: {
				fee: { value: 'anyFree ? "no" : ""', conf: 0.8 },
				note: { value: "note", conf: 0.5 },
			},
		});
		expect(program(m).tags.map((t) => [t.key, t.reads])).toEqual([
			["fee", ["free"]],
			["note", ["note"]],
		]);
	});

	it("merges a renaming's override over the mapping's rule for one tag", () => {
		const renaming = renamingSchema.parse({
			format: 1,
			source: "xx/own",
			mapping: "XX:thing",
			columns: ["a"],
			rename: { a: "id" },
			overrides: { tags: { fee: { value: '"yes"' }, note: null } },
		});
		const out = evaluate(program(mapping(), renaming), [row({})]);
		expect(out?.tags.map((t) => [t.key, t.value, t.conf])).toEqual([
			["amenity", "thing", 0.9],
			["fee", "yes", 0.8],
		]);
	});

	it("refuses an override that leaves a tag half written", () => {
		const renaming = renamingSchema.parse({
			format: 1,
			source: "xx/own",
			mapping: "XX:thing",
			columns: ["a"],
			rename: { a: "id" },
			overrides: { tags: { fee: { conf: 7 } } },
		});
		expect(compile(mapping(), renaming).problems.join()).toContain("overrides.tags.fee");
	});
});

describe("evaluate", () => {
	it("proposes nothing for a rule that answers empty", () => {
		const out = evaluate(program(mapping()), [row({ free: "no" })]);
		expect(out?.tags.map((t) => t.key)).toEqual(["amenity"]);
	});

	it("carries what the evidence panel and matching need on each tag", () => {
		const m = mapping({
			tags: {
				fee: { value: 'truthy(free) ? "no" : ""', conf: 0.8, rule: "why", fill: 'note == ""' },
				owner: {
					value: "note",
					conf: 0.7,
					unless: { key: "owner:ref", value: "id" },
					mappedWithin: 90,
				},
			},
		});
		const out = evaluate(program(m), [row({ free: "yes", note: "Acme" })]);
		expect(out?.tags).toMatchObject([
			{
				key: "fee",
				value: "no",
				conf: 0.8,
				rule: "why",
				addOnly: false,
				reads: ["free"],
			},
			{
				key: "owner",
				value: "Acme",
				conf: 0.7,
				addOnly: false,
				unless: { k: "owner:ref", v: "A" },
				mappedWithin: 90,
				reads: ["note"],
			},
		]);
	});

	it("gives a grouped record the rows beside the first row's values", () => {
		const m = mapping({
			record: { key: "id", groupBy: "id", lat: "lat", lon: "lon" },
			let: { all: "rows.all(r, truthy(r.free))" },
			tags: { fee: { value: 'all ? "no" : ""', conf: 0.8 }, note: { value: "note", conf: 0.5 } },
		});
		const p = program(m);
		expect(evaluate(p, [row({ free: "1" }), row({ free: "true" })])?.tags[0]?.value).toBe("no");
		expect(evaluate(p, [row({ free: "1" }), row({ free: "false" })])?.tags).toEqual([]);
		expect(() => evaluate(program(mapping()), [row({}), row({})])).toThrow(/groupBy/);
	});

	it("skips a record, reads its position and says whether it closed", () => {
		const m = mapping({
			record: {
				key: "id",
				lat: "lat",
				lon: "lon",
				skip: 'note == "no"',
				closed: 'free == "closed"',
			},
		});
		const p = program(m);
		expect(evaluate(p, [row({ note: "no" })])).toBeNull();
		expect(evaluate(p, [row({ free: "closed" })])).toMatchObject({
			key: "A",
			position: [45, 5],
			closed: true,
		});
	});

	it("takes a shipped function's tags when it is registered, and none when it is not", () => {
		const m = mapping({
			tags: {
				"socket:*": { function: "any.thing/sockets", reads: ["note"], conf: 0.8 },
				fee: { value: "free", conf: 0.5 },
			},
		});
		const p = program(m);
		const functions = {
			"any.thing/sockets": (r: Record<string, string>) => ({ "socket:a": r.note }),
		};
		expect(evaluate(p, [row({ note: "2", free: "x" })], functions)?.tags.map((t) => t.key)).toEqual(
			["socket:a", "fee"],
		);
		expect(evaluate(p, [row({ note: "2", free: "x" })])?.tags.map((t) => t.key)).toEqual(["fee"]);
	});

	it("names the rule that failed when evaluating it throws", () => {
		const m = mapping({
			tags: { x: { value: "string(double(note))", conf: 0.5 }, f: { value: "free", conf: 0.5 } },
		});
		expect(() => evaluate(program(m), [row({ note: "abc" })])).toThrow(/tags\.x/);
	});
});

describe("rule functions", () => {
	const run = (value: string, inputs: Record<string, string>) => {
		const m = mapping({
			inputs: { id: "id", note: "text", free: "text", lat: "lat", lon: "lon" },
			tags: { x: { value, conf: 0.5 }, y: { value: "free", conf: 0.5 } },
		});
		return evaluate(program(m), [row(inputs)])?.tags.find((t) => t.key === "x")?.value;
	};

	it("reads yes in the words registers use", () => {
		expect(run('truthy(note) ? "y" : ""', { note: " Oui " })).toBe("y");
		expect(run('truthy(note) ? "y" : ""', { note: "non" })).toBeUndefined();
	});

	it("writes a French phone the way FR:Key:phone does, and a website with its scheme", () => {
		expect(run('phone(note, "33")', { note: "0478123456" })).toBe("+33 4 78 12 34 56");
		expect(run("website(note)", { note: "exemple.fr/" })).toBe("https://exemple.fr");
		expect(run("website(note)", { note: "nonsense" })).toBeUndefined();
	});

	it("matches without case, removes and replaces text", () => {
		expect(run('note.imatches("^LYC") ? "y" : ""', { note: "lycée" })).toBe("y");
		expect(run(String.raw`note.remove(r"\s")`, { note: "1 2 3" })).toBe("123");
		expect(run('note.replace(",", ".")', { note: "2,1" })).toBe("2.1");
	});
});

describe("validate", () => {
	const tree = (files: Record<string, string>) => {
		const root = mkdtempSync(join(tmpdir(), "mapping-"));
		for (const [name, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, name)), { recursive: true });
			writeFileSync(join(root, name), text);
		}
		return root;
	};

	const mappingYaml = `format: 1
id: XX:thing
language: cel
title: Things
inputs: { id: its id, free: yes/no }
record: { key: id, lat: '"1"', lon: '"2"' }
tags:
  fee: { value: 'truthy(free) ? "no" : ""', conf: 0.8 }
examples:
  - { about: free, rows: [{ id: A, free: "true" }], expect: { fee: no } }
`;

	const sourceYaml = (extra: string) => `format: 1
source: xx/own
mapping: XX:thing
columns: [ident, gratis, spare]
rename: { ident: id, gratis: free }
${extra}`;

	it("passes every file the app ships", () => {
		const reports = validate(join(import.meta.dirname, "../../../../.."));
		expect(reports.length).toBeGreaterThanOrEqual(4);
		expect(reports.flatMap((r) => r.problems.map((p) => `${r.file}: ${p}`))).toEqual([]);
	});

	it("accepts a mapping and a renaming that account for every column", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml,
			"sources/xx/own.yaml": sourceYaml("ignored: { spare: unused }\n"),
		});
		expect(validate(root).flatMap((r) => r.problems)).toEqual([]);
	});

	it("names a column that is neither renamed, read nor ignored, and a rename to a missing input", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml,
			"sources/xx/own.yaml": sourceYaml("").replace("gratis: free", "gratis: price"),
		});
		const problems = validate(root).flatMap((r) => r.problems);
		expect(problems).toContain('column "spare" is neither renamed, read by a step, nor ignored');
		expect(problems).toContain('renames "gratis" to "price", which is not an input of XX:thing');
	});

	it("fails an example whose expected tags differ", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml.replace("fee: no", "fee: yes"),
		});
		expect(validate(root)[0].problems[0]).toContain("example 1 (free)");
	});

	it("catches an unquoted comma that splits a YAML list through the example", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml.replace(
				'rows: [{ id: A, free: "true" }]',
				"rows: [{ id: A, free: true, yes }]",
			),
		});
		expect(validate(root)[0].problems.length).toBeGreaterThan(0);
	});

	it("keeps a mapping where its id says and refuses a function scoped to another country", () => {
		const root = tree({
			"mappings/xx/other.yaml": mappingYaml.replace(
				"  fee:",
				"  name: { function: fr/name, reads: [id], conf: 0.5 }\n  fee:",
			),
		});
		const problems = validate(root)[0].problems;
		expect(problems).toContain("id XX:thing belongs in mappings/xx/thing.yaml");
		expect(problems).toContain("tags.name: function fr/name is scoped to another country");
	});
});
