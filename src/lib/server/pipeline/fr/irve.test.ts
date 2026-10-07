import { describe, expect, it } from "vitest";
import { stationFit } from "../any/charging-station";
import { mergeSites, shippedExtractor } from "../extractor";
import { renamingFor, shippedCovering } from "../mapping/files";
import { updateOps } from "../match/ops";
import type { Row } from "../types";
import { poolId, siteName } from "./charging-functions";

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
	const irve = shippedExtractor(renamingFor("fr/irve"));
	const capacityOf = (rows: Row[]) =>
		irve.extract(rows, "u")?.tags.find((t) => t.k === "capacity")?.v;

	it("is detected from its columns", () => {
		expect(shippedCovering(Object.keys(irveRow()))?.source).toBe("fr/irve");
		expect(shippedCovering(["a", "b"])).toBeNull();
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

	it("makes one record of a site another operator's file declares under its own prefix", () => {
		const rec = (key: string, point: string, lat: string, over: Row = {}) => ({
			key,
			rows: [
				irveRow({
					id_station_itinerance: key,
					id_pdc_itinerance: point,
					consolidated_latitude: lat,
					...over,
				}),
			],
		});
		const keys = (...recs: ReturnType<typeof rec>[]) => mergeSites(recs, irve).map((r) => r.key);
		const allego = { nom_operateur: "Allego" };
		expect(
			keys(
				rec("FREVCP000300", "FREVCE9009501", "45.78900", { nom_operateur: "EV Cars" }),
				rec("FRALLPEVCARSECLLY", "FRALLEGO9009501", "45.78910", allego),
			),
		).toEqual(["FRALLPEVCARSECLLY"]);
		expect(
			keys(
				rec("FREVCP000300", "FREVCE9009501", "45.78900", { nom_operateur: "EV Cars" }),
				rec("FRALLPEVCARSECLLY", "FRALLEGO9009501", "45.79000", allego),
			),
		).toHaveLength(2);
		expect(
			keys(
				rec("FREVCP000406", "FREVCE7001161", "43.64750", allego),
				rec("FRALLPEVCARSKLPBL", "FRALLEGO7001161", "43.64655", allego),
			),
		).toEqual(["FRALLPEVCARSKLPBL"]);
		const zeenco = (name: string, key: string, point: string) =>
			rec(key, point, "43.543351", { nom_operateur: name });
		expect(
			keys(
				zeenco("ZEENCO", "FRLMSE1000101739", "FRLMSE1000101739"),
				zeenco("ZEENCO e-mobility", "FRZEEP89304836", "FRZEEE10001017391"),
			),
		).toHaveLength(1);
	});

	it("makes one record of a car park whose points are declared as stations a few metres apart", () => {
		const station = (key: string, lon: string, points: string[]) => ({
			key,
			rows: points.map((p) =>
				irveRow({
					id_station_itinerance: key,
					id_pdc_itinerance: p,
					nom_station: "TOULOUSE - B612 - 3 Rue Tarfaya",
					consolidated_longitude: lon,
					nbre_pdc: String(points.length),
				}),
			),
		});
		const merged = mergeSites(
			[
				station("FRBE3P31555003", "1.488652", ["FRBE3E315550031", "FRBE3E315550032"]),
				station("FRBE3P315550035", "1.488752", ["FRBE3E3155500351"]),
				station("FRBE3P315550036", "1.488852", ["FRBE3E3155500361"]),
			],
			irve,
		);
		expect(merged.map((r) => r.key)).toEqual(["FRBE3P31555003"]);
		expect(capacityOf(merged[0].rows)).toBe("4");
		const twoStations = mergeSites(
			[
				station("FRM31P31555029", "1.3720", ["FRM31E315550291", "FRM31E315550292"]),
				station("FRM31P31555030A2", "1.3719", ["FRM31E315550303", "FRM31E315550304"]),
			],
			irve,
		);
		expect(twoStations).toHaveLength(2);
	});

	it("keys a row that names no station by its place and operator", () => {
		const none = (lat: string, nom_operateur: string) =>
			irveRow({
				id_station_itinerance: "Non concerné",
				id_pdc_itinerance: "Non concerné",
				consolidated_latitude: lat,
				nom_operateur,
				nbre_pdc: "1",
			});
		const here = irve.key(none("45.79", "Pascal Chene"));
		expect(here).not.toBe(irve.key(none("45.80", "Pascal Chene")));
		expect(here).not.toBe(irve.key(none("45.79", "INOUID")));
		expect(capacityOf([none("45.79", "Pascal Chene")])).toBe("1");
	});

	it("quotes the fields a fee was read from", () => {
		const fee = (over: Row) =>
			irve
				.extract(
					[irveRow({ paiement_acte: "false", paiement_cb: "false", gratuit: "", ...over })],
					"u",
				)
				?.tags.find((t) => t.k === "fee");
		expect(fee({ tarification: "49 cts/kWh" })).toMatchObject({ v: "yes", path: "tarification" });
		const byCard = fee({ paiement_cb: "true" });
		expect(byCard?.parts.map((p) => p.text).join("")).toBe(
			"paiement_acte: false, paiement_cb: true",
		);
		expect(fee({ gratuit: "False" })).toMatchObject({ path: "gratuit" });
	});

	it("proposes access add-only, so it fills a gap and replaces nothing", () => {
		const access = irve.extract([irveRow({ condition_acces: "Accès libre" })], "u")?.tags;
		expect(access?.find((t) => t.k === "access")).toMatchObject({ v: "yes", addOnly: true });
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
		expect(irve.extract([...carPark.slice(0, 3), rows[0]], "u")?.notes).toContainEqual(
			"1 of the site's stations is declared as a single row, so sockets are left out",
		);
	});

	it("counts one point per one-row station when each repeats the site's total", () => {
		const site = (n: number, ids: string[], file = "f", date = "2025-01-28") =>
			ids.map((id, i) =>
				irveRow({
					id_station_itinerance: id,
					id_pdc_itinerance: id,
					nbre_pdc: String(n),
					prise_type_2: String(i > 0),
					prise_type_combo_ccs: String(i === 0),
					puissance_nominale: i === 0 ? "60" : "22",
					datagouv_resource_id: file,
					date_maj: date,
				}),
			);
		const brasserie = site(3, ["DKMONE41", "DKMONE42", "DKMONE43"]);
		const tags = Object.fromEntries(
			(irve.extract(brasserie, "u")?.tags ?? []).map((t) => [t.k, t.v]),
		);
		expect(tags).toMatchObject({ capacity: "3", "socket:type2": "2", "socket:type2_combo": "1" });
		expect(capacityOf(site(2, ["FRLIBE01", "FRLIBE02", "FRLIBE03"]))).toBe("6");
		const renumbered = [
			...site(3, ["FRQPKEP1", "FRQPKEP2", "FRQPKEP3"], "old", "2025-11-15"),
			...declared("FRQPKPPRK", "new", "2026-10-03", ["FRQPKEP1", "FRQPKEP2"]),
		];
		expect(capacityOf(renumbered)).toBe("3");
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

	it("drops a station declared again elsewhere, and its renumbered points with it", () => {
		const named = (rows: Row[], nom_station: string) => rows.map((r) => ({ ...r, nom_station }));
		const alfen = named(
			declared("FRSWSP90234529", "agg", "2026-04-27", ["E1", "E2", "E7", "E8"]),
			"MG VENISSIEUX",
		);
		const evbox = named(
			declared("FRSWSE1234651154", "own", "2026-09-29", ["E7", "E8", "E9"]),
			"EVBOX 120 MG VENISSIEUX",
		);
		const again = named(
			declared("FRSWSP1321486", "agg", "2026-10-03", ["E9", "E10", "E11"]),
			"MG VENISSIEUX",
		);
		expect(capacity([...alfen, ...evbox, ...again])?.v).toBe("5");
		const caliceo = (station: string, file: string, date: string, point: string) =>
			declared(station, file, date, [point]).map((r) => ({
				...r,
				nom_station: "Caliceo Ste Foy",
				nbre_pdc: "4",
			}));
		const x = irve.extract(
			[
				...caliceo("FRISEPINOUIDCALICEO", "a", "2023-10-10", "FRISEEINOUIDCALICEO1"),
				...caliceo("FRISEEINOUIDCALICEOSTEFOY", "b", "2023-12-08", "FRISEEINOUIDCALICEOSTEFOY1"),
			],
			"u",
		);
		expect(x?.notes?.[0]).toMatch(/declares 4 charge points and lists 1/);
		const oneRow = [
			irveRow({
				id_station_itinerance: "FRLMSE1000101739",
				id_pdc_itinerance: "FRLMSE1000101739",
				nbre_pdc: "3",
				datagouv_resource_id: "old",
				date_maj: "2024-01-26",
			}),
			...declared("FRZEEP89304836", "new", "2026-10-02", ["FRZEEE1", "FRZEEE2", "FRZEEE3"]),
		];
		expect(capacity(oneRow)?.v).toBe("3");
		const moved = [
			...declared("FRALLPEVCARSTLSPU", "allego", "2026-03-05", [
				"FRALLEGO9002631",
				"FRALLEGO9005411",
			]),
			...declared("FREVCP000133", "evcars", "2026-10-03", ["FREVCE9002631", "FREVCE9990971"]),
		];
		expect(capacity(moved)?.v).toBe("2");
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

	it("proposes no socket output when the declared count and the listed points disagree", () => {
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
		expect(x?.tags.filter((t) => t.k.startsWith("socket:"))).toEqual([]);
		expect(x?.absent).toEqual([]);
		expect(x?.notes?.[0]).toMatch(/so capacity and sockets are left out/);
	});

	it("proposes no socket count while some points name no connector", () => {
		const none = { prise_type_2: "false", nbre_pdc: "3" };
		const x = irve.extract(
			[
				irveRow({ id_pdc_itinerance: "FRS63E1", ...none }),
				irveRow({ id_pdc_itinerance: "FRS63E2", ...none }),
				irveRow({ id_pdc_itinerance: "FRS63E3", ...none, prise_type_combo_ccs: "true" }),
			],
			"u",
		);
		expect(x?.tags.find((t) => t.k === "capacity")?.v).toBe("3");
		expect(x?.tags.filter((t) => t.k.startsWith("socket:"))).toEqual([]);
		expect(x?.absent).toEqual([]);
		expect(x?.notes).toEqual([
			"2 of its 3 charge points name no connector, so sockets are left out",
		]);
	});

	it("counts no sockets where a station named for DC charging ticks no DC connector", () => {
		// RNO ETATS UNIS (Mobilize, Toulouse): two "Borne DC" stations of three 62.5 kW points
		// ticking type 2 and E/F only, beside nine AC points of the dealership.
		const station = (id: string, nom_station: string, power: string, n: number) =>
			Array.from({ length: n }, (_, i) =>
				irveRow({
					id_station_itinerance: id,
					id_pdc_itinerance: `${id}${i + 1}`,
					nom_station,
					nom_operateur: "Mobilize Power Solutions",
					nom_amenageur: "Mobilize Power Solutions",
					nbre_pdc: "1",
					puissance_nominale: power,
					prise_type_2: "True",
					cable_t2_attache: "False",
					prise_type_ef: "True",
					consolidated_latitude: "43.63946533203125",
					consolidated_longitude: "1.4293237924575806",
				}),
			);
		const ac = "RNO ETATS UNIS - Edenauto Toulouse Etats Unis";
		const x = irve.extract(
			[
				...station("FRMBZEAZIVT", ac, "22", 2),
				...station("FRMBZEBREPD", ac, "22", 1),
				...station("FRMBZEFQAXT", ac, "7.4", 1),
				...station("FRMBZEKIAIT", "RNO ETATS UNIS - Borne DC", "62.5", 3),
				...station("FRMBZEKKZTF", ac, "7.4", 1),
				...station("FRMBZEQPJLA", "RNO ETATS UNIS - Borne DC", "62.5", 3),
				...station("FRMBZERNFEQ", ac, "7.4", 1),
				...station("FRMBZEWPKRT", ac, "22", 2),
				...station("FRMBZEZPQCJ", ac, "7.4", 1),
			],
			"u",
		);
		expect(x?.tags.find((t) => t.k === "capacity")?.v).toBe("15");
		expect(x?.tags.filter((t) => t.k.startsWith("socket:"))).toEqual([]);
		expect(x?.absent).toEqual([]);
		expect(x?.notes).toContain(
			"6 of its 15 charge points are on a station named for DC charging that ticks no DC connector, so sockets are left out",
		);
	});

	it("reads a point's connectors from an older declaration where the newest says only 'autre'", () => {
		const point = { id_pdc_itinerance: "FRETIE69259A11", nbre_pdc: "1", prise_type_2: "false" };
		const x = irve.extract(
			[
				irveRow({ ...point, date_maj: "2025-06-17", prise_type_combo_ccs: "true" }),
				irveRow({ ...point, date_maj: "2026-09-26", prise_type_autre: "true" }),
			],
			"u",
		);
		const tags = Object.fromEntries((x?.tags ?? []).map((t) => [t.k, t.v]));
		expect(tags["socket:type2_combo"]).toBe("1");
		expect(x?.notes).toEqual([
			"The registry's newest declaration names no connector on 1 of its charge points; their connectors are an older declaration's",
		]);
	});

	it("proposes no commissioning date later than an older declaration of the station", () => {
		const since = (rows: Row[]) =>
			irve.extract(rows, "u")?.tags.find((t) => t.k === "start_date")?.v;
		const point = { nbre_pdc: "1", created_at: "2025-05-05T13:28:02" };
		const newest = irveRow({
			...point,
			date_maj: "2026-09-26",
			date_mise_en_service: "2026-07-28",
		});
		expect(since([irveRow({ ...point, date_maj: "2025-06-17" }), newest])).toBeUndefined();
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
		const acStation = { ...cabinet(1, false), id_station_itinerance: "FRLMSE1234718177" };
		expect(capacity([acStation, cabinet(2, true), cabinet(3, true)])?.v).toBe("3");
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

	it("proposes no opening_hours for stations giving different hours", () => {
		const site = irve.extract(
			[
				irveRow({ id_station_itinerance: "FRAIRP1", id_pdc_itinerance: "FRAIRE1" }),
				irveRow({
					id_station_itinerance: "FRAIRP2",
					id_pdc_itinerance: "FRAIRE2",
					horaires: "Mo-Fr 07:00-20:00",
				}),
			],
			"u",
		);
		expect(site?.tags.find((t) => t.k === "opening_hours")).toBeUndefined();
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
		const elsewhere = irve.extract(
			[
				irveRow({
					adresse_station: "363 Rte de Toulouse, 33140 Villenave-d'Ornon",
					consolidated_code_postal: "31400",
					consolidated_commune: "Toulouse",
					code_insee_commune: "33550",
				}),
			],
			"u",
		);
		expect(elsewhere?.addr).toBe("363 Rte de Toulouse, 33140 Villenave-d'Ornon");
		expect(elsewhere?.geocode?.q).toBe("363 Route de Toulouse, 33140 Villenave-d'Ornon");
	});

	it("drops a postal box and a CEDEX from the address", () => {
		const addr = (adresse_station: string, consolidated_code_postal: string, commune: string) =>
			irve.extract(
				[irveRow({ adresse_station, consolidated_code_postal, consolidated_commune: commune })],
				"u",
			)?.addr;
		// Carrefour Energies - Vénissieux (EV Cars).
		expect(addr("136 Boulevard Joliot Curie_Bp 75", "69200", "Vénissieux")).toBe(
			"136 Boulevard Joliot Curie, 69200 Vénissieux",
		);
		expect(addr("Avenue du Mirail, 31100 TOULOUSE CEDEX 4", "31100", "Toulouse")).toBe(
			"Avenue du Mirail, 31100 Toulouse",
		);
		expect(addr("12 rue X, CS 30012", "31000", "Toulouse")).toBe("12 rue X, 31000 Toulouse");
	});

	it("reads notes, fee, two-wheelers and accessibility over every declaration of the points", () => {
		const both = (older: Row, newer: Row) =>
			Object.fromEntries(
				(
					irve.extract(
						[
							irveRow({ datagouv_resource_id: "own", date_maj: "2025-12-11", ...older }),
							irveRow({ datagouv_resource_id: "agg", date_maj: "2026-05-19", ...newer }),
						],
						"u",
					)?.tags ?? []
				).map((t) => [t.k, t.v]),
			);
		const blank = { observations: "", tarification: "", gratuit: "" };
		expect(
			both({ observations: "Paiement via app Lidl Plus" }, blank)["authentication:none"],
		).toBeUndefined();
		expect(
			both({ observations: "formules de votre EMSP" }, blank)["authentication:none"],
		).toBeUndefined();
		expect(both({ gratuit: "FALSE" }, { ...blank, paiement_acte: "false" }).fee).toBe("yes");
		const engie = both(
			{ station_deux_roues: "FALSE", accessibilite_pmr: "Accessibilité inconnue" },
			{ station_deux_roues: "True", accessibilite_pmr: "Réservé PMR" },
		);
		for (const k of ["motorcycle", "motorcar", "wheelchair"]) expect(engie[k]).toBeUndefined();
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

	it("takes the earliest commissioning date of a site only from stations at its own place", () => {
		const farAway = irveRow({
			id_station_itinerance: "FRFARP1",
			id_pdc_itinerance: "FRFARE1",
			date_mise_en_service: "2019-05-02",
			consolidated_latitude: "45.80",
		});
		const site = irve.extract([irveRow({ date_mise_en_service: "2023-01-08" }), farAway], "u");
		expect(site?.tags.find((t) => t.k === "start_date")?.v).not.toBe("2019-05-02");
	});

	it("names the sockets it rules out, and a connector it cannot name", () => {
		const x = irve.extract([irveRow({ nbre_pdc: "1" })], "u");
		expect(x?.absent).toEqual(expect.arrayContaining(["socket:chademo", "socket:type3"]));
		expect(x?.notes).toEqual([]);
		expect(
			irve.extract([irveRow({ prise_type_autre: "true", nbre_pdc: "1" })], "u")?.notes,
		).toHaveLength(1);
	});

	it("never rules out a Schuko socket where the registry ticks an E/F outlet", () => {
		const absent = (over: Row) => irve.extract([irveRow({ nbre_pdc: "1", ...over })], "u")?.absent;
		expect(absent({})).toContain("socket:schuko");
		expect(absent({ prise_type_ef: "true" })).not.toContain("socket:schuko");
		expect(absent({ prise_type_ef: "true" })).toContain("socket:type3");
	});

	it("proposes no network an older declaration names the site or its host by", () => {
		const point = { id_pdc_itinerance: "FRZEEE10001017391", nom_enseigne: "Howdens" };
		const network = (older: Row) =>
			irve
				.extract(
					[
						irveRow({ ...point, nom_station: "366F-Toulouse", date_maj: "2026-10-02" }),
						irveRow({ ...point, ...older, date_maj: "2024-01-26" }),
					],
					"u",
				)
				?.tags.find((t) => t.k === "network")?.v;
		expect(network({ nom_station: "Howdens" })).toBeUndefined();
		expect(network({ nom_amenageur: "Howdens Toulouse" })).toBeUndefined();
		expect(
			network({ nom_amenageur: "Howdens", nom_operateur: "Howdens", nom_station: "Dépôt Sud" }),
		).toBe("Howdens");
	});

	it("quotes the owner's field for an operator read from it", () => {
		const x = irve.extract(
			[irveRow({ nom_operateur: "", nom_amenageur: "Toulouse Métropole" })],
			"u",
		);
		expect(x?.tags.find((t) => t.k === "operator")).toMatchObject({
			v: "Toulouse Métropole",
			path: "nom_amenageur",
			parts: [{ text: "nom_amenageur: " }, { text: "Toulouse Métropole" }],
		});
	});

	it("proposes no owner for a site whose stations name different owners", () => {
		// PROUDREED_VENISSIEUX (WAAT): the AC station and its DC neighbour are owned apart.
		const station = (id: string, point: string, nom_amenageur: string, ccs: string) =>
			irveRow({
				id_station_itinerance: id,
				id_pdc_itinerance: point,
				nom_station: id === "FRWA2P488438" ? "PROUDREED_VENISSIEUX" : "PROUDREED_VENISSIEUX_DC",
				nom_operateur: "WAAT Umbrella-Copro",
				nom_amenageur,
				nbre_pdc: id === "FRWA2P488438" ? "3" : "2",
				prise_type_2: ccs === "true" ? "false" : "true",
				prise_type_combo_ccs: ccs,
				consolidated_latitude: "45.719553997",
				consolidated_longitude: "4.860102739",
			});
		const ac = ["FRWA2E3576922", "FRWA2E3576930", "FRWA2E3576933"].map((p) =>
			station("FRWA2P488438", p, "TOURMALINE REAL ESTATE", "false"),
		);
		const dc = ["FRWA2E3756350", "FRWA2E3756355"].map((p) =>
			station("FRWA2P631984", p, "SCI PARIS PROVINCES PROPERTIES", "true"),
		);
		const owner = (rows: Row[]) => irve.extract(rows, "u")?.tags.find((t) => t.k === "owner")?.v;
		expect(owner([...ac, ...dc])).toBeUndefined();
		expect(owner(ac)).toBe("TOURMALINE REAL ESTATE");
	});

	it("proposes no owner to an object whose owner's SIREN is another's", () => {
		// VIL01 - Gratte-Ciel - Dedieu: node/11109171904 carries Grand Lyon's SIREN.
		const ops = (nom_amenageur: string, siren_amenageur: string) =>
			updateOps(irve.extract([irveRow({ nom_amenageur, siren_amenageur })], "u")?.tags ?? [], {
				amenity: "charging_station",
				"owner:ref:FR:SIREN": "419070180",
			}).find((o) => o.k === "owner")?.v;
		expect(ops("IZIVIA FMET 1", "844799288")).toBeUndefined();
		expect(ops("Grand Lyon", "419 070 180")).toBe("Grand Lyon");
		expect(ops("Grand Lyon", "")).toBe("Grand Lyon");
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

	it("reads a declaration's last change from the PAN's file, which names the column for the dataset", () => {
		const point = { id_pdc_itinerance: "FR*S63*E0001*1", date_maj: "2026-10-03" };
		const old = irveRow({
			...point,
			nom_enseigne: "Stale",
			datagouv_last_modified: "2026-10-02T06:00:00.000000+0000",
		});
		const fresh = irveRow({ ...point, datagouv_last_modified: "2026-10-03T06:00:00.000000+0000" });
		for (const rows of [
			[old, fresh],
			[fresh, old],
		])
			expect(irve.extract(rows, "u")?.tags.find((t) => t.k === "network")?.v).toBe("ReseauCharge");
	});

	it("reads each point's cable from its newest declaration that states it before ruling a socket out", () => {
		// RELAIS TOULOUSE ESPAGNE: the 2026 copy says both type 2 points carry a cable, the
		// operator's 2024 file leaves the column blank. way/1493526842 maps socket:type2=4.
		const connectors: Record<number, [string, string][]> = {
			1: [
				["prise_type_2", "true"],
				["prise_type_combo_ccs", "true"],
			],
			2: [
				["prise_type_combo_ccs", "true"],
				["prise_type_chademo", "true"],
			],
			3: [["prise_type_combo_ccs", "true"]],
			4: [["prise_type_combo_ccs", "true"]],
			5: [
				["prise_type_2", "true"],
				["prise_type_combo_ccs", "true"],
			],
			6: [
				["prise_type_combo_ccs", "true"],
				["prise_type_chademo", "true"],
			],
		};
		const older: Record<number, [string, string][]> = {
			...connectors,
			2: [["prise_type_chademo", "true"]],
			6: [["prise_type_chademo", "true"]],
		};
		const point = (n: number, over: Row, set: [string, string][]) =>
			irveRow({
				id_station_itinerance: "FRHPCPNF059709",
				id_pdc_itinerance: `FRHPCENF05970900${n}`,
				nom_station: "RELAIS TOULOUSE ESPAGNE",
				nom_operateur: "TotalEnergies Marketing France",
				nom_amenageur: "TotalEnergies Marketing France",
				nbre_pdc: "6",
				puissance_nominale: "300",
				prise_type_2: "false",
				...Object.fromEntries(set),
				...over,
			});
		const rows = [1, 2, 3, 4, 5, 6].flatMap((n) => [
			point(
				n,
				{
					date_maj: "2026-01-07",
					cable_t2_attache: connectors[n][0][0] === "prise_type_2" ? "True" : "False",
				},
				connectors[n],
			),
			point(n, { date_maj: "2024-04-03", cable_t2_attache: "" }, older[n]),
		]);
		const x = irve.extract(rows, "u");
		expect(x?.tags.find((t) => t.k === "socket:type2_cable")?.v).toBe("2");
		expect(x?.absent).toContain("socket:type2");
	});

	it("reads a station from its operator's own file over an aggregator's copy of the same day", () => {
		// VIL03 - La Doua (FRGLYPLYON133): Izivia's file and Qualicharge's copy, both 2026-10-04.
		const doua = (point: string, over: Row) =>
			irveRow({
				id_station_itinerance: "FRGLYPLYON133",
				id_pdc_itinerance: point,
				nom_station: "VIL03 - La Doua",
				nom_operateur: "IZIVIA",
				puissance_nominale: "24.0",
				prise_type_2: "False",
				cable_t2_attache: "False",
				date_maj: "2026-10-04",
				...over,
			});
		const izivia = {
			nom_amenageur: "Grand Lyon",
			siren_amenageur: "419070180",
			nbre_pdc: "4",
			last_modified: "2026-10-04T06:02:02.674000+00:00",
			datagouv_organization_or_owner: "izivia",
			datagouv_resource_id: "e297f18c-bb35-445f-af43-0217c27ab4fe",
		};
		const copy = {
			nom_amenageur: "IZIVIA FMET 1",
			siren_amenageur: "844799288",
			nbre_pdc: "2",
			last_modified: "2026-10-04T15:33:28.702988+00:00",
			datagouv_organization_or_owner: "qualicharge",
			datagouv_resource_id: "8bb0a6e2-1016-42ba-aaee-f72f55c82e9f",
			prise_type_combo_ccs: "True",
			prise_type_chademo: "True",
		};
		const rows = [
			doua("FRGLYELYON13311", { ...izivia, prise_type_combo_ccs: "True" }),
			doua("FRGLYELYON13311", copy),
			doua("FRGLYELYON13312", { ...izivia, prise_type_2: "True" }),
			doua("FRGLYELYON13321", { ...izivia, prise_type_combo_ccs: "True" }),
			doua("FRGLYELYON13321", copy),
			doua("FRGLYELYON13322", { ...izivia, prise_type_2: "True" }),
		];
		const tags = Object.fromEntries((irve.extract(rows, "u")?.tags ?? []).map((t) => [t.k, t.v]));
		expect(tags).toMatchObject({
			capacity: "4",
			"socket:type2": "2",
			"socket:type2_combo": "2",
			owner: "Grand Lyon",
		});
		expect(tags["socket:chademo"]).toBeUndefined();
	});

	it("says a socket is not there when every type 2 point has its cable attached", () => {
		const x = irve.extract([irveRow({ cable_t2_attache: "true", nbre_pdc: "1" })], "u");
		expect(x?.absent).toContain("socket:type2");
		expect(x?.absent).not.toContain("socket:type2_cable");
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

		it("counts type 2 points with no word on their cable as sockets only where OSM has no type 2 count", () => {
			const extract = (cable_t2_attache: string) =>
				irve.extract(
					[1, 2].map((n) => point(n, { prise_type_2: "true", cable_t2_attache, nbre_pdc: "2" })),
					"u",
				);
			const stated = extract("false");
			expect(stated?.tags.find((t) => t.k === "socket:type2")?.addOnly).toBeUndefined();
			expect(stated?.absent).toContain("socket:type2_cable");

			const blank = extract("");
			if (!blank) throw new Error("no record");
			expect(blank.absent).not.toContain("socket:type2_cable");
			const sockets = blank.tags.filter((t) => t.k.startsWith("socket:type2"));
			const ops = (tags: Record<string, string>) => updateOps(sockets, tags).map((o) => o.k);
			expect(ops({})).toEqual(["socket:type2", "socket:type2:output"]);
			expect(ops({ "socket:type2": "4" })).toEqual([]);
			expect(ops({ "socket:type2_cable": "2" })).toEqual([]);
			const station = { type: "node" as const, id: 1, version: 1, lat: 0, lon: 0 };
			expect(stationFit(blank, { ...station, tags: { "socket:type2": "4" } })).toBeNull();
			expect(stationFit(blank, { ...station, tags: { "socket:type2_cable": "2" } })).toBeNull();
		});

		it("gives a type 2 point with no word on its cable no output where OSM already counts type 2", () => {
			// Station Ax'Stone (INOUID, Saint-Didier-au-Mont-d'Or): node/11109168767 has socket:type2=yes.
			const x = irve.extract(
				[
					irveRow({
						id_station_itinerance: "Non concerné",
						id_pdc_itinerance: "Non concerné",
						nom_station: "Station Ax'Stone",
						nom_operateur: "INOUID",
						nom_amenageur: "Ax'stone",
						nbre_pdc: "1",
						puissance_nominale: "22",
						prise_type_2: "true",
						cable_t2_attache: "",
					}),
				],
				"u",
			);
			const sockets = (x?.tags ?? []).filter((t) => t.k.startsWith("socket:"));
			expect(sockets.map((t) => t.k)).toEqual(["socket:type2", "socket:type2:output"]);
			expect(updateOps(sockets, { "socket:type2": "yes" })).toEqual([]);
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

		it("gives a DC type no cabinet's total or watts as its output, and counts a type 2 in watts as a bay", () => {
			for (const [field, power] of [
				["prise_type_combo_ccs", "1242"],
				["prise_type_combo_ccs", "50000"],
				["prise_type_chademo", "600"],
			])
				expect(outputs([point(1, { [field]: "true", puissance_nominale: power })])).toEqual({
					[field === "prise_type_chademo" ? "socket:chademo" : "socket:type2_combo"]: ["1", 0.9],
				});
			const rows = [
				point(1, { prise_type_2: "true", puissance_nominale: "22000" }),
				point(2, { prise_type_combo_ccs: "true", puissance_nominale: "50" }),
			];
			expect(capacity(rows)?.v).toBe("2");
			expect(outputs(rows)["socket:type2:output"]).toBeUndefined();
		});

		it("takes no type 2 output from a DC unit's own type 2 outlet declared at the unit's power", () => {
			// IKEA LYON - STATION 3: borne 9 is a 24 kW DC unit, its CCS point 1 and type 2 point 2.
			const ikea = (id: string, power: string, over: Row = {}) =>
				irveRow({
					id_station_itinerance: "FRIKAPIKEA96",
					id_pdc_itinerance: id,
					nom_station: "IKEA LYON - STATION 3",
					nom_operateur: "IZIVIA",
					nom_amenageur: "IKEA",
					nbre_pdc: "10",
					puissance_nominale: power,
					prise_type_2: "True",
					cable_t2_attache: "False",
					...over,
				});
			const rows = [
				...["11", "21", "31", "41", "71", "81"].map((n) => ikea(`FRIKAEIKEA96${n}`, "7.4")),
				...["51", "61"].map((n) => ikea(`FRIKAEIKEA96${n}`, "3.7")),
				ikea("FRIKAEIKEA9691", "24.0", { prise_type_2: "False", prise_type_combo_ccs: "True" }),
				ikea("FRIKAEIKEA9692", "24.0"),
			];
			expect(outputs(rows)).toMatchObject({
				"socket:type2": ["9", 0.9],
				"socket:type2:output": ["7.4 kW", 0.8],
				"socket:type2_combo:output": ["24 kW", 0.8],
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
		expect(siteName("Partage Ma Borne", "Borne 1 DC 120 AMARYLIS", "SA AMARYLIS")).toBe(false);
	});

	it("tells a site's words run together, and the owner's short name, from a brand", () => {
		expect(siteName("HCrequipublic", "INOUID-HOTEL-CREQUI", "hotel-crequi-lyon")).toBe(true);
		expect(siteName("ALDI", "SAINT-FONS", "ALDI MARCHE SARL (LYO)")).toBe(true);
		expect(siteName("TotalEnergies", "Total Energies Relais Lyon")).toBe(false);
		expect(siteName("GreenToWheel", "Tisséo Borderouge", "Green To Wheel SAS")).toBe(false);
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

describe("a station's address query", () => {
	it("asks the address base with its address, and only a coarse point moves, 100 m off", () => {
		const irve = shippedExtractor(renamingFor("fr/irve"));
		const geocode = (lat: string, lon: string) =>
			irve.extract([irveRow({ consolidated_latitude: lat, consolidated_longitude: lon })], "u")
				?.geocode;
		expect(geocode("45.7641", "4.835123")).toEqual({
			q: "1 place de la Mairie, 69001 Lyon",
			farM: 100,
			wrongM: 2000,
		});
		expect(geocode("45.76412", "4.835123")?.farM).toBe(Number.POSITIVE_INFINITY);
	});
});
