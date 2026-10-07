import { describe, expect, it } from "vitest";
import { STORED_COLUMNS, STORED_RENAMING } from "../../../../../e2e/renaming";
import { mappingFor, renamingFor } from "./files";
import {
	type Answer,
	answerSchema,
	checkAnswer,
	MAX_COLUMNS,
	nativeColumns,
	type RenameContext,
} from "./rename";

const columns = ["uai", "nom", "type", "latitude", "longitude", "tel", "parent"];
const sample = [
	{
		uai: "0690001A",
		nom: "Collège Test",
		type: "Collège",
		latitude: "45.76",
		longitude: "4.83",
		tel: "0478123456",
		parent: "0690009J",
	},
	{
		uai: "0690002B",
		nom: "Ecole Test",
		type: "Ecole",
		latitude: "45.77",
		longitude: "4.84",
		tel: "04 78 12 34 57",
		parent: "",
	},
];

const ctx: RenameContext = {
	mapping: mappingFor("FR:school"),
	shipped: renamingFor("fr/annuaire-education"),
	columns,
	sample,
};

const item = (
	column: string,
	action: "rename" | "ignore" | "step",
	rest: Partial<Answer["columns"][number]> = {},
): Answer["columns"][number] => ({
	column,
	action,
	input: "",
	step: "",
	as: "",
	reason: "",
	...rest,
});

const good: Answer = {
	columns: [
		item("uai", "rename", { input: "id" }),
		item("nom", "rename", { input: "name" }),
		item("type", "rename", { input: "kind" }),
		item("latitude", "rename", { input: "lat" }),
		item("longitude", "rename", { input: "lon" }),
		item("tel", "rename", { input: "phone" }),
		item("parent", "step", {
			step: "fr.annuaire-education/sections",
			as: "etablissement_mere",
		}),
	],
};

const problems = (answer: Answer, over: Partial<RenameContext> = {}) => {
	const checked = checkAnswer(answer, { ...ctx, ...over });
	return "problems" in checked ? checked.problems : [];
};

describe("checkAnswer", () => {
	it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
		"refuses %s, which every object inherits, as an input",
		(name) => {
			const answer = {
				columns: good.columns.map((c) =>
					c.column === "nom" ? item("nom", "rename", { input: name }) : c,
				),
			};
			expect(problems(answer)[0]).toContain("does not declare");
		},
	);

	it("keeps a column named __proto__ as an answer of its own", () => {
		const columns = [...ctx.columns, "__proto__"];
		const answer = {
			columns: [...good.columns, item("__proto__", "ignore", { reason: "unused" })],
		};
		const checked = checkAnswer(answer, { ...ctx, columns });
		if (!("renaming" in checked)) throw new Error("refused");
		expect(Object.keys(checked.renaming.ignored)).toEqual(["__proto__"]);
	});

	it("bounds the answer's size", () => {
		const long = { columns: [item("nom", "ignore", { reason: "x".repeat(10_000) })] };
		expect(answerSchema.safeParse(long).success).toBe(false);
		const many = {
			columns: Array.from({ length: MAX_COLUMNS + 1 }, (_, i) =>
				item(`c${i}`, "ignore", { reason: "r" }),
			),
		};
		expect(answerSchema.safeParse(many).success).toBe(false);
		expect(problems(good, { columns: many.columns.map((c) => c.column) })[0]).toContain(
			"more than",
		);
	});

	it("accepts an answer that accounts for every column with declared inputs", () => {
		const checked = checkAnswer(good, ctx);
		expect(checked).toEqual({
			renaming: {
				mapping: "FR:school",
				rename: {
					uai: "id",
					nom: "name",
					type: "kind",
					latitude: "lat",
					longitude: "lon",
					tel: "phone",
				},
				ignored: {},
				steps: { parent: { name: "fr.annuaire-education/sections", as: "etablissement_mere" } },
			},
		});
	});

	it("names the shipped column each of the source's stands for, so the preset's code can read it", () => {
		const checked = checkAnswer(good, ctx);
		if (!("renaming" in checked)) throw new Error("refused");
		expect(Object.fromEntries(nativeColumns(ctx.shipped, checked.renaming))).toEqual({
			uai: "identifiant_de_l_etablissement",
			nom: "nom_etablissement",
			type: "type_etablissement",
			latitude: "latitude",
			longitude: "longitude",
			tel: "telephone",
			parent: "etablissement_mere",
		});
	});

	it("refuses an input the mapping does not declare", () => {
		const answer = {
			columns: good.columns.map((c) =>
				c.column === "tel" ? item("tel", "rename", { input: "fax" }) : c,
			),
		};
		expect(problems(answer)).toEqual([
			'column "tel" is renamed to "fax", which FR:school does not declare',
		]);
	});

	it("refuses a column the file does not have, and one left unanswered", () => {
		const answer = {
			columns: [...good.columns.slice(0, -1), item("ghost", "ignore", { reason: "none" })],
		};
		expect(problems(answer)).toEqual([
			'the model answered for "ghost", which is not a column of the file',
			'the model gave no answer for column "parent"',
		]);
	});

	it("refuses an ignored column with no reason, and two columns sent to one input, which only a shipped renaming may do", () => {
		const answer = {
			columns: [...good.columns.slice(0, 6), item("parent", "rename", { input: "phone" })],
		};
		expect(problems(answer)).toEqual(['columns "tel", "parent" are all renamed to "phone"']);
		expect(
			problems({
				columns: [...good.columns.slice(0, 6), item("parent", "ignore")],
			}),
		).toEqual(['column "parent" is ignored with no reason']);
	});

	it("refuses a step the source does not have, and a column the step does not read", () => {
		const step = (name: string, as: string) => ({
			columns: [...good.columns.slice(0, 6), item("parent", "step", { step: name, as })],
		});
		expect(problems(step("fr.annuaire-education/nothing", "etablissement_mere"))[0]).toMatch(
			/not a step of this source/,
		);
		expect(problems(step("fr.annuaire-education/sections", "telephone"))[0]).toMatch(
			/reads no column "telephone"/,
		);
	});

	it("refuses an answer that leaves the record without its key or its position", () => {
		const without = (column: string) => ({
			columns: good.columns.map((c) =>
				c.column === column ? item(column, "ignore", { reason: "not it" }) : c,
			),
		});
		expect(problems(without("uai"))).toEqual([
			'no column was renamed to "id", which FR:school needs to key and place a record',
		]);
		expect(problems(without("latitude"))[0]).toMatch(/"lat"/);
	});

	it("refuses a phone column whose values are not phone numbers", () => {
		const rows = sample.map((r) => ({ ...r, tel: "pas de téléphone" }));
		expect(problems(good, { sample: rows })).toEqual([
			'column "tel" is renamed to phone, but 0 of 2 sample values read as a phone number (e.g. "pas de téléphone")',
		]);
	});

	it("takes a phone column with no values as nothing to judge", () => {
		expect(problems(good, { sample: sample.map((r) => ({ ...r, tel: "" })) })).toEqual([]);
	});

	it("refuses positions that fall outside the country", () => {
		const rows = sample.map((r) => ({ ...r, latitude: "4.83", longitude: "45.76" }));
		expect(problems(good, { sample: rows })).toEqual([
			'columns "latitude" and "longitude" are renamed to lat and lon, but 0 of 2 sample positions fall inside FR',
		]);
	});
});

describe("the renaming the e2e fixture stores", () => {
	it("is one the model's answer checks accept", () => {
		const answer: Answer = {
			columns: [
				...Object.entries(STORED_RENAMING.rename).map(([column, input]) =>
					item(column, "rename", { input }),
				),
				...Object.entries(STORED_RENAMING.ignored).map(([column, reason]) =>
					item(column, "ignore", { reason }),
				),
				...Object.entries(STORED_RENAMING.steps).map(([column, step]) =>
					item(column, "step", { step: step.name, as: step.as }),
				),
			],
		};
		const row = {
			code_uai: "0690001A",
			intitule: "Collège Exemple",
			tel: "04 78 12 34 56",
			latitude: "45.76",
			longitude: "4.83",
		};
		const checked = checkAnswer(answer, { ...ctx, columns: STORED_COLUMNS, sample: [row] });
		expect("problems" in checked ? checked.problems : []).toEqual([]);
		expect(checked).toEqual({ renaming: STORED_RENAMING });
	});
});
