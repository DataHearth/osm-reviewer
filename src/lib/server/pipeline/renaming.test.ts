import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llm } from "$lib/server/config";
import { createDb, type Db } from "$lib/server/db/client";
import { runMigrations } from "$lib/server/db/migrate";
import * as t from "$lib/server/db/schema";
import { requestRename } from "$lib/server/mutations";
import { loadSources } from "$lib/server/queries";
import { renamingFor } from "./mapping/files";
import { ReaderResolver } from "./renaming";
import { runSource } from "./runner";

const DATASET = "https://www.data.gouv.fr/api/1/datasets/schools-test/";
const FILE = "https://static.data.gouv.fr/schools.csv";
const LINES = "https://static.data.gouv.fr/schools.jsonl";
const ANNUAIRE_DATASET = "https://www.data.gouv.fr/api/1/datasets/annuaire-test/";
const ANNUAIRE_FILE = "https://static.data.gouv.fr/annuaire.csv";
const MODEL = "http://model.test/v1/chat/completions";

const HEADER = "uai,nom,type,latitude,longitude,tel,statut";
const row = (uai: string, lat: number, lon: number, tel = "0478123456") =>
	`${uai},Collège ${uai},Collège,${lat},${lon},${tel},Public`;

const ITEM = { input: "", step: "", as: "", reason: "" };
const RENAMES = [
	["uai", "id"],
	["nom", "name"],
	["type", "kind"],
	["latitude", "lat"],
	["longitude", "lon"],
	["tel", "phone"],
	["statut", "status"],
];
const answer = (over: Record<string, string> = {}) => ({
	columns: RENAMES.map(([column, input]) => ({
		...ITEM,
		column,
		action: "rename",
		input: over[column] ?? input,
	})),
});

let csv = "";
let annuaire = "";
let fileUrl = FILE;
let duringModelCall: (() => void) | null = null;
let reply: unknown = answer();
let modelCalls = 0;
let prompt = "";

function fakeFetch(input: string | URL | Request, init?: RequestInit) {
	const url = String(input);
	if (url === DATASET)
		return Response.json({
			license: "lov2",
			resources: [{ format: "csv", url: fileUrl, title: "schools", last_modified: "2026-09-01" }],
		});
	if (url === ANNUAIRE_DATASET)
		return Response.json({
			license: "lov2",
			resources: [
				{ format: "csv", url: ANNUAIRE_FILE, title: "annuaire", last_modified: "2026-09-01" },
			],
		});
	if (url === fileUrl) return new Response(csv);
	if (url === ANNUAIRE_FILE) return new Response(annuaire);
	if (url === MODEL) {
		modelCalls += 1;
		duringModelCall?.();
		prompt = String(JSON.parse(String(init?.body)).messages[1].content);
		return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
	}
	if (url.includes("overpass")) return Response.json({ elements: [] });
	if (url.includes("api-adresse")) return Response.json({ features: [] });
	return new Response("not found", { status: 404, statusText: "Not Found" });
}

let dir: string;
let db: Db;
const was = { ...llm };

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-renaming-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (u: string | URL | Request, init?: RequestInit) => fakeFetch(u, init)),
	);
	Object.assign(llm, { provider: "openai", model: "test-model", url: "http://model.test/v1" });
	modelCalls = 0;
	fileUrl = FILE;
	duringModelCall = null;
	reply = answer();
	csv = [HEADER, row("0690001A", 45.76, 4.83), row("0690002B", 45.77, 4.84)].join("\n");

	db.insert(t.areas)
		.values({
			id: "lyo",
			name: "Lyon",
			def: "relation",
			rel: "120965",
			bbox: [45.7, 4.77, 45.81, 4.9],
			centerLat: 45.76,
			centerLon: 4.83,
			sqkm: 48,
		})
		.run();
	db.insert(t.sources)
		.values({
			id: "schools",
			name: "Schools",
			kind: "registry",
			health: "ok",
			floor: 0.5,
			endpoint: DATASET,
			matching: "amenity=school",
			preset: "FR:school",
		})
		.run();
	db.insert(t.areaSources).values({ areaId: "lyo", sourceId: "schools" }).run();
});

afterEach(() => {
	vi.unstubAllGlobals();
	Object.assign(llm, was);
	rmSync(dir, { recursive: true, force: true });
});

const run = () => db.select().from(t.runs).orderBy(t.runs.id).all().at(-1);
const stored = () =>
	db.select().from(t.sourceRenamings).where(eq(t.sourceRenamings.sourceId, "schools")).get();
const source = () => db.select().from(t.sources).where(eq(t.sources.id, "schools")).get();
const cands = () => db.select().from(t.candidates).all();
const age = () =>
	db
		.update(t.candidates)
		.set({ seenAt: new Date(Date.now() - 60_000) })
		.run();

describe("columns the app does not know", () => {
	it("are renamed by the model, stored with the columns they were made for, and read into candidates", async () => {
		await runSource(db, "schools");

		expect(modelCalls).toBe(1);
		expect(JSON.parse(prompt).columns.map((c: { column: string }) => c.column)).toEqual(
			HEADER.split(","),
		);
		expect(stored()).toMatchObject({
			mapping: "FR:school",
			columns: HEADER.split(","),
			model: "openai · test-model",
			renaming: { rename: { uai: "id", tel: "phone" }, ignored: {}, steps: {} },
		});
		expect(run()).toMatchObject({ result: "ok", cands: 2 });
		expect(run()?.message).toMatch(
			/^columns renamed by openai · test-model for FR:school: 7 renamed, 0 read by a step, 0 ignored$/,
		);

		const all = cands();
		expect(all.map((c) => c.sourceRecordKey).sort()).toEqual(["0690001A", "0690002B"]);
		const tags = db
			.select()
			.from(t.tags)
			.all()
			.filter((x) => x.candidateId === all[0].id);
		const byKey = Object.fromEntries(tags.map((x) => [x.k, x]));
		expect(byKey["ref:UAI"]).toBeDefined();
		expect(byKey.phone?.v).toBe("+33 4 78 12 34 56");
		const evidence = db.select().from(t.evidence).all();
		expect(evidence.map((e) => e.path)).toContain("tel");
		expect(evidence.map((e) => e.path)).not.toContain("telephone");
		expect(evidence.map((e) => e.path)).toContain("uai");
		expect(evidence.map((e) => e.path)).not.toContain("identifiant_de_l_etablissement");
	});

	it("make no second call while the columns are exactly the stored list", async () => {
		await runSource(db, "schools");
		age();
		await runSource(db, "schools");

		expect(modelCalls).toBe(1);
		expect(run()).toMatchObject({ result: "ok" });
		expect(run()?.message ?? "").not.toMatch(/renamed/);
		expect(source()?.renamingUsed).toBe("stored");
	});

	it("are asked about again when a column is gone", async () => {
		await runSource(db, "schools");
		age();
		const five = HEADER.split(",").slice(0, 5);
		csv = [five.join(","), row("0690001A", 45.76, 4.83).split(",").slice(0, 5).join(",")].join(
			"\n",
		);
		reply = { columns: answer().columns.filter((c) => five.includes(c.column)) };
		await runSource(db, "schools");

		expect(modelCalls).toBe(2);
		expect(run()?.message).toMatch(/^columns renamed again by /);
		expect(stored()?.columns).toEqual(five);
	});

	it("are asked about again when a column appears", async () => {
		await runSource(db, "schools");
		age();
		csv = [`${HEADER},fax`, `${row("0690001A", 45.76, 4.83)},0478000000`].join("\n");
		reply = {
			columns: [
				...answer().columns,
				{ ...ITEM, column: "fax", action: "ignore", reason: "no OSM key" },
			],
		};
		await runSource(db, "schools");

		expect(modelCalls).toBe(2);
		expect(run()?.message).toMatch(/^columns renamed again by /);
		expect(stored()?.columns).toContain("fax");
	});

	it("fail the run, and store nothing, when the model names an input the mapping does not declare", async () => {
		reply = answer({ tel: "fax" });
		await runSource(db, "schools");

		expect(run()).toMatchObject({ result: "failed", cands: 0 });
		expect(run()?.message).toBe(
			'the model\'s column renaming for FR:school was refused and nothing stored: column "tel" is renamed to "fax", which FR:school does not declare',
		);
		expect(stored()).toBeUndefined();
		expect(cands()).toEqual([]);
	});

	it("fail the run, and store nothing, when a phone column does not parse as phones", async () => {
		csv = [
			HEADER,
			row("0690001A", 45.76, 4.83, "sur demande"),
			row("0690002B", 45.77, 4.84, "voir site"),
		].join("\n");
		await runSource(db, "schools");

		expect(run()).toMatchObject({ result: "failed" });
		expect(run()?.message).toMatch(
			/column "tel" is renamed to phone, but 0 of 2 sample values read as a phone number/,
		);
		expect(stored()).toBeUndefined();
		expect(cands()).toEqual([]);
	});

	it("fail the run with a readable message when no model is configured", async () => {
		Object.assign(llm, { provider: null, model: undefined });
		await runSource(db, "schools");

		expect(modelCalls).toBe(0);
		expect(run()).toMatchObject({ result: "failed" });
		expect(run()?.message).toMatch(/no model is configured to rename them: set LLM_PROVIDER/);
	});

	it("fail the run when the model answers something that is not a renaming", async () => {
		reply = { nope: true };
		await runSource(db, "schools");

		expect(run()?.message).toMatch(/the model's answer does not fit the schema/);
		expect(stored()).toBeUndefined();
	});
});

describe("columns the app ships a renaming for", () => {
	it("make no model call", async () => {
		csv = [
			"identifiant_de_l_etablissement,nom_etablissement,type_etablissement,latitude,longitude,telephone",
			"0690001A,Collège A,Collège,45.76,4.83,0478123456",
		].join("\n");
		await runSource(db, "schools");

		expect(modelCalls).toBe(0);
		expect(run()).toMatchObject({ result: "ok", cands: 1 });
		expect(stored()).toBeUndefined();
	});
});

describe("what the sources page loads", () => {
	it("says the mapping, the stored renaming and whether a rename is asked", async () => {
		expect((await loadSources(db))[0].columnMapping).toMatchObject({
			mapping: "FR:school",
			title: "Schools in France",
			origin: null,
			stored: null,
			renameRequested: false,
			refusal: null,
		});
		await runSource(db, "schools");
		requestRename(db, "schools", true);

		const { columnMapping } = (await loadSources(db))[0];
		expect(columnMapping?.origin).toBe("stored");
		expect(columnMapping?.stored).toMatchObject({
			model: "openai · test-model",
			columns: 7,
			steps: [],
			ignored: [],
		});
		expect(columnMapping?.stored?.renamed).toContainEqual(["tel", "phone"]);
		expect(columnMapping?.stored?.madeAt).toMatch(/^\d\d-\d\d-\d{4} \d\d:\d\d$/);
		expect(columnMapping?.renameRequested).toBe(true);
	});

	it("says the step a stored column stands for, short", async () => {
		db.update(t.sources).set({ renamingUsed: "stored" }).run();
		db.insert(t.sourceRenamings)
			.values({
				sourceId: "schools",
				mapping: "FR:school",
				columns: ["nom"],
				renaming: {
					mapping: "FR:school",
					rename: {},
					ignored: {},
					steps: { nom: { name: "fr.annuaire-education/sites", as: "nom_etablissement" } },
				},
				model: "m",
				madeAt: new Date(),
			})
			.run();

		expect((await loadSources(db))[0].columnMapping?.stored?.steps).toEqual([
			["nom", "sites", "nom_etablissement"],
		]);
	});

	it("shows a stored renaming of a mapping the app no longer ships, and renders", async () => {
		db.update(t.sources).set({ preset: null, renamingUsed: "stored" }).run();
		db.insert(t.sourceRenamings)
			.values({
				sourceId: "schools",
				mapping: "FR:xyz",
				columns: ["a"],
				renaming: { mapping: "FR:xyz", rename: { a: "id" }, ignored: {}, steps: {} },
				model: "m",
				madeAt: new Date(),
			})
			.run();

		expect((await loadSources(db))[0].columnMapping).toMatchObject({
			mapping: "FR:xyz",
			title: null,
		});
	});

	it("says nothing for a source no mapping is named for", async () => {
		db.update(t.sources).set({ preset: null }).run();
		expect((await loadSources(db))[0].columnMapping).toBeNull();
	});
});

describe("rename again", () => {
	it("asks the model although the columns are stored, and clears the request once stored", async () => {
		await runSource(db, "schools");
		age();
		expect(requestRename(db, "schools", true)).toBeNull();
		expect(source()?.renameRequestedAt).not.toBeNull();
		await runSource(db, "schools");

		expect(modelCalls).toBe(2);
		expect(run()?.message).toMatch(/^columns renamed again by /);
		expect(source()?.renameRequestedAt).toBeNull();
	});

	it("leaves the request standing, and the stored renaming as it was, when the new answer fails its checks", async () => {
		await runSource(db, "schools");
		const before = stored();
		age();
		requestRename(db, "schools", true);
		reply = answer({ tel: "fax" });
		await runSource(db, "schools");

		expect(run()).toMatchObject({ result: "failed" });
		expect(source()?.renameRequestedAt).not.toBeNull();
		expect(stored()).toEqual(before);
	});

	it("is refused, and sets nothing, for a source that reads no columns, one that does not exist, or no model", () => {
		expect(requestRename(db, "nope", true)).toMatch(/does not exist/);
		expect(requestRename(db, "schools", false)).toMatch(/LLM_PROVIDER/);
		expect(source()?.renameRequestedAt).toBeNull();
		db.update(t.sources).set({ extractor: "model" }).run();
		expect(requestRename(db, "schools", true)).toMatch(/no columns/);
		expect(source()?.renameRequestedAt).toBeNull();
	});

	it("is refused, with the reason the button gives, where the last read used the shipped renaming", async () => {
		csv = [
			"identifiant_de_l_etablissement,nom_etablissement,type_etablissement,latitude,longitude",
			"0690001A,Collège A,Collège,45.76,4.83",
		].join("\n");
		await runSource(db, "schools");

		expect(source()?.renamingUsed).toBe("shipped");
		const refused = requestRename(db, "schools", true);
		expect(refused).toMatch(/shipped with the app/);
		expect(source()?.renameRequestedAt).toBeNull();
		const { columnMapping } = (await loadSources(db))[0];
		expect(columnMapping).toMatchObject({
			origin: "shipped",
			refusal: { label: "shipped columns" },
		});
		expect(columnMapping?.refusal?.reason).toBe(refused);
	});

	it("is not lost by a run that was already asking the model when it was pressed", async () => {
		const earlier = new Date(Date.now() - 60_000);
		db.update(t.sources).set({ renameRequestedAt: earlier }).run();
		duringModelCall = () => {
			expect(requestRename(db, "schools", true)).toBeNull();
		};
		await runSource(db, "schools");

		expect(modelCalls).toBe(1);
		expect(stored()).toBeDefined();
		expect(source()?.renameRequestedAt?.getTime()).toBeGreaterThan(earlier.getTime());
	});
});

describe("precedence", () => {
	it("reads the shipped renaming's columns through it, whatever is stored and asked", async () => {
		await runSource(db, "schools");
		const before = stored();
		age();
		requestRename(db, "schools", true);
		csv = [
			"identifiant_de_l_etablissement,nom_etablissement,type_etablissement,latitude,longitude",
			"0690001A,Collège A,Collège,45.76,4.83",
		].join("\n");
		await runSource(db, "schools");

		expect(modelCalls).toBe(1);
		expect(run()).toMatchObject({ result: "ok", cands: 1 });
		expect(source()).toMatchObject({ renamingUsed: "shipped", renameRequestedAt: null });
		expect(stored()).toEqual(before);
	});
});

describe("a column that appears past the sample", () => {
	const rows = (n: number, extra: (i: number) => Record<string, string>) =>
		Array.from({ length: n }, (_, i) => {
			const [uai, nom, type, latitude, longitude, tel, statut] = row(
				`06900${String(i).padStart(2, "0")}A`,
				45.76 + i / 1000,
				4.83,
			).split(",");
			return JSON.stringify({ uai, nom, type, latitude, longitude, tel, statut, ...extra(i) });
		}).join("\n");

	beforeEach(() => {
		fileUrl = LINES;
		csv = rows(25, (i): Record<string, string> => (i === 22 ? { fax: "0478000000" } : {}));
	});

	it("is counted and named in the run's message, asked about at the next run, and left out of this one", async () => {
		await runSource(db, "schools");

		expect(modelCalls).toBe(1);
		expect(JSON.parse(prompt).columns.map((c: { column: string }) => c.column)).not.toContain(
			"fax",
		);
		expect(run()).toMatchObject({ result: "ok", cands: 25 });
		expect(run()?.message).toMatch(
			/1 column appeared past the sample: fax — renamed on the next run$/,
		);
		expect(source()?.renameRequestedAt).not.toBeNull();
		expect(source()?.lateColumns).toEqual(["fax"]);
	});

	it("is renamed at the next run, which then matches the stored list exactly", async () => {
		await runSource(db, "schools");
		age();
		reply = {
			columns: [
				...answer().columns,
				{ ...ITEM, column: "fax", action: "ignore", reason: "no OSM key" },
			],
		};
		await runSource(db, "schools");

		expect(modelCalls).toBe(2);
		expect(JSON.parse(prompt).columns.map((c: { column: string }) => c.column)).toContain("fax");
		expect(stored()?.columns).toContain("fax");
		expect(source()?.renameRequestedAt).toBeNull();
		expect(run()?.message ?? "").not.toMatch(/appeared past/);

		age();
		await runSource(db, "schools");
		expect(modelCalls).toBe(2);
		expect(run()).toMatchObject({ result: "ok" });
		expect(run()?.message ?? "").not.toMatch(/renamed|appeared past/);
	});

	it("stops counting once the read has the shipped columns alone", async () => {
		await runSource(db, "schools");
		age();
		await runSource(db, "schools");
		age();
		fileUrl = FILE;
		csv = [
			"identifiant_de_l_etablissement,nom_etablissement,type_etablissement,latitude,longitude",
			"0690001A,Collège A,Collège,45.76,4.83",
		].join("\n");
		const calls = modelCalls;
		await runSource(db, "schools");

		expect(modelCalls).toBe(calls);
		expect(source()?.renamingUsed).toBe("shipped");
	});

	it("is only named, and nothing is asked, where the shipped renaming covers the read", async () => {
		csv = Array.from({ length: 25 }, (_, i) =>
			JSON.stringify({
				identifiant_de_l_etablissement: `06900${String(i).padStart(2, "0")}A`,
				nom_etablissement: "Collège",
				type_etablissement: "Collège",
				latitude: "45.76",
				longitude: "4.83",
				...(i === 22 ? { colonne_nouvelle: "x" } : {}),
			}),
		).join("\n");
		await runSource(db, "schools");

		expect(modelCalls).toBe(0);
		expect(run()).toMatchObject({ result: "ok", cands: 25 });
		expect(run()?.message).toMatch(
			/1 column appeared past the sample: colonne_nouvelle — left out, the shipped renaming does not cover them/,
		);
		expect(source()).toMatchObject({ renameRequestedAt: null, lateColumns: [] });
	});
});

describe("columns custom to a source", () => {
	const DATE_HEADER = "uai,nom,type,latitude,longitude,date";
	const sourceTags = (sourceId: string) => {
		const ids = new Map(
			cands()
				.filter((c) => c.sourceId === sourceId)
				.map((c) => [c.id, c.sourceRecordKey]),
		);
		return db
			.select()
			.from(t.tags)
			.all()
			.filter((x) => ids.has(x.candidateId))
			.map((x) => `${ids.get(x.candidateId)} ${x.k}=${x.v}`)
			.sort();
	};

	it("are read by the mapping's own rules, without the overrides of the shipped source", async () => {
		const date = (uai: string, kind: string, opened: string) =>
			`${uai},Ecole ${uai},${kind},45.76,4.83,${opened}`;
		csv = [
			DATE_HEADER,
			date("0690001A", "Ecole", "1965-09-01"),
			date("0690002B", "Collège", "1992-09-01"),
		].join("\n");
		annuaire = [
			"identifiant_de_l_etablissement,nom_etablissement,type_etablissement,latitude,longitude,date_ouverture",
			date("0690001A", "Ecole", "1965-09-01"),
			date("0690002B", "Collège", "1992-09-01"),
		].join("\n");
		reply = {
			columns: [
				...answer().columns.filter((c) => DATE_HEADER.split(",").includes(c.column)),
				{ ...ITEM, column: "date", action: "rename", input: "opening_date" },
			],
		};
		db.insert(t.sources)
			.values({
				id: "annuaire",
				name: "Annuaire",
				kind: "registry",
				health: "ok",
				floor: 0.5,
				endpoint: ANNUAIRE_DATASET,
				matching: "amenity=school",
				preset: "annuaire-education",
			})
			.run();
		db.insert(t.areaSources).values({ areaId: "lyo", sourceId: "annuaire" }).run();
		await runSource(db, "schools");
		await runSource(db, "annuaire");

		const custom = sourceTags("schools");
		const shipped = sourceTags("annuaire");
		const dates = (xs: string[]) => xs.filter((x) => x.includes("start_date"));
		expect(dates(shipped)).toEqual(["0690002B start_date=1992-09-01"]);
		expect(dates(custom)).toEqual([
			"0690001A start_date=1965-09-01",
			"0690002B start_date=1992-09-01",
		]);
		const rest = (xs: string[]) =>
			xs.filter((x) => !x.includes("start_date") && !x.includes(" name="));
		expect(rest(custom)).toEqual(rest(shipped));
	});
});

describe("the column an API read is ordered by", () => {
	const education = {
		id: "schools",
		extractor: "deterministic" as const,
		preset: "annuaire-education",
		renameRequestedAt: null,
	};
	const shipped = renamingFor("fr/annuaire-education").columns;

	it("is the preset's key while the dataset has a column nobody has seen, or a rename again is pending", () => {
		const key = "identifiant_de_l_etablissement";
		const resolver = (over = {}) => new ReaderResolver(db, { ...education, ...over }, () => {});
		expect(resolver().keyColumn([...shipped, "nouveau_champ"])).toBe(key);
		expect(resolver({ renameRequestedAt: new Date() }).keyColumn(shipped)).toBe(key);
	});
});
