import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "$lib/server/db/client";
import { runMigrations } from "$lib/server/db/migrate";
import * as t from "$lib/server/db/schema";
import type { OsmElement } from "./types";
import { mappingFor, renamingFor, shippedCovering, shippedSources } from "./mapping/files";
import { indexRefs } from "./match/refs";
import { matchWarnings } from "./match/warnings";
import { runSource } from "./runner";

const DATASET = "https://www.data.gouv.fr/api/1/datasets/geodae-test/";
const FILE = "https://static.data.gouv.fr/20261007-100011/geodae.csv";

const COLUMNS = renamingFor("fr/geodae").columns;

/** Rows of the live file of 07-10-2026, with the columns the mapping ignores left empty. */
const REAL: Record<string, string>[] = [
	{
		c_gid: "1899",
		c_etat_valid: "validées",
		c_lat_coor1: "45.6127",
		c_long_coor1: "4.04854",
		c_acc: "Extérieur",
		c_acc_lib: "t",
		c_acc_etg: "0",
		c_acc_complt: "Entrée principale du bâtiment, au niveau du dépose minute",
		c_date_instal: "2019-11-18",
		c_etat_fonct: "En fonctionnement",
		c_doublon: "f",
		c__edit_datemaj: "2023-04-11 19:30:44.302674",
		c_dae_mobile: "f",
		c_dispo_horaires: "24/7",
	},
	{
		c_gid: "2362",
		c_etat_valid: "validées",
		c_lat_coor1: "49.2695",
		c_long_coor1: "6.30913",
		c_acc: "Extérieur",
		c_acc_lib: "t",
		c_acc_complt: "Entre les deux portes d'entrée, sur la façade_ Tél. Mairie : 0382835192",
		c_date_instal: "2013-11-25",
		c_etat_fonct: "En fonctionnement",
		c_doublon: "f",
		c__edit_datemaj: "2023-04-11 19:30:44.302674",
		c_dae_mobile: "f",
		c_dispo_horaires: "24/7",
	},
	{
		c_gid: "135358",
		c_etat_valid: "validées",
		c_lat_coor1: "42.2995",
		c_long_coor1: "9.15383",
		c_acc: "Intérieur",
		c_acc_lib: "t",
		c_acc_etg: "R+1",
		c_acc_complt:
			"Hall des sports Raymond Montet, à côté du local SSI, Signalétique de tous points de l'établissement",
		c_etat_fonct: "En fonctionnement",
		c_doublon: "f",
		c__edit_datemaj: "2023-04-11 20:00:53.809533",
		c_dae_mobile: "f",
		c_dispo_horaires: "Mo-Su off",
	},
	{
		c_gid: "132245",
		c_etat_valid: "validées",
		c_lat_coor1: "43.53028",
		c_long_coor1: "0.212806",
		c_acc: "Intérieur",
		c_acc_lib: "f",
		c_acc_etg: "0",
		c_acc_complt: "Dans la salle des fetes  accessible sur manifestations - Selon évènements",
		c_disp_complt: "Selon évènements",
		c_date_instal: "2021-05-28",
		c_etat_fonct: "En fonctionnement",
		c_doublon: "f",
		c__edit_datemaj: "2026-03-11 14:19:09.835872",
		c_dae_mobile: "f",
		c_dispo_horaires: "24/7",
	},
	{
		c_gid: "2456",
		c_etat_valid: "en attente de validation",
		c_lat_coor1: "49.01",
		c_long_coor1: "6.39173",
		c_acc: "Intérieur",
		c_acc_lib: "t",
		c_acc_complt: "Entrée de la salle : route de Béchy_ Tél. : 03 87 64 69 98",
		c_etat_fonct: "En fonctionnement",
		c_doublon: "f",
		c__edit_datemaj: "2023-12-28 13:56:54.023876",
		c_dae_mobile: "f",
		c_dispo_horaires: "Mo-Su off",
	},
	{
		c_gid: "4024",
		c_etat_valid: "validées",
		c_lat_coor1: "44.8575",
		c_long_coor1: "-0.588066",
		c_acc: "Intérieur",
		c_acc_lib: "f",
		c_acc_etg: "2",
		c_acc_complt: "Chariot d'urgence",
		c_etat_fonct: "En fonctionnement",
		c_doublon: "t",
		c__edit_datemaj: "2023-04-11 19:30:44.302674",
		c_dae_mobile: "f",
		c_dispo_horaires: "24/7",
	},
];

REAL.push({
	c_gid: "5240",
	c_etat_valid: "validées",
	c_lat_coor1: "44.0181",
	c_long_coor1: "1.3551",
	c_com_nom: "Montauban",
	c_acc: "Intérieur",
	c_acc_lib: "t",
	c_etat_fonct: "En fonctionnement",
	c_doublon: "f",
	c__edit_datemaj: "2023-04-11 19:31:44.209863",
	c_dae_mobile: "f",
	c_dispo_horaires: "Mo-Su off",
});

const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
const csv = [
	COLUMNS.join(";"),
	...REAL.map((r) => COLUMNS.map((c) => quote(r[c] ?? "")).join(";")),
].join("\n");

const node = (id: number, lat: number, lon: number, tags: Record<string, string>) => ({
	type: "node",
	id,
	lat,
	lon,
	version: 2,
	tags: { emergency: "defibrillator", ...tags },
});

const METRE = 1 / 111_195;

let osm: { elements: unknown[] };
let dir: string;
let db: Db;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-defib-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url === DATASET)
				return Response.json({
					license: "lov2",
					resources: [{ format: "csv", type: "main", url: FILE, last_modified: "2026-10-07" }],
				});
			if (url === FILE) return new Response(csv);
			if (url.includes("overpass")) return Response.json(osm);
			return new Response("not found", { status: 404, statusText: "Not Found" });
		}),
	);
	db.insert(t.areas)
		.values({
			id: "fr",
			name: "France",
			def: "relation",
			rel: "1403916",
			bbox: [41, -5.5, 51.5, 10],
			centerLat: 46.5,
			centerLon: 2.5,
			sqkm: 550000,
		})
		.run();
	db.insert(t.sources)
		.values({
			id: "geodae",
			name: "Géo'DAE",
			kind: "registry",
			health: "ok",
			floor: 0.5,
			endpoint: DATASET,
			matching: "emergency=defibrillator",
			preset: "FR:defibrillator",
		})
		.run();
	db.insert(t.areaSources).values({ areaId: "fr", sourceId: "geodae" }).run();
	osm = {
		elements: [
			node(1, 45.6127 + 8 * METRE, 4.04854, { "ref:FR:GeoDAE": "1899", indoor: "no" }),
			node(2, 49.2695 + 10 * METRE, 6.30913, { name: "Défibrillateur" }),
			node(3, 42.2995 + 200 * METRE, 9.15383, {}),
			node(4, 43.53028 + 100 * METRE, 0.212806, { "ref:FR:GeoDAE": "70" }),
		],
	};
	await runSource(db, "geodae");
});

afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(dir, { recursive: true, force: true });
});

const cand = (key: string) =>
	db.select().from(t.candidates).where(eq(t.candidates.sourceRecordKey, key)).get();
const tagsOf = (key: string) =>
	Object.fromEntries(
		db
			.select()
			.from(t.tags)
			.where(eq(t.tags.candidateId, cand(key)?.id as string))
			.all()
			.map((x) => [x.k, x.op === "del" ? null : x.v]),
	);

describe("a defibrillator from Géo'DAE, with no code of its own on the record's path", () => {
	it("reads the dataset, drops the record flagged as a duplicate and keeps the rest", () => {
		expect(db.select().from(t.runs).get()).toMatchObject({ result: "ok", fetched: 7, cands: 6 });
		expect(cand("4024")).toBeUndefined();
	});

	it("shows the operator's location note as the name, and the commune where there is none", () => {
		expect(cand("1899")?.name).toBe("Entrée principale du bâtiment, au niveau du dépose minute");
		expect(cand("2362")?.name).toBe("Entre les deux portes d'entrée, sur la façade");
		expect(cand("5240")?.name).toBe("Montauban");
	});

	it("matches by the Géo'DAE ref and adds only what the node lacks", () => {
		expect(cand("1899")).toMatchObject({ type: "update", osmId: "node/1" });
		expect(tagsOf("1899")).toEqual({
			access: "yes",
			"defibrillator:location": "Entrée principale du bâtiment, au niveau du dépose minute",
			opening_hours: "24/7",
			start_date: "2019-11-18",
		});
	});

	it("matches a node 10 m away that has no ref, by position alone even where the node is named, and gives it the ref", () => {
		expect(cand("2362")).toMatchObject({ type: "update", osmId: "node/2" });
		expect(tagsOf("2362")).toMatchObject({
			"ref:FR:GeoDAE": "2362",
			indoor: "no",
			"defibrillator:location": "Entre les deux portes d'entrée, sur la façade",
		});
	});

	it("proposes a new defibrillator where the nearest node is 200 m off, with no banner", () => {
		expect(cand("135358")).toMatchObject({ type: "new", osmId: null, warning: null });
		expect(tagsOf("135358")).toMatchObject({
			emergency: "defibrillator",
			level: "1",
			indoor: "yes",
		});
	});

	it("warns of a possible duplicate within 150 m, which another ref does not rule out", () => {
		expect(cand("132245")).toMatchObject({ type: "new", osmId: null });
		expect(cand("132245")?.warning).toMatch(
			/Possible duplicate: emergency=defibrillator .*node\/4/,
		);
	});

	it("proposes level 0 for a bare floor 0 of an indoor device, and none for an outdoor one", () => {
		expect(tagsOf("132245")).toMatchObject({ indoor: "yes", level: "0" });
		expect(tagsOf("1899")).not.toHaveProperty("level");
	});

	it("tells the reviewer a position is approximate where the registry has not validated it", () => {
		expect(cand("2456")?.warning).toContain("has not validated this defibrillator");
		expect(cand("2456")?.warning).toContain("three decimals or fewer");
	});
});

describe("two nodes carrying one Géo'DAE id", () => {
	const at = (id: number, lat: number) =>
		node(id, lat, 4, { "ref:FR:GeoDAE": "156653" }) as unknown as OsmElement;
	const [a, b] = [at(10, 45), at(11, 45 + 300 * METRE)];
	const x = {
		kind: "FR:defibrillator",
		lat: 45,
		lon: 4,
		name: "",
		tags: [],
		refs: { "ref:FR:GeoDAE": "156653" },
	};

	it("are one site mapped as two objects, though 300 m apart", () => {
		const index = indexRefs([a, b], ["ref:FR:GeoDAE"]);
		expect(matchWarnings(x, a, [a, b], index)[0]).toMatch(
			/^Same site may be mapped as 2 objects \(also node\/11/,
		);
	});
});

describe("the shipped files", () => {
	it("declare matching as the main key and the id as a site, with no kit", () => {
		expect(mappingFor("FR:defibrillator").matching).toEqual({
			main: ["emergency"],
			refs: { "ref:FR:GeoDAE": { site: true } },
		});
	});

	it("offer the register as an official source, found by its columns and by its dataset", () => {
		expect(shippedSources().map((r) => r.source)).toContain("fr/geodae");
		expect(shippedCovering(COLUMNS)?.source).toBe("fr/geodae");
		expect(renamingFor("fr/geodae").official?.source.endpoint).toMatch(
			/\/datasets\/61556e1e9d6adb2df86eb0fc\/$/,
		);
	});
});
