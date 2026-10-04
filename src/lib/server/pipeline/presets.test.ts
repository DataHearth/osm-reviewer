import { describe, expect, it } from "vitest";
import {
	addressQuery,
	detectPreset,
	expandStreet,
	mergeSites,
	openedForSure,
	openingHours,
	personalMailbox,
	phoneFR,
	poolId,
	presetById,
	schoolAddress,
	schoolName,
	siteName,
	website,
} from "./presets";
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
			[irveRow(), irveRow({ id_pdc_itinerance: "FR*S63*E0001*2", puissance_nominale: "43" })],
			"https://x.test/f.csv#FRS63P0001",
		);
		const tags = Object.fromEntries((x?.tags ?? []).map((t) => [t.k, t.v]));
		expect(tags).toMatchObject({
			amenity: "charging_station",
			operator: "Operateur SA",
			network: "ReseauCharge",
			capacity: "2",
			"socket:type2": "2",
			"socket:type2:output": "43 kW",
			fee: "yes",
			access: "yes",
			opening_hours: "24/7",
			"ref:EU:EVSE": "FR*S63*P0001",
		});
		expect(tags["socket:type2_combo"]).toBeUndefined();
		expect(x?.refs["ref:EU:EVSE"]).toBe("FRS63P0001;FR*S63*E0001*1;FR*S63*E0001*2");
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

	it("makes one record of the stations an operator declared per charge point on one site", () => {
		const rec = (key: string, over: Row = {}) => ({
			key,
			rows: [
				irveRow({ id_station_itinerance: key, id_pdc_itinerance: key, nbre_pdc: "1", ...over }),
			],
		});
		const merged = mergeSites(
			[rec("S3"), rec("S1"), rec("S2"), rec("S4", { nom_operateur: "Autre SA" })],
			irve,
		);
		expect(merged.map((r) => [r.key, r.rows.length])).toEqual([
			["S1", 3],
			["S4", 1],
		]);
		const tags = Object.fromEntries(
			(irve.extract(merged[0].rows, "u")?.tags ?? []).map((t) => [t.k, t.v]),
		);
		expect(tags).toMatchObject({ capacity: "3", "socket:type2": "3" });
		expect(tags["ref:EU:EVSE"]).toBeUndefined();
	});

	it("makes one record of a site declared again at another position, under the smallest key", () => {
		const rec = (key: string, point: string, lat: string) => ({
			key,
			rows: [
				irveRow({
					id_station_itinerance: key,
					id_pdc_itinerance: point,
					consolidated_latitude: lat,
				}),
			],
		});
		const merged = mergeSites(
			[
				rec("FRSITE00000103", "FRALLEGO0020841", "45.7660"),
				rec("FRALLPTIS016", "FRALLEGO002084P1", "45.7640"),
				rec("FRALLPTIS099", "FRALLEGO002084P1", "45.7700"),
			],
			irve,
		);
		expect(merged.map((r) => [r.key, r.rows.length])).toEqual([
			["FRALLPTIS016", 2],
			["FRALLPTIS099", 1],
		]);
	});

	it("reads a fee from what fired, never from an unknown tariff", () => {
		const fee = (over: Row) =>
			irve
				.extract(
					[irveRow({ paiement_acte: "false", paiement_cb: "false", gratuit: "", ...over })],
					"u",
				)
				?.tags.find((t) => t.k === "fee");
		expect(fee({ tarification: "Inconnu" })).toBeUndefined();
		expect(fee({ tarification: "49 cts/kWh" })).toMatchObject({ v: "yes", path: "tarification" });
		expect(fee({ paiement_cb: "true" })).toMatchObject({ v: "yes", path: "paiement_cb" });
		expect(fee({ gratuit: "False" })).toMatchObject({ v: "yes", path: "gratuit" });
		expect(fee({ gratuit: "true" })).toMatchObject({ v: "no" });
		expect(fee({ gratuit: "true", tarification: "0,40 € TTC / kWh" })).toBeUndefined();
	});

	it("counts a station declared as one row by its declared points, and trusts no mismatched count", () => {
		const one = irve.extract([irveRow({ id_pdc_itinerance: "FRS63P0001", nbre_pdc: "6" })], "u");
		expect(one?.tags.find((t) => t.k === "capacity")?.v).toBe("6");
		expect(one?.tags.some((t) => t.k.startsWith("socket:"))).toBe(false);
		const evmap = irve.extract(
			[
				irveRow({
					id_station_itinerance: "FREVMP7648",
					id_pdc_itinerance: "FREVME7648",
					nbre_pdc: "3",
				}),
			],
			"u",
		);
		expect(evmap?.tags.find((t) => t.k === "capacity")?.v).toBe("3");
		expect(evmap?.tags.some((t) => t.k.startsWith("socket:"))).toBe(false);
		const off = irve.extract([irveRow({ nbre_pdc: "6" })], "u");
		expect(off?.tags.find((t) => t.k === "capacity")).toBeUndefined();
		expect(off?.notes?.[0]).toMatch(/declares 6 charge points and lists 1/);
	});

	it("counts a site of several stations by its listed points, and each one-row station by its count", () => {
		const carPark = ["FRG10P01", "FRG10P02"].flatMap((s) =>
			["1", "2", "3"].map((n) =>
				irveRow({ id_station_itinerance: s, id_pdc_itinerance: `${s}${n}`, nbre_pdc: "1" }),
			),
		);
		const listed = irve.extract(carPark, "u");
		expect(listed?.tags.find((t) => t.k === "capacity")?.v).toBe("6");
		expect(listed?.notes ?? []).not.toContainEqual(expect.stringMatching(/left out/));

		const rows = ["FRLIBP01", "FRLIBP02", "FRLIBP03"].map((s) =>
			irveRow({ id_station_itinerance: s, id_pdc_itinerance: s.replace("P", "E"), nbre_pdc: "2" }),
		);
		const site = irve.extract(rows, "u");
		expect(site?.tags.find((t) => t.k === "capacity")?.v).toBe("6");
		expect(site?.tags.some((t) => t.k.startsWith("socket:"))).toBe(false);
		expect(site?.notes).toContainEqual(
			"3 of the site's stations are each declared as a single row, so sockets are left out",
		);
	});

	const declared = (station: string, file: string, date: string, points: string[]) =>
		points.map((p) =>
			irveRow({
				id_station_itinerance: station,
				id_pdc_itinerance: p,
				datagouv_resource_id: file,
				date_maj: date,
				nbre_pdc: String(points.length),
			}),
		);
	const capacity = (rows: Row[]) => irve.extract(rows, "u")?.tags.find((t) => t.k === "capacity");

	it("reads each station from its newest declaration whole, and a site from all its stations", () => {
		const rows = [
			...declared("FRPD1PITMRSA02", "own", "2025-09-14", ["FRPD1E1", "FRPD1E2", "FRPD1E3"]),
			...declared("FRPD1PITMRSA02", "aggregated", "2025-10-20", ["FRPD1E1", "FRPD1E2"]),
			...declared("FRPD1PITMRSA01", "own", "2025-09-14", ["FRPD1E9"]),
		];
		const x = irve.extract(rows, "u");
		expect(capacity(rows)?.v).toBe("3");
		expect(x?.key).toBe("FRPD1PITMRSA01");
		expect(x?.refs["ref:EU:EVSE"]).toContain("FRPD1PITMRSA01");
	});

	it("drops a station a newer one lists whole or declares again under its name", () => {
		const again = [
			...declared("FRALLPTIS016", "y2023", "2023-07-12", ["FRALLEGO002084P1", "FRALLEGO002085P1"]),
			...declared("FRSITE00000103", "y2024", "2024-07-15", ["FRALLEGO0020841", "FRALLEGO8000461"]),
		];
		expect(capacity(again)?.v).toBe("2");
		const named = (rows: Row[], nom_station: string) => rows.map((r) => ({ ...r, nom_station }));
		const pool = named(
			declared("FRSWSP90234529", "agg", "2026-04-27", ["FRSWSE1", "FRSWSE2", "FRSWSE3"]),
			"ALFEN 2x22 MG VENISSIEUX",
		);
		const part = named(
			declared("FRSWSE1234651154", "own", "2026-09-29", ["FRSWSE3", "FRSWSE4"]),
			"EVBOX 120 MG VENISSIEUX",
		);
		expect(capacity([...pool, ...part])?.v).toBe("4");
		const whole = declared("FRSWSP1321486", "agg", "2026-10-03", ["FRSWSE3", "FRSWSE4", "FRSWSE5"]);
		expect(capacity([...pool, ...part, ...whole])?.v).toBe("5");
	});

	it("trusts no count its rows disagree on, and then proposes no socket count", () => {
		const rows = [
			irveRow({ id_pdc_itinerance: "FRS63E1", nbre_pdc: "2" }),
			irveRow({ id_pdc_itinerance: "FRS63E2", nbre_pdc: "4" }),
		];
		const x = irve.extract(rows, "u");
		expect(x?.tags.some((t) => t.k === "capacity" || t.k.startsWith("socket:"))).toBe(false);
		expect(x?.notes?.[0]).toMatch(/declares 2 and 4 charge points and lists 2/);
	});

	it("keeps only a DC output when the declared count and the listed points disagree", () => {
		const x = irve.extract(
			[
				irveRow({ id_pdc_itinerance: "FRS63E1", nbre_pdc: "4", puissance_nominale: "22" }),
				irveRow({
					id_pdc_itinerance: "FRS63E2",
					nbre_pdc: "4",
					prise_type_2: "false",
					prise_type_combo_ccs: "true",
					puissance_nominale: "50",
				}),
			],
			"u",
		);
		expect(x?.tags.filter((t) => t.k.startsWith("socket:")).map((t) => [t.k, t.v])).toEqual([
			["socket:type2_combo:output", "50 kW"],
		]);
		expect(x?.absent).toEqual([]);
		expect(x?.notes?.[0]).toMatch(/so capacity and sockets are left out/);
	});

	it("counts no bay for a DC cabinet's type 2 outlet declared at the cabinet's power", () => {
		const cabinet = (n: number, ccs: boolean) =>
			irveRow({
				id_pdc_itinerance: `FRIZFEFAST522${n}`,
				nbre_pdc: "3",
				puissance_nominale: "180",
				prise_type_2: String(!ccs),
				prise_type_combo_ccs: String(ccs),
			});
		const tag = capacity([cabinet(1, false), cabinet(2, true), cabinet(3, true)]);
		expect(tag?.v).toBe("2");
		expect(tag?.parts[1].text).toMatch(/3 distinct, 1 of them type 2 alone/);
	});

	it("says when the registry gives a position to two decimals", () => {
		const at = (lat: string, lon: string) =>
			irve.extract(
				[irveRow({ consolidated_latitude: lat, consolidated_longitude: lon, nbre_pdc: "1" })],
				"u",
			)?.notes ?? [];
		expect(at("45.79", "4.84")[0]).toMatch(/to 2 decimals only \(45\.79, 4\.84\)/);
		expect(at("45.791", "4.84")).toHaveLength(1);
		expect(at("45.791", "4.842")).toEqual([]);
	});

	it("proposes no opening_hours when the notes give hours of their own", () => {
		const hours = (observations: string) =>
			irve
				.extract([irveRow({ observations, nbre_pdc: "1" })], "u")
				?.tags.find((t) => t.k === "opening_hours")?.v;
		expect(hours("Situé en centre ville/ accessible de 9h à 18h uniquement")).toBeUndefined();
		expect(hours("Recharge rapide 24/7 - 1h maximum de stationnement autorisé")).toBe("24/7");
	});

	it("writes the address's postcode and commune once", () => {
		const addr = (adresse_station: string, cp: string, commune: string) =>
			irve.extract(
				[
					irveRow({
						adresse_station,
						consolidated_code_postal: cp,
						consolidated_commune: commune,
						nbre_pdc: "1",
					}),
				],
				"u",
			)?.addr;
		expect(addr("131 Rue Nicolas Louis Vauquelin, 31000 Toulouse", "31100", "Toulouse")).toBe(
			"131 Rue Nicolas Louis Vauquelin, 31100 Toulouse",
		);
		expect(addr("8 Rue Bayard, 31200, Toulouse, France, Toulouse", "31200", "Toulouse")).toBe(
			"8 Rue Bayard, 31200 Toulouse",
		);
		expect(addr("Rue Saint Jean31130 BALMA GRAMONT", "31130", "Balma")).toBe(
			"Rue Saint Jean, 31130 Balma",
		);
		expect(addr("37 rue de bonnel - lyon", "69003", "Lyon")).toBe("37 rue de bonnel, 69003 Lyon");
		expect(addr("2 rue de Lyon", "69003", "Lyon")).toBe("2 rue de Lyon, 69003 Lyon");
		expect(addr("145 Rue Anatole France", "69100", "Villeurbanne")).toBe(
			"145 Rue Anatole France, 69100 Villeurbanne",
		);
		expect(addr("23535 Av. du Chater 69340 Francheville", "69340", "Francheville")).toBe(
			"23535 Av. du Chater, 69340 Francheville",
		);
		expect(addr("31700 Blagnac", "", "Blagnac")).toBe("31700 Blagnac");
		expect(addr("100 Allée de Barcelone, 31000 TOULOUSE, Toulouse", "", "Toulouse")).toBe(
			"100 Allée de Barcelone, 31000 Toulouse",
		);
		expect(addr("15 Av. Yves Brunaud, 31770 Colomiers, Toulouse", "", "Toulouse")).toBe(
			"15 Av. Yves Brunaud, 31770 Colomiers",
		);
	});

	it("reads a station's accessibility and booking from all its points", () => {
		const tags = (...over: Row[]) =>
			Object.fromEntries(
				(
					irve.extract(
						over.map((o, i) => irveRow({ id_pdc_itinerance: `FR*S63*E0001*${i}`, ...o })),
						"u",
					)?.tags ?? []
				).map((t) => [t.k, t.v]),
			);
		const mixed = tags(
			{ accessibilite_pmr: "Réservé PMR", reservation: "true" },
			{ accessibilite_pmr: "Accessible mais non réservé PMR", reservation: "false" },
		);
		expect(mixed.wheelchair).toBe("yes");
		expect(mixed.reservation).toBeUndefined();
	});

	it("leaves out a vehicle, an ad-hoc access or a phone the station itself contradicts", () => {
		const tags = (over: Row) =>
			Object.fromEntries((irve.extract([irveRow(over)], "u")?.tags ?? []).map((t) => [t.k, t.v]));
		const scooters = tags({ nom_station: "Station Deux-Roues Lazare Carnot" });
		expect(scooters.motorcar).toBeUndefined();
		const app = tags({ observations: "Paiement via app Lidl Plus" });
		expect(app["authentication:none"]).toBeUndefined();
		expect(tags({ telephone_operateur: "06 22 53 03 38" })["operator:phone"]).toBeUndefined();
		expect(tags({ date_mise_en_service: "2021-3-29", nbre_pdc: "1" }).start_date).toBe(
			"2021-03-29",
		);
	});

	it("fills in what the registry knows beyond the sockets, and nothing it does not", () => {
		const tags = (over: Row) =>
			Object.fromEntries((irve.extract([irveRow(over)], "u")?.tags ?? []).map((t) => [t.k, t.v]));
		expect(
			tags({
				paiement_cb: "true",
				reservation: "False",
				date_mise_en_service: "2021-08-05",
				nom_amenageur: "Toulouse Métropole",
				telephone_operateur: "tel:+33-9-70-25-24-00",
				accessibilite_pmr: "Accessible mais non réservé PMR",
				restriction_gabarit: "1,9",
			}),
		).toMatchObject({
			motorcar: "yes",
			"authentication:none": "yes",
			"payment:credit_cards": "yes",
			reservation: "no",
			start_date: "2021-08-05",
			owner: "Toulouse Métropole",
			"operator:phone": "+33 9 70 25 24 00",
			wheelchair: "yes",
			maxheight: "1.9",
		});
		const unknown = tags({
			date_mise_en_service: "2025-01-01",
			telephone_operateur: "+33-1-23-45-67-89",
			accessibilite_pmr: "Accessibilité inconnue",
			station_deux_roues: "true",
		});
		expect(unknown).toMatchObject({ motorcycle: "yes" });
		for (const k of ["start_date", "operator:phone", "wheelchair", "motorcar"])
			expect(unknown[k]).toBeUndefined();
	});

	it("names the sockets it rules out, and a connector it cannot name", () => {
		const x = irve.extract([irveRow({ nbre_pdc: "1" })], "u");
		expect(x?.absent).toEqual(expect.arrayContaining(["socket:chademo", "socket:type3"]));
		expect(x?.notes).toEqual([]);
		expect(
			irve.extract([irveRow({ prise_type_autre: "true", nbre_pdc: "1" })], "u")?.notes,
		).toHaveLength(1);
	});

	it("reads two same-day declarations of a point by their last change, and absence across both", () => {
		const point = { id_pdc_itinerance: "FR*S63*E0001*1", date_maj: "2026-10-03" };
		const old = irveRow({
			...point,
			nom_enseigne: "Stale",
			prise_type_chademo: "true",
			last_modified: "2026-10-02T06:00:00",
		});
		const fresh = irveRow({ ...point, last_modified: "2026-10-03T06:00:00" });
		for (const rows of [
			[old, fresh],
			[fresh, old],
		]) {
			const x = irve.extract(rows, "u");
			expect(x?.tags.find((t) => t.k === "network")?.v).toBe("ReseauCharge");
			expect(x?.absent).not.toContain("socket:chademo");
		}
	});

	it("says a socket is not there when every type 2 point has its cable attached", () => {
		const x = irve.extract([irveRow({ cable_t2_attache: "true", nbre_pdc: "1" })], "u");
		expect(x?.absent).toContain("socket:type2");
		expect(x?.absent).not.toContain("socket:type2_cable");
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
			irveRow({
				id_pdc_itinerance: `FR*S63*E0001*${n}`,
				prise_type_2: "false",
				nbre_pdc: "",
				...over,
			});

		it("pins a DC unit's power on its CCS, never on its type 2 or the CHAdeMO beside it", () => {
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
			});
		});

		it("counts an attached type 2 cable apart and rounds a registry's 22.08 kW", () => {
			const rows = [
				point(1, { prise_type_2: "true", cable_t2_attache: "true", puissance_nominale: "22.08" }),
				point(2, { prise_type_2: "true", puissance_nominale: "7.4" }),
			];
			expect(outputs(rows)).toEqual({
				"socket:type2": ["1", 0.9],
				"socket:type2:output": ["7.4 kW", 0.8],
				"socket:type2_cable": ["1", 0.9],
				"socket:type2_cable:output": ["22 kW", 0.8],
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

		it("gives no output a connector cannot deliver", () => {
			expect(outputs([point(1, { prise_type_2: "true", puissance_nominale: "150" })])).toEqual({
				"socket:type2": ["1", 0.9],
			});
			expect(outputs([point(1, { prise_type_ef: "true", puissance_nominale: "7" })])).toEqual({
				"socket:typee": ["1", 0.9],
			});
			expect(
				outputs([
					point(1, { prise_type_ef: "true", prise_type_autre: "true", puissance_nominale: "3.4" }),
				])["socket:typee:output"],
			).toBeUndefined();
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
			"school:FR": "primaire",
			name: "École Jean Jaurès",
			"ref:UAI": "0690001A",
			"ref:FR:SIRET": "21690001000019",
			phone: "+33 4 72 00 00 01",
			website: "https://ecole-jaures.fr",
			"operator:type": "public",
		});
		expect(x?.closedBy).toBeUndefined();
	});

	it("maps every level to amenity=school with its school:FR, post-bac to college", () => {
		const kind = (r: Row) => {
			const tags = edu.extract([r], "u")?.tags ?? [];
			return [tags.find((t) => t.k === "amenity")?.v, tags.find((t) => t.k === "school:FR")?.v];
		};
		expect(kind(row({ ecole_elementaire: "0" }))).toEqual(["school", "maternelle"]);
		expect(kind(row({ ecole_maternelle: "0" }))).toEqual(["school", "élémentaire"]);
		expect(kind(row({ type_etablissement: "Collège" }))).toEqual(["school", "collège"]);
		expect(kind(row({ type_etablissement: "Lycée" }))).toEqual(["school", "lycée"]);
		expect(kind(row({ type_etablissement: "", code_nature: "400" }))).toEqual([
			"college",
			undefined,
		]);
	});

	it("maps a medico-social institute as a social facility, leaving a mapped one's main tag", () => {
		const tags = edu.extract(
			[row({ type_etablissement: "Médico-social", code_nature: "240" })],
			"u",
		)?.tags;
		expect(tags?.find((t) => t.k === "amenity")).toMatchObject({
			v: "social_facility",
			addOnly: true,
		});
		expect(tags?.find((t) => t.k === "social_facility:for")?.v).toBe("disabled");
		expect(tags?.find((t) => t.k === "school:FR")).toBeUndefined();
	});

	it("reads a UAI over several sites from its main site, and says so", () => {
		const annex = row({
			nom_etablissement: "Collège Michelet - annexe",
			adresse_1: "17 rue Larrey",
		});
		const main = row({ nom_etablissement: "Collège Michelet", adresse_1: "6 boulevard Michelet" });
		const x = edu.extract([annex, main], "u");
		expect(x?.name).toBe("Collège Michelet");
		expect(x?.notes?.[0]).toMatch(/at 2 sites.*6 boulevard Michelet/);
	});

	it("takes the site whose address is at the directory's point as the main one", () => {
		const there = row({
			nom_etablissement: "Lycée de coiffure de Lyon",
			adresse_1: "30 rue Couturier",
		});
		const away = row({ nom_etablissement: "École de coiffure", adresse_1: "2 quai Jean Moulin" });
		const gaps = new Map([
			[there, 15],
			[away, 1300],
		]);
		expect(edu.extract([there, away], "u", gaps)?.name).toBe("Lycée de coiffure de Lyon");
	});

	it("lets OSM keep the phone another site of the same UAI gives", () => {
		const annex = row({ adresse_1: "17 rue Larrey", telephone: "05 61 21 99 71" });
		const main = row({ nom_etablissement: "Ecole", telephone: "05 61 62 46 59" });
		const phone = edu.extract([annex, main], "u")?.tags.find((t) => t.k === "phone");
		expect(phone).toMatchObject({ v: "+33 5 61 62 46 59", also: ["+33 5 61 21 99 71"] });
	});

	it("quotes the level flags a school's level comes from, and skips a webmail address", () => {
		const tags = edu.extract([row({ mail: "someone@gmail.com" })], "u")?.tags ?? [];
		expect(
			tags
				.find((t) => t.k === "school:FR")
				?.parts.map((p) => p.text)
				.join(""),
		).toBe("ecole_maternelle: 1, ecole_elementaire: 1");
		expect(tags.find((t) => t.k === "email")).toBeUndefined();
	});

	it("says when the directory places a school only roughly", () => {
		expect(edu.extract([row({ precision_localisation: "Rue" })], "u")?.notes).toEqual([
			"The directory places it only to the precision of: Rue",
		]);
		expect(edu.extract([row({ precision_localisation: "Parfaite" })], "u")?.notes).toEqual([]);
	});

	it("proposes nothing for a section housed in its parent establishment", () => {
		const section = { type_rattachement_etablissement_mere: "FILIERE OU DEPARTEMENT OU SECTION" };
		expect(edu.extract([row(section)], "u")).toBeNull();
		expect(
			edu.extract([row({ type_rattachement_etablissement_mere: "ANNEXE GEOGRAPHIQUE" })], "u"),
		).not.toBeNull();
		const segpa = {
			type_rattachement_etablissement_mere: "ANNEXE GEOGRAPHIQUE",
			code_nature: "390",
		};
		expect(edu.extract([row(segpa)], "u")).toBeNull();
	});

	it("proposes nothing for an office that is not a school", () => {
		expect(edu.extract([row({ type_etablissement: "Service Administratif" })], "u")).toBeNull();
		expect(edu.extract([row({ type_etablissement: "" })], "u")).toBeNull();
		expect(edu.extract([row({ code_nature: "809" })], "u")).toBeNull();
	});

	it("proposes the directory's email and opening date", () => {
		const tags = Object.fromEntries(
			(
				edu.extract(
					[
						row({
							mail: "ce.0690001A@ac-lyon.fr",
							date_ouverture: "2023-09-01",
							ecole_elementaire: "0",
						}),
					],
					"u",
				)?.tags ?? []
			).map((t) => [t.k, t.v]),
		);
		expect(tags).toMatchObject({ email: "ce.0690001A@ac-lyon.fr", start_date: "2023-09-01" });
	});

	it("leaves out a person's own mailbox and a mobile, and counts them", () => {
		const x = edu.extract(
			[row({ mail: "audrey.lagane@lespetitesfamilles.fr", telephone: "06 70 75 01 33" })],
			"u",
		);
		const keys = x?.tags.map((t) => t.k);
		expect(keys).not.toContain("email");
		expect(keys).not.toContain("phone");
		expect(x?.withheld).toBe(2);
		expect(edu.extract([row({ mail: "contact@ecole-jaures.fr" })], "u")?.withheld).toBe(0);
	});

	it("proposes no operator:type where the SIREN and the directory's status disagree", () => {
		const type = (over: Row) =>
			edu.extract([row(over)], "u")?.tags.find((t) => t.k === "operator:type")?.v;
		expect(type({ statut_public_prive: "Privé", siren_siret: "26690008300012" })).toBeUndefined();
		expect(type({ statut_public_prive: "Public", siren_siret: "77564661500564" })).toBeUndefined();
		expect(type({ statut_public_prive: "Privé", siren_siret: "77564661500564" })).toBe("private");
		expect(type({ statut_public_prive: "Privé", siren_siret: "" })).toBe("private");
	});

	it("asks the address base for its address, a kilometre off before its point moves", () => {
		expect(edu.extract([row()], "u")?.geocode).toEqual({
			q: "2 rue Jaurès 69003 Lyon",
			farM: 1000,
		});
		expect(edu.extract([row({ adresse_1: "Lieu-dit Les Prés" })], "u")?.geocode).toBeUndefined();
	});

	it("fills a missing name but never renames", () => {
		const name = edu.extract([row()], "u")?.tags.find((t) => t.k === "name");
		expect(name?.addOnly).toBe(true);
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

describe("openingHours", () => {
	it("reads every way a registry spells all day", () => {
		expect(openingHours("Mo-Su 00:00-23:57")).toBe("24/7");
		const day = (d: string) => `${d} 00:00-23:59`;
		expect(openingHours(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day).join(", "))).toBe(
			"24/7",
		);
		expect(openingHours(["Mo", "Tu", "We", "Th", "Fr"].map(day).join(", "))).toBe(
			"Mo-Fr 00:00-24:00",
		);
		expect(openingHours("Mo-Fr 08:00-18:00")).toBe("Mo-Fr 08:00-18:00");
	});

	it("folds days spelled out one by one into ranges", () => {
		const week = (span: string, days = ["Mo", "Tu", "We", "Th", "Fr", "Sa"]) =>
			days.map((d) => `${d} ${span}`).join(", ");
		expect(openingHours(week("09:30-19:45"))).toBe("Mo-Sa 09:30-19:45");
		expect(
			openingHours(
				`${week("07:30-12:30", ["Mo", "Tu"])}, ${week("13:30-19:00", ["Mo", "Tu"])}, Sa 09:00-12:00`,
			),
		).toBe("Mo-Tu 07:30-12:30,13:30-19:00; Sa 09:00-12:00");
	});

	it("repairs what OSM's parser can read and refuses the rest", () => {
		expect(openingHours("Mo-Fri: 07:30-19:00")).toBe("Mo-Fr 07:30-19:00");
		expect(openingHours("Mo-Fr 09:00-19:00,Sat 09:00-18:00")).toBe(
			"Mo-Fr 09:00-19:00, Sa 09:00-18:00",
		);
		expect(openingHours("Monday to Friday")).toBeNull();
	});
});

describe("schoolAddress", () => {
	const at = (over: Row) =>
		schoolAddress({
			adresse_1: "68 boulevard de Strasbourg",
			code_postal: "31000",
			nom_commune: "Toulouse",
			...over,
		});
	it("splits the number from the street and keeps the commune, not its arrondissement", () => {
		expect(at({ nom_commune: "Lyon 6e  Arrondissement", code_postal: "69006" })).toEqual({
			number: "68",
			street: "Boulevard de Strasbourg",
			postcode: "69006",
			city: "Lyon",
			query: "68 boulevard de Strasbourg 69006 Lyon",
		});
	});
	it("drops a CEDEX postcode and refuses no street at all", () => {
		expect(at({ adresse_3: "31076 TOULOUSE CEDEX 3" })?.postcode).toBe("");
		expect(at({ adresse_1: "BP 41023" })).toBeNull();
	});
	it("asks for a street in capitals or abbreviated as written out", () => {
		expect(at({ adresse_1: "31 rue DES TUILLIERS" })?.query).toBe(
			"31 rue DES TUILLIERS 31000 Toulouse",
		);
		expect(at({ adresse_1: "95  bd PINEL" })?.query).toBe("95 boulevard PINEL 31000 Toulouse");
		expect(at({ adresse_1: "373 r L'Occitane" })?.street).toBe("Rue L'Occitane");
	});
	it("writes a housenumber without its leading zero, its suffix in lower case, and reads a port as a street", () => {
		expect(at({ adresse_1: "07 chemin des Prés" })?.number).toBe("7");
		expect(at({ adresse_1: "158 BIS RUE DU 4 AOUT 1789" })?.number).toBe("158bis");
		expect(at({ adresse_1: "8 port SAINT-SAUVEUR" })?.street).toBe("Port SAINT-SAUVEUR");
	});
	it("keeps a housenumber range whole and asks for its first number", () => {
		const range = at({ adresse_1: "20-28 rue Louis Auguste Blanqui", code_postal: "69921" });
		expect(range).toMatchObject({
			number: "20-28",
			query: "20 rue Louis Auguste Blanqui Toulouse",
		});
	});
	it("keeps a note out of the street and a mail route out of the postcode", () => {
		expect(at({ adresse_1: "12 rue de la Solidarité (site Ariane)" })?.street).toBe(
			"Rue de la Solidarité",
		);
		expect(at({ code_postal: "69321" })?.postcode).toBe("");
		expect(at({ code_postal: "69005" })?.postcode).toBe("69005");
	});
});

describe("openedForSure", () => {
	it("trusts a register date only after the bulk entries, and never a merged primaire's", () => {
		expect(openedForSure("1965-05-01", "lycée")).toBe(false);
		expect(openedForSure("1977-03-08", "élémentaire")).toBe(false);
		expect(openedForSure("2023-09-01", "maternelle")).toBe(true);
		expect(openedForSure("2017-09-01", "primaire")).toBe(false);
		expect(openedForSure("", null)).toBe(false);
	});
});

describe("siteName", () => {
	it("tells a site's own name from a network named inside it", () => {
		expect(siteName("LPA Perrache", "Parking Perrache")).toBe(true);
		expect(siteName("Allego - Leclerc Blagnac", "Leclerc Blagnac")).toBe(true);
		expect(siteName("VIL13 - Grandclément", "VIL13 Grandclément")).toBe(true);
		expect(siteName("313", "McDo Montaudran")).toBe(true);
		expect(siteName("Parking Morand", "PARKING MORAND")).toBe(true);
		expect(siteName("Reveo", "Reveo Route d'Espagne")).toBe(false);
		expect(siteName("TOULIBEO", "TOULOUSE - Marengo")).toBe(false);
		expect(siteName("DRIVECO", "Airbus ADS - Toulouse - GEO - powered by DRIVECO")).toBe(false);
		expect(siteName("CENTRAKOR", "CENTRAKOR - PARKING EXTERIEUR", "CENTRAKOR")).toBe(true);
		expect(siteName("LPA Fosse aux Ours", "Parking FAO", "LPA")).toBe(true);
		expect(siteName("Reveo", "Reveo Route d'Espagne", "Toulouse Métropole")).toBe(false);
	});

	it("tells a site's words run together, and the owner's short name, from a brand", () => {
		expect(siteName("HCrequipublic", "INOUID-HOTEL-CREQUI", "hotel-crequi-lyon")).toBe(true);
		expect(siteName("ALDI", "SAINT-FONS", "ALDI MARCHE SARL (LYO)")).toBe(true);
		expect(siteName("TotalEnergies", "Total Energies Relais Lyon")).toBe(false);
		expect(siteName("GreenToWheel", "Tisséo Borderouge", "Green To Wheel SAS")).toBe(false);
	});
});

describe("schoolName", () => {
	it("puts the accent back on École and quiets shouted words, not acronyms", () => {
		expect(schoolName("Ecole élémentaire  Jules-Géraud SALIEGE")).toBe(
			"École élémentaire Jules-Géraud Saliege",
		);
		expect(schoolName("Collège Rosa PARKS - SEGPA")).toBe("Collège Rosa Parks - SEGPA");
	});

	it("drops the contract status and writes a shouted name as a name", () => {
		expect(schoolName("Ecole primaire privée hors contrat  Les sarments")).toBe(
			"École primaire privée Les sarments",
		);
		expect(schoolName("ASSOCIATION DE GESTION DES ECOLES DU CAMPUS VIDAL")).toBe(
			"Association de Gestion des Écoles du Campus Vidal",
		);
		expect(schoolName("IME Les Troënes")).toBe("IME Les Troënes");
		expect(schoolName("DITEP La Maison des enfants")).toBe("DITEP La Maison des enfants");
		expect(schoolName("Ecole Technique privée ESTM Lebreton")).toBe(
			"École Technique privée ESTM Lebreton",
		);
		expect(schoolName("Lycée Pierre de FERMAT")).toBe("Lycée Pierre de Fermat");
		expect(schoolName("Ecole privée hors-contrat Rose Carmin")).toBe("École privée Rose Carmin");
	});

	it("puts accents back on the words the directory drops them from", () => {
		expect(schoolName("Institut Médico-Educatif Le Bouquet")).toBe(
			"Institut Médico-Éducatif Le Bouquet",
		);
		expect(schoolName("Centre de Référence pour l'Evaluation")).toBe(
			"Centre de Référence pour l'Évaluation",
		);
		expect(schoolName("DITEP Elise Rivet")).toBe("DITEP Élise Rivet");
		expect(schoolName("Ecole technique prive Lumière")).toBe("École technique privé Lumière");
		expect(schoolName("SESSAD A VISEE PROFESSIONNELLE")).toBe("SESSAD à Visée Professionnelle");
		expect(schoolName("Lycée A Rimbaud")).toBe("Lycée A Rimbaud");
	});

	it("quiets a run of shouted words but keeps initialisms and a lone word in capitals", () => {
		expect(schoolName("Ecole technique prive hors contrat CAMAS ACADEMY")).toBe(
			"École technique privé Camas Academy",
		);
		expect(schoolName("Lycée professionnel ORT LYON")).toBe("Lycée professionnel ORT LYON");
		expect(schoolName("Ecole Technique Privée ISSEC PIGIER")).toBe(
			"École Technique Privée ISSEC Pigier",
		);
		expect(schoolName("Ecole secondaire privée IPESS")).toBe("École secondaire privée IPESS");
		expect(schoolName("Ecole technique privée hors contrat ADONIS")).toBe(
			"École technique privée ADONIS",
		);
	});

	it("keeps the initialisms of a name written all in capitals", () => {
		expect(schoolName("ICS LYON")).toBe("ICS Lyon");
		expect(schoolName("ADONIS IESCA")).toBe("Adonis IESCA");
		expect(schoolName("ASEI CENTRE PHILIAE")).toBe("ASEI Centre Philiae");
		expect(schoolName("EPNAK TOULOUSE")).toBe("EPNAK Toulouse");
		expect(schoolName("Foyer de la Fondation OVE - Appartements")).toBe(
			"Foyer de la Fondation OVE - Appartements",
		);
	});
});

describe("expandStreet", () => {
	it("writes out a street type where it stands and a title anywhere", () => {
		expect(expandStreet("49 Bd Lucien Sampaix, 69190 Saint-Fons")).toBe(
			"49 Boulevard Lucien Sampaix, 69190 Saint-Fons",
		);
		expect(expandStreet("112 Av. Gén. Leclerc")).toBe("112 Avenue Général Leclerc");
		expect(expandStreet("11 ter Imp. Ste Anne")).toBe("11 ter Impasse Sainte Anne");
		expect(expandStreet("Pl. St-Jean")).toBe("Place Saint-Jean");
		expect(expandStreet("2 rue Générale")).toBe("2 rue Générale");
	});
});

describe("addressQuery", () => {
	it("adds the postcode and commune only when the line lacks them", () => {
		expect(addressQuery("49 Bd Lucien Sampaix, 69190 Saint-Fons", "69190", "Saint-Fons")).toBe(
			"49 Boulevard Lucien Sampaix, 69190 Saint-Fons",
		);
		expect(addressQuery("1 place de la Mairie", "69001", "Lyon")).toBe(
			"1 place de la Mairie 69001 Lyon",
		);
	});

	it("is what a station asks with, 100 m off before its point moves", () => {
		expect(presetById("irve")?.extract([irveRow()], "u")?.geocode).toEqual({
			q: "1 place de la Mairie, 69001 Lyon",
			farM: 100,
		});
	});
});

describe("personalMailbox", () => {
	it("tells somebody's own address from the establishment's", () => {
		const own = (mail: string, name = "École Declic", city = "Lyon") =>
			personalMailbox(mail, name, city);
		expect(own("jean-armand.barone@college-declic.fr")).toBe(true);
		expect(own("l.gruer@espaceforma.com")).toBe(true);
		expect(own("audrey.lagane@lespetitesfamilles.fr")).toBe(true);
		expect(own("contact@college-declic.fr")).toBe(false);
		expect(own("secretariat.college@x.fr")).toBe(false);
		expect(own("vie-scolaire@x.fr")).toBe(false);
		expect(own("seguin.direction@ccass-sbe.org")).toBe(false);
		expect(own("ce.0690001A@ac-lyon.fr")).toBe(false);
		expect(own("immaculee.conception@immaculee.net")).toBe(false);
		expect(own("campus.lyon@x.fr")).toBe(false);
		expect(own("lycee.neyret@x.fr", "Lycée Neyret")).toBe(false);
	});

	it("reads a mailbox of one word as a person's unless the word is the school's", () => {
		const own = (mail: string, name = "Lycée professionnel de coiffure", place = "Lyon") =>
			personalMailbox(mail, name, place);
		expect(own("maubert@lyceedecoiffure.com")).toBe(true);
		expect(own("ehatzakortzian@prado.asso.fr")).toBe(true);
		expect(own("yolene@lespetitsplus.org")).toBe(true);
		expect(own("accueil@x.fr")).toBe(false);
		expect(own("lyceepro@slsb.fr")).toBe(false);
		expect(own("secretariatmontchat@pierre-termier.fr")).toBe(false);
		expect(own("carrel@carrel.fr")).toBe(false);
		expect(own("contact31-toulouse@epnak.org")).toBe(false);
		expect(own("maisondesenfants@adsea69.fr", "DITEP La Maison des enfants")).toBe(false);
		expect(own("neyret@lasalle-69.com", "Lycée La Salle", "Lyon 22 rue Neyret")).toBe(false);
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

describe("poolId", () => {
	it("writes a station's pool id with the standard's separators", () => {
		expect(poolId("FRTLSP31555019")).toBe("FR*TLS*P31555019");
		expect(poolId("fr*gly*plyon13222")).toBe("FR*GLY*PLYON13222");
	});
	it("proposes nothing for a point id or an operator's own id", () => {
		expect(poolId("FRDRVEACJU1")).toBeNull();
		expect(poolId("DKMONE4198725")).toBeNull();
		expect(poolId("S1")).toBeNull();
	});
});
