import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, inputsOf, renameRow } from "./compile";
import { evaluate } from "./evaluate";
import {
	closedEvidence,
	notedBy,
	pickRow,
	proposedTags,
	readRecord,
	settledBy,
	skippedBy,
} from "./record";
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

const official = {
	title: "Things",
	publisher: { name: "The ministry", relation: "runs the things" },
	licence: "Licence Ouverte 2.0",
	address: "https://example.test/things",
	discussion: ["https://example.test/things/talk"],
	source: {
		kind: "registry",
		endpoint: "https://example.test/things.csv",
		schedule: "weekly",
		matching: "amenity=thing",
		floor: 0.7,
		allow: ["amenity", "fee"],
	},
};

describe("the record block", () => {
	const place = (record: Record<string, unknown>, over: Record<string, unknown> = {}) =>
		mapping({
			id: "FR:thing",
			inputs: {
				id: "its id",
				note: "remarks",
				state: "open or closed",
				street: "its street",
				phone: "its phone",
				email: "its mailbox",
				lat: "latitude",
				lon: "longitude",
			},
			record: { key: "id", lat: "lat", lon: "lon", ...record },
			tags: {
				amenity: { value: '"thing"', conf: 0.9 },
				misc: { value: "note + state + street", conf: 0.5 },
				phone: { value: 'mobile(phone) ? "" : phone(phone, "33")', conf: 0.8 },
				email: { value: 'email.matches("@ecole") ? email : ""', conf: 0.8 },
			},
			...over,
		});

	it("gives a geocode from the address, with a distance that may be a rule and 0 for never", () => {
		const at = (record: Record<string, unknown>, o: Record<string, string> = {}) =>
			evaluate(program(place({ address: 'street + ", Lyon"', ...record })), [row(o)])?.geocode;
		expect(at({ farM: 1000 }, { street: "1 rue X" })).toEqual({ q: "1 rue X, Lyon", farM: 1000 });
		expect(
			at({ farM: 'note == "coarse" ? 100.0 : 0.0', wrongM: 2000 }, { note: "coarse" }),
		).toEqual({
			q: ", Lyon",
			farM: 100,
			wrongM: 2000,
		});
		expect(at({ farM: 'note == "coarse" ? 100.0 : 0.0' })?.farM).toBe(Number.POSITIVE_INFINITY);
		expect(at({})?.farM).toBe(Number.POSITIVE_INFINITY);
		expect(
			evaluate(program(place({ address: 'street == "" ? "" : street' })), [row({})])?.geocode,
		).toBeUndefined();
	});

	it("refuses a distance, a pick or a tie-break without what they belong to", () => {
		const problems = (record: Record<string, unknown>) =>
			compile(place(record)).problems.join("; ");
		expect(problems({ farM: 100 })).toContain("record.farM: there is no record.address");
		expect(problems({ wrongM: 100 })).toContain("record.wrongM: there is no record.address");
		expect(problems({ pick: "nearest" })).toContain("record.pick: there is no record.address");
		expect(problems({ address: "street", pick: "nearest", groupBy: "id" })).toContain(
			"cannot also group",
		);
		expect(problems({ tieBreak: "note" })).toContain("record.tieBreak: there is no record.pick");
		expect(problems({ withheld: ["nope"] })).toContain('record: "nope" is not an input');
		expect(problems({ farM: "note", address: "street" })).toContain(
			"gives string, expected double",
		);
	});

	it("counts the phones and mailboxes it declares that reach no tag", () => {
		const count = (o: Record<string, string>, withheld: string[] | null = ["phone", "email"]) =>
			evaluate(program(place(withheld ? { withheld } : {})), [row(o)])?.withheld;
		expect(count({ phone: "04 72 00 00 01", email: "contact@ecole.fr" })).toBe(0);
		expect(count({ phone: "06 12 34 56 78", email: "someone@gmail.com" })).toBe(2);
		expect(count({ phone: "06 12 34 56 78", email: "someone@gmail.com" }, null)).toBe(0);
		expect(count({ phone: "not a number", email: "not a mailbox" })).toBe(0);
	});

	it("reads a row's key, point, skip and address with only the lets they need", () => {
		const m = place(
			{
				key: 'prefixed ? "x" + id : id',
				skip: 'note == "no"',
				address: "street",
			},
			{ let: { prefixed: 'state == "open"', never: "double(note)" } },
		);
		const p = program(m);
		expect(p.record.lets.map((l) => l.name)).toEqual(["prefixed"]);
		expect(readRecord(p, row({ state: "open", street: "1 rue X", note: "no" }))).toEqual({
			key: "xA",
			position: [45, 5],
			skip: true,
			address: "1 rue X",
		});
		expect(readRecord(p, row({ id: "" })).key).toBeNull();
	});

	it("picks among a key's rows the one whose address is nearest, the shortest tie-break winning among equals", () => {
		const p = program(place({ address: "street", pick: "nearest", tieBreak: "note" }));
		const [main, annex, far] = [
			{ id: "A", note: "Ecole" },
			{ id: "A", note: "Ecole - annexe" },
			{ id: "A", note: "Ecole - site" },
		];
		const pick = (gaps: [number, number, number]) =>
			pickRow(
				p,
				[annex, main, far],
				(r) => ({ ...r }),
				new Map([
					[main, gaps[0]],
					[annex, gaps[1]],
					[far, gaps[2]],
				]),
			);
		expect(pick([40, 3000, 3000])).toBe(main);
		expect(pick([3000, 50, 3000])).toBe(annex);
		expect(pick([40, 90, 3000])).toBe(main);
		expect(
			pick([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]),
		).toBe(main);
		expect(pickRow(program(place({})), [annex, main], (r) => ({ ...r }))).toBe(annex);
	});

	it("quotes the inputs a closed rule read, with the column each came from", () => {
		const p = program(place({ closed: 'state.imatches("^ferm")' }), {
			format: 1,
			source: "xx/own",
			mapping: "FR:thing",
			columns: ["etat"],
			rename: { etat: "state" },
		});
		expect(closedEvidence(p, { state: "FERMÉ" })).toEqual({
			path: "etat",
			kind: "dataset row",
			parts: [
				{ text: "etat: ", mark: false },
				{ text: "FERMÉ", mark: true },
			],
		});
	});
});

describe("functions on the record and notes that name an input", () => {
	const record = {
		key: "id",
		lat: "lat",
		lon: "lon",
		skipBy: { function: "xx/housed", reads: ["note"] },
		sitesBy: { function: "xx/sites", reads: ["note"] },
	};

	it("hands a function only the inputs it reads, and the other rows of the read", () => {
		const p = program(mapping({ record }));
		const seen: unknown[] = [];
		const skip = {
			"xx/housed": (reads: Record<string, string>, rowsOf: (k: string) => unknown) => {
				seen.push(reads, rowsOf("B"));
				return reads.note === "section";
			},
		};
		const rowsOf = (key: string) => (key === "B" ? [{ id: "B" }] : undefined);
		expect(skippedBy(p, skip, row({ note: "section" }), rowsOf)).toBe(true);
		expect(skippedBy(p, skip, row({ note: "school" }), rowsOf)).toBe(false);
		expect(seen[0]).toEqual({ note: "section" });
		expect(seen[1]).toEqual([{ id: "B" }]);
		expect(skippedBy(program(mapping()), skip, row({}))).toBe(false);
	});

	it("lets a sites function complete the tags in place and add lines", () => {
		const p = program(mapping({ record }));
		const tags = [{ k: "note", v: "a", conf: 0.5, path: "note", kind: "dataset row", parts: [] }];
		const sites = {
			"xx/sites": (
				rows: Record<string, string>[],
				main: number,
				made: { v: string; also?: string[] }[],
			) => {
				made[0].also = rows.map((r) => r.note).filter((v) => v !== made[0].v);
				return [`${rows.length} sites, the main one's is ${rows[main].note}`];
			},
		};
		const lines = settledBy(p, sites, [row({ note: "a" }), row({ note: "b" })], 0, tags);
		expect(lines).toEqual(["2 sites, the main one's is a"]);
		expect(tags[0]).toMatchObject({ also: ["b"] });
		expect(settledBy(program(mapping()), sites, [row({})], 0, tags)).toEqual([]);
	});

	it("lets a notes function answer lines for a record's first row", () => {
		const p = program(
			mapping({ record: { ...record, notesBy: { function: "xx/notes", reads: ["note"] } } }),
		);
		const table = { "xx/notes": (reads: Record<string, string>) => [`says ${reads.note}`] };
		expect(notedBy(p, table, row({ note: "a" }))).toEqual(["says a"]);
		expect(notedBy(program(mapping()), table, row({}))).toEqual([]);
		expect(() => notedBy(p, {}, row({}))).toThrow("function xx/notes is not registered");
	});

	it("refuses a function nothing registered, and inputs a mapping does not declare", () => {
		expect(() => skippedBy(program(mapping({ record })), {}, row({}))).toThrow(
			"XX:thing: function xx/housed is not registered",
		);
		const { problems } = compile(
			mapping({ record: { ...record, sitesBy: { function: "xx/sites", reads: ["ghost"] } } }),
		);
		expect(problems).toContain('record.sitesBy: reads "ghost", which is not an input');
	});

	it("writes an input's value into a note's text, and refuses a name that is not an input", () => {
		const m = mapping({ notes: [{ when: 'note != ""', text: "Remarks: {note}" }] });
		expect(evaluate(program(m), [row({ note: "bridge" })])?.notes).toEqual(["Remarks: bridge"]);
		expect(evaluate(program(m), [row({})])?.notes).toEqual([]);
		const { problems } = compile(mapping({ notes: [{ when: "true", text: "{ghost}" }] }));
		expect(problems).toContain("notes[0].text: {ghost} is not an input");
	});
});

describe("refs, quotes and what a function says about the record", () => {
	it("puts a ref tag's value among the refs, or the identifiers its function answers with", () => {
		const m = mapping({
			tags: {
				...mapping().tags,
				"ref:A": { value: "id", conf: 0.9, ref: true },
				"ref:B": { function: "any.thing/ids", reads: ["note"], conf: 0.9, ref: true },
				"ref:C": { function: "any.thing/ids", reads: ["note"], conf: 0.9 },
			},
		});
		const functions = {
			"any.thing/ids": () => ({
				"ref:B": { value: "", ref: "b1;b2" },
				"ref:C": { value: "c", ref: "c1" },
			}),
		};
		const made = evaluate(program(m), [row({ note: "n" })], functions);
		expect(made?.refs).toEqual({ "ref:A": "A", "ref:B": "b1;b2" });
		expect(made?.tags.map((t) => t.key)).toEqual(["amenity", "note", "ref:A", "ref:C"]);
	});

	it("counts a quoted input as read, and names one that is not an input", () => {
		const base = {
			inputs: { id: "its id", note: "remarks", lat: "latitude", lon: "longitude" },
		};
		const quoted = mapping({
			...base,
			tags: { amenity: { value: '"thing"', conf: 0.9, quote: ["note"] } },
		});
		const made = evaluate(program(quoted), [row({})]);
		expect(made?.tags[0]).toMatchObject({ reads: [], quote: ["note"] });
		const unread = mapping({ ...base, tags: { amenity: { value: '"thing"', conf: 0.9 } } });
		expect(compile(unread).problems.join()).toContain('input "note" is read by nothing');
		const unknown = mapping({
			tags: { amenity: { value: '"thing"', conf: 0.9, quote: ["nope"] } },
		});
		expect(compile(unknown).problems.join()).toContain(
			'tags.amenity.quote: "nope" is not an input',
		);
	});

	it("collects what answers say of the record: keys ruled out, counts that fit, lines for the reviewer", () => {
		const m = mapping({
			tags: {
				...mapping().tags,
				"socket:*": { function: "any.thing/sockets", reads: ["note"], conf: 0.9 },
			},
			notes: [{ when: 'note == "x"', text: "The mapping's own line" }],
		});
		const functions = {
			"any.thing/sockets": () => ({
				"socket:a": "2",
				"socket:b": {
					value: "",
					absent: ["socket:c"],
					fit: [{ k: "socket:d", v: "1" }],
					notes: ["Declared as 3"],
				},
			}),
		};
		const made = evaluate(program(m), [row({ note: "x" })], functions);
		expect(made?.tags.map((t) => t.key)).toContain("socket:a");
		expect(made?.tags.map((t) => t.key)).not.toContain("socket:b");
		expect(made).toMatchObject({
			absent: ["socket:c"],
			fit: [{ k: "socket:d", v: "1" }],
			notes: ["The mapping's own line", "Declared as 3"],
		});
	});
});

describe("several columns renamed to one input", () => {
	const renaming = (rename: Record<string, string>) =>
		renamingSchema.parse({
			format: 1,
			source: "xx/own",
			mapping: "XX:thing",
			columns: Object.keys(rename),
			rename,
		});
	const prog = program(mapping(), renaming({ ident: "id", note: "note", remarque: "note" }));

	it("reads the first column listed that holds a value", () => {
		expect(renameRow(prog, { ident: "A", note: "now", remarque: "before" }).note).toBe("now");
		expect(renameRow(prog, { ident: "A", note: "", remarque: "before" }).note).toBe("before");
		expect(renameRow(prog, { ident: "A", remarque: "before" }).note).toBe("before");
		expect(renameRow(prog, { ident: "A", note: "now" }).note).toBe("now");
		expect(inputsOf(prog, { ident: "A", note: "  ", remarque: " before " }).note).toBe("before");
	});

	it("leaves the input empty when every column is", () => {
		expect(renameRow(prog, { ident: "A", note: "", remarque: "" }).note).toBe("");
	});

	it("shows the first column listed as the input's source", () => {
		expect(prog.columnOf.get("note")).toBe("note");
	});
});

describe("evidence from the rule", () => {
	const renaming = renamingSchema.parse({
		format: 1,
		source: "xx/own",
		mapping: "XX:thing",
		columns: ["ident", "gratuit", "remarque"],
		rename: { ident: "id", gratuit: "free", remarque: "note" },
	});
	const shown = (tags: Record<string, unknown>, input: Record<string, string>, own = renaming) => {
		const p = program(mapping({ tags }), own);
		const made = evaluate(p, [row(input)]);
		return proposedTags(p, made?.tags ?? [], [row(input)]);
	};
	const text = (t: { parts: { text: string }[] }) => t.parts.map((p) => p.text).join("");

	it("quotes what the rule read, under the column each input came from", () => {
		const [fee] = shown(
			{ fee: { value: 'truthy(free) ? "no" : note', conf: 0.8 } },
			{ free: "oui", note: "x" },
		);
		expect(fee).toMatchObject({ k: "fee", path: "gratuit", kind: "dataset row" });
		expect(text(fee)).toBe("gratuit: oui, remarque: x");
		expect(fee.parts.filter((p) => p.mark).map((p) => p.text)).toEqual(["oui", "x"]);
	});

	it("quotes the inputs a tag names rather than the ones it reads, and says how the value came", () => {
		const [fee] = shown(
			{ fee: { value: 'truthy(free) ? "no" : note', conf: 0.8, quote: ["note"], kind: "derived" } },
			{ free: "oui", note: "x" },
		);
		expect(fee).toMatchObject({ path: "remarque", kind: "derived" });
		expect(text(fee)).toBe("remarque: x");
	});

	it("leaves out an input with no value, unless none has one", () => {
		const tag = { fee: { value: 'truthy(free) ? "no" : "yes"', conf: 0.8 } };
		expect(text(shown(tag, { free: "" })[0])).toBe("gratuit: —");
		const both = { n: { value: 'note != "" ? note : free', conf: 0.8 } };
		expect(text(shown(both, { note: "", free: "oui" })[0])).toBe("gratuit: oui");
	});

	it("shows each input's distinct values across a record's rows, three at most", () => {
		const p = program(
			mapping({
				record: { key: "id", groupBy: "id", lat: "lat", lon: "lon" },
				tags: { n: { value: '"x"', conf: 0.5, quote: ["note"] } },
			}),
			renaming,
		);
		const quoted = (notes: string[]) => {
			const rows = notes.map((note) => row({ note }));
			return text(proposedTags(p, evaluate(p, rows)?.tags ?? [], rows)[0]);
		};
		expect(quoted(["", "b", "a", "b"])).toBe("remarque: b, a");
		expect(quoted(["a", "b", "c", "d"])).toBe("remarque: a, b, c, …");
	});

	it("names the input itself where the renaming does not give its column", () => {
		const [t] = shown(
			{ n: { value: "note", conf: 0.5 } },
			{ note: "x" },
			{ ...renaming, rename: { ident: "id" } },
		);
		expect(text(t)).toBe("note: x");
	});

	it("takes a function's own evidence over the tag's quote", () => {
		const p = program(
			mapping({ tags: { n: { function: "any/pick", reads: ["note"], quote: ["id"], conf: 0.5 } } }),
			renaming,
		);
		const fns = {
			"any/pick": () => ({
				n: { value: "v", evidence: { input: "free", shown: "yes", kind: "normalised" } },
			}),
		};
		const made = evaluate(p, [row({ note: "x" })], fns);
		const [t] = proposedTags(p, made?.tags ?? [], [row({ note: "x" })]);
		expect(t).toMatchObject({ path: "gratuit", kind: "normalised" });
		expect(text(t)).toBe("gratuit: yes");
	});

	it("keeps the tag's trust, mode, group and conditions", () => {
		const [t] = shown(
			{ n: { value: "note", conf: 0.5, fill: true, group: "g", mappedWithin: 9 } },
			{ note: "x" },
		);
		expect(t).toMatchObject({ conf: 0.5, addOnly: true, group: "g", mappedWithin: 9 });
	});
});

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
			official,
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

	it("refuses a quote that is not an input, and counts one as a read", () => {
		const inputs = { id: "its id", spare: "shown only", lat: "latitude", lon: "longitude" };
		const tags = (quote: string[]) => ({ x: { value: '"yes"', conf: 0.5, quote } });
		expect(compile(mapping({ inputs, tags: tags(["spare"]) })).problems).toEqual([]);
		expect(compile(mapping({ inputs, tags: tags(["nope"]) })).problems).toContain(
			'tags.x.quote: "nope" is not an input',
		);
	});

	it("refuses an override that leaves a tag half written", () => {
		const renaming = renamingSchema.parse({
			format: 1,
			source: "xx/own",
			mapping: "XX:thing",
			official,
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

	it("lets a tag's trust be a rule, and a function's answer carry its own trust, mode and evidence", () => {
		const m = mapping({
			tags: {
				fee: { value: 'truthy(free) ? "no" : ""', conf: "truthy(free) ? 0.8 : 0.4", fill: true },
				"socket:*": { function: "any.thing/sockets", reads: ["note"], conf: 0.9 },
			},
		});
		const functions = {
			"any.thing/sockets": () => ({
				"socket:a": "2",
				"socket:a:output": {
					value: "22 kW",
					conf: 0.7,
					addOnly: true,
					evidence: { input: "note", shown: "22", kind: "derived" },
				},
			}),
		};
		const tags = evaluate(program(m), [row({ free: "true" })], functions)?.tags;
		expect(tags?.map((t) => [t.key, t.conf, t.addOnly, t.evidence])).toEqual([
			["fee", 0.8, true, undefined],
			["socket:a", 0.9, false, undefined],
			["socket:a:output", 0.7, true, { input: "note", shown: "22", kind: "derived" }],
		]);
		expect(() => program(mapping({ tags: { x: { value: "note", conf: "note" } } }))).toThrow(
			/gives string, expected double/,
		);
	});

	it("passes a function the site its code step gathered", () => {
		const m = mapping({
			tags: {
				note: { function: "any.thing/site", reads: ["note"], conf: 0.5 },
				fee: { value: "free", conf: 0.5 },
			},
		});
		const functions = {
			"any.thing/site": (_: unknown, __: unknown, site?: unknown) => ({ note: String(site) }),
		};
		expect(evaluate(program(m), [row({})], functions, "gathered")?.tags[0]?.value).toBe("gathered");
	});

	it("takes from a function only the key its tag names, unless the tag ends in *", () => {
		const m = mapping({
			tags: {
				"addr:street": { function: "any.thing/address", reads: ["note"], conf: 0.8, group: "addr" },
				"addr:city": { function: "any.thing/address", reads: ["note"], conf: 0.9, group: "addr" },
				fee: { value: "free", conf: 0.5 },
			},
		});
		const functions = {
			"any.thing/address": () => ({ "addr:street": "Rue A", "addr:city": "Lyon" }),
		};
		const tags = evaluate(program(m), [row({})], functions)?.tags;
		expect(tags?.map((t) => [t.key, t.value, t.conf, t.group])).toEqual([
			["addr:street", "Rue A", 0.8, "addr"],
			["addr:city", "Lyon", 0.9, "addr"],
		]);
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
official:
  title: Things
  publisher: { name: The ministry, relation: runs the things }
  licence: Licence Ouverte 2.0
  address: https://example.test/things
  discussion: [https://example.test/things/talk]
  source:
    kind: registry
    endpoint: https://example.test/things.csv
    schedule: weekly
    matching: amenity=thing
    floor: 0.7
    allow: [amenity, fee]
columns: [ident, gratis, spare]
rename: { ident: id, gratis: free }
${extra}`;

	it("refuses a function or a step a file names that nothing registered", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml
				.replace("  fee:", "  name: { function: any/nothing, reads: [id], conf: 0.5 }\n  fee:")
				.replace(
					"record: { key: id,",
					"record: { notesBy: { function: xx/noted, reads: [id] }, key: id,",
				),
			"sources/xx/own.yaml": sourceYaml(
				"steps:\n  - { name: xx.own/rebuild, why: it rebuilds, reads: [spare] }\n",
			),
		});
		const problems = validate(root).flatMap((r) => r.problems);
		expect(problems).toContain("tags.name: function any/nothing is not registered");
		expect(problems).toContain("record.notesBy: function xx/noted is not registered");
		expect(problems).toContain("step xx.own/rebuild is not registered");
	});

	it("lets a renaming send several columns to one input", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml,
			"sources/xx/own.yaml": sourceYaml("").replace(
				"rename: { ident: id, gratis: free }",
				"rename: { ident: id, gratis: free, spare: free }",
			),
		});
		expect(validate(root).flatMap((r) => r.problems)).toEqual([]);
	});

	it("refuses a tag that reads no input and has no quote", () => {
		const root = tree({
			"mappings/xx/thing.yaml": mappingYaml.replace(
				"examples:",
				"  label: { value: '\"x\"', conf: 0.5 }\nexamples:",
			),
		});
		const problems = validate(root).flatMap((r) => r.problems);
		expect(problems[0]).toContain("tags.label: reads no input");
	});

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
