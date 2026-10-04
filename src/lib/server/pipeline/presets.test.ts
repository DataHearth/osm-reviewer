import { describe, expect, it } from "vitest";
import { detectPreset, phoneFR, presetById, website } from "./presets";
import type { Row } from "./types";

const irveRow = (over: Row = {}): Row => ({
	id_station_itinerance: "FRS63P0001",
	id_pdc_itinerance: "FR*S63*E0001*1",
	nom_station: "Parking Hôtel de Ville",
	nom_operateur: "Operateur SA",
	nom_enseigne: "ReseauCharge",
	adresse_station: "1 place de la Mairie",
	consolidated_commune: "Lyon",
	consolidated_code_postal: "69001",
	consolidated_longitude: "4.835",
	consolidated_latitude: "45.764",
	consolidated_is_lon_lat_correct: "true",
	nbre_pdc: "2",
	puissance_nominale: "22",
	prise_type_2: "true",
	prise_type_combo_ccs: "false",
	gratuit: "false",
	paiement_acte: "true",
	condition_acces: "Accès libre",
	horaires: "24/7",
	...over,
});

describe("IRVE preset", () => {
	const irve = presetById("irve");
	if (!irve) throw new Error("irve preset missing");

	it("is detected from its columns", () => {
		expect(detectPreset(Object.keys(irveRow()))?.id).toBe("irve");
		expect(detectPreset(["a", "b"])).toBeUndefined();
	});

	it("groups the rows of one station into one record with socket counts and power", () => {
		const x = irve.extract(
			[irveRow(), irveRow({ id_pdc_itinerance: "FR*S63*E0001*2", puissance_nominale: "50" })],
			"https://x.test/f.csv#FRS63P0001",
		);
		const tags = Object.fromEntries((x?.tags ?? []).map((t) => [t.k, t.v]));
		expect(tags).toMatchObject({
			amenity: "charging_station",
			operator: "Operateur SA",
			network: "ReseauCharge",
			capacity: "2",
			"socket:type2": "2",
			"socket:type2:output": "50 kW",
			fee: "yes",
			access: "yes",
			opening_hours: "24/7",
			"ref:EU:EVSE": "FR*S63*E0001*1;FR*S63*E0001*2",
		});
		expect(tags["socket:type2_combo"]).toBeUndefined();
		expect(x?.refs["ref:EU:EVSE"]).toBe("FR*S63*E0001*1;FR*S63*E0001*2");
		expect(x?.lat).toBe(45.764);
	});

	it("reads each charge point from its newest declaration only", () => {
		const point = (n: number, over: Row) =>
			irveRow({ id_pdc_itinerance: `FR*S63*E0001*${n}`, ...over });
		const old = { date_maj: "2026-07-21", nbre_pdc: "4", nom_operateur: "Ancien SA" };
		const x = irve.extract(
			[
				point(1, old),
				point(1, { date_maj: "2026-10-04" }),
				point(2, old),
				point(2, { date_maj: "2026-10-04" }),
			],
			"u",
		);
		const tags = Object.fromEntries((x?.tags ?? []).map((t) => [t.k, t]));
		expect(tags.capacity).toMatchObject({ v: "2", parts: [{}, { text: "2" }] });
		expect(tags["socket:type2"]?.v).toBe("2");
		expect(tags.operator?.v).toBe("Operateur SA");
	});

	it("proposes access=yes only to fill a gap, and nothing for reserved access", () => {
		const access = (condition: string) =>
			irve
				.extract([irveRow({ condition_acces: condition })], "u")
				?.tags.find((t) => t.k === "access");
		expect(access("Accès libre")).toMatchObject({ v: "yes", addOnly: true });
		expect(access("Accès réservé")).toBeUndefined();
	});

	describe("socket output", () => {
		const outputs = (rows: Row[]) =>
			Object.fromEntries(
				(irve.extract(rows, "u")?.tags ?? [])
					.filter((t) => t.k.startsWith("socket:"))
					.map((t) => [t.k, [t.v, t.conf]]),
			);
		const point = (n: number, over: Row) =>
			irveRow({ id_pdc_itinerance: `FR*S63*E0001*${n}`, prise_type_2: "false", ...over });

		it("pins a DC unit's power on its DC connectors, never on its AC type 2 cable", () => {
			// RELAIS GARIBALDI's shape: 2 triple units (CCS, CHAdeMO, type 2) and 5 CCS-only.
			const triple = {
				prise_type_combo_ccs: "true",
				prise_type_chademo: "true",
				prise_type_2: "true",
			};
			const rows = [
				point(1, { ...triple, puissance_nominale: "300" }),
				point(2, { ...triple, puissance_nominale: "300" }),
				...[3, 4, 5, 6, 7].map((n) =>
					point(n, { prise_type_combo_ccs: "true", puissance_nominale: "300" }),
				),
			];
			expect(outputs(rows)).toEqual({
				"socket:type2": ["2", 0.9],
				"socket:type2_combo": ["7", 0.9],
				"socket:type2_combo:output": ["300 kW", 0.7],
				"socket:chademo": ["2", 0.9],
				"socket:chademo:output": ["300 kW", 0.7],
			});
		});

		it("takes each type's power from the points that carry it, not the station's maximum", () => {
			const rows = [
				point(1, { prise_type_2: "true", puissance_nominale: "7.4" }),
				point(2, { prise_type_combo_ccs: "true", puissance_nominale: "150" }),
			];
			expect(outputs(rows)).toMatchObject({
				"socket:type2:output": ["7.4 kW", 0.8],
				"socket:type2_combo:output": ["150 kW", 0.8],
			});
		});

		it("gives an AC type no output once one of its points shares the power", () => {
			const rows = [
				point(1, { prise_type_2: "true", puissance_nominale: "22" }),
				point(2, { prise_type_2: "true", prise_type_ef: "true", puissance_nominale: "22" }),
			];
			const o = outputs(rows);
			expect(o["socket:type2"]).toEqual(["2", 0.9]);
			expect(o["socket:type2:output"]).toBeUndefined();
			expect(o["socket:typee:output"]).toBeUndefined();
		});
	});

	it("keeps the field and value an evidence row quotes", () => {
		const x = irve.extract([irveRow()], "u");
		const op = x?.tags.find((t) => t.k === "operator");
		expect(op?.path).toBe("nom_operateur");
		expect(op?.parts).toEqual([
			{ text: "nom_operateur: ", mark: false },
			{ text: "Operateur SA", mark: true },
		]);
	});

	it("refuses coordinates the consolidation flagged as wrong", () => {
		expect(irve.position(irveRow({ consolidated_is_lon_lat_correct: "false" }))).toBeNull();
		expect(irve.position(irveRow())).toEqual([45.764, 4.835]);
	});

	it("passes valid opening_hours through and drops free text", () => {
		const tag = (h: string) =>
			irve.extract([irveRow({ horaires: h })], "u")?.tags.find((t) => t.k === "opening_hours")?.v;
		expect(tag("Mo-Fr 08:00-19:00")).toBe("Mo-Fr 08:00-19:00");
		expect(tag("Mo-Su 00:00-24:00")).toBe("24/7");
		expect(tag("ouvert la journée")).toBeUndefined();
	});
});

describe("Annuaire de l'éducation preset", () => {
	const edu = presetById("annuaire-education");
	if (!edu) throw new Error("preset missing");
	const row = (over: Row = {}): Row => ({
		identifiant_de_l_etablissement: "0690001A",
		nom_etablissement: "Ecole Jean Jaurès",
		type_etablissement: "Ecole",
		statut_public_prive: "Public",
		ecole_maternelle: "1",
		ecole_elementaire: "1",
		adresse_1: "2 rue Jaurès",
		code_postal: "69003",
		nom_commune: "Lyon",
		telephone: "04 72 00 00 01",
		web: "ecole-jaures.fr",
		siren_siret: "21690001000019",
		etat: "OUVERT",
		latitude: 45.76,
		longitude: 4.85,
		...over,
	});

	it("proposes tags with normalised phone and website", () => {
		const x = edu.extract([row()], "u");
		const tags = Object.fromEntries((x?.tags ?? []).map((t) => [t.k, t.v]));
		expect(tags).toMatchObject({
			amenity: "school",
			name: "Ecole Jean Jaurès",
			"ref:UAI": "0690001A",
			"ref:FR:SIRET": "21690001000019",
			phone: "+33 4 72 00 00 01",
			website: "https://ecole-jaures.fr",
			"operator:type": "public",
		});
		expect(x?.closedBy).toBeUndefined();
	});

	it("maps a maternelle-only école to kindergarten and a lycée to school", () => {
		const kind = (r: Row) => edu.extract([r], "u")?.tags.find((t) => t.k === "amenity")?.v;
		expect(kind(row({ ecole_elementaire: "0" }))).toBe("kindergarten");
		expect(kind(row({ type_etablissement: "Lycée" }))).toBe("school");
	});

	it("reads FERME as a closure, not an opening or a pending closure", () => {
		const x = edu.extract([row({ etat: "FERME" })], "u");
		expect(x?.closedBy?.path).toBe("etat");
		expect(edu.extract([row({ etat: "OUVERT" })], "u")?.closedBy).toBeUndefined();
		for (const etat of ["A OUVRIR", "A FERMER"])
			expect(edu.extract([row({ etat })], "u")?.closedBy).toBeUndefined();
	});

	it("needs a position", () => {
		expect(edu.extract([row({ latitude: "", longitude: "" })], "u")).toBeNull();
	});
});

describe("phoneFR", () => {
	it.each([
		["0561234567", "+33 5 61 23 45 67"],
		["05 61 23 45 67", "+33 5 61 23 45 67"],
		["+33 (0)5 61 23 45 67", "+33 5 61 23 45 67"],
		["0033561234567", "+33 5 61 23 45 67"],
		["12345", null],
	])("%s", (raw, want) => expect(phoneFR(raw)).toBe(want));
});

describe("website", () => {
	it("adds a scheme and drops a bare slash", () => {
		expect(website("example.org")).toBe("https://example.org");
		expect(website("http://example.org/a/")).toBe("http://example.org/a/");
		expect(website("not a url")).toBeNull();
	});
});
