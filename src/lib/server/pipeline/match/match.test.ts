import { describe, expect, it } from "vitest";
import { stationFit } from "../any/charging-station";
import type { Extraction, OsmElement, ProposedTag } from "../types";
import { contextTags } from "./context";
import { deprecatedWarnings } from "./deprecated";
import { findAtAddress, findMatch, settlePoints, yieldToFit, yieldToIds } from "./find";
import { closureOps, disputedOps, newOps, unchangedTags, updateOps } from "./ops";
import { planUpdate } from "./plan";
import { indexRefs, sharedRefs } from "./refs";
import { sameValue } from "./values";
import {
	type MatchedBy,
	matchWarnings,
	modWarnings,
	nearbyLabels,
	type Placed,
	splitParts,
	twinWarnings,
} from "./warnings";

const el = (
	id: number,
	lat: number,
	lon: number,
	tags: Record<string, string> = {},
): OsmElement => ({ type: "node", id, version: 3, lat, lon, tags });

const tag = (k: string, v: string): ProposedTag => ({
	k,
	v,
	conf: 0.9,
	path: "f",
	parts: [{ text: v, mark: true }],
	kind: "dataset row",
});

describe("findMatch", () => {
	const els = [
		el(1, 45.7, 4.8, { name: "Pharmacie du Capitole", amenity: "pharmacy" }),
		el(2, 45.7001, 4.8001, { ref: "x", "ref:UAI": "0690001A", name: "Other" }),
		el(3, 45.7, 4.9, { "ref:EU:EVSE": "FR*A*E1;FR*A*E2" }),
	];

	it("prefers a shared ref over distance", () => {
		const idx = indexRefs(els, ["ref:UAI"]);
		const m = findMatch(
			{ lat: 45.7, lon: 4.8, name: "Pharmacie du Capitole", refs: { "ref:UAI": "0690001A" } },
			els,
			idx,
		);
		expect(m?.id).toBe(2);
	});

	it("matches an identifier whatever its separators and case", () => {
		const starred = [el(4, 0, 0, { "ref:EU:EVSE": "FR*TLS*P31555019" })];
		expect(
			findMatch(
				{ lat: 1, lon: 1, name: "", refs: { "ref:EU:EVSE": "frtlsp31555019;FRTLSE1" } },
				starred,
				indexRefs(starred, ["ref:EU:EVSE"]),
			)?.id,
		).toBe(4);
		expect(sameValue("ref:EU:EVSE", "FR*TLS*P31555019", "FRTLSP31555019")).toBe(true);
	});

	it("takes the nearest of the objects sharing an identifier, never one with another UAI", () => {
		const siret = { "ref:UAI": "0311213A", "ref:FR:SIRET": "67080157000037" };
		const two = [
			el(5, 45.701, 4.8, { "ref:FR:SIRET": "67080157000037", "ref:UAI": "0312062Y" }),
			el(6, 45.71, 4.8, { "ref:FR:SIRET": "67080157000037" }),
			el(7, 45.7, 4.8, { "ref:FR:SIRET": "67080157000037" }),
		];
		const idx = indexRefs(two, ["ref:UAI", "ref:FR:SIRET"]);
		expect(findMatch({ lat: 45.7, lon: 4.8, name: "", refs: siret }, two, idx)?.id).toBe(7);
		expect(
			findMatch(
				{ lat: 45.7011, lon: 4.8, name: "", refs: siret },
				two.slice(0, 2),
				indexRefs(two.slice(0, 2), ["ref:FR:SIRET"]),
			)?.id,
		).toBe(6);
	});

	it("never matches a sibling school carrying another UAI by name and distance", () => {
		const sibling = [
			el(8, 45.7, 4.8, { name: "École maternelle Jules Ferry", "ref:UAI": "0690002B" }),
		];
		expect(
			findMatch(
				{
					lat: 45.7,
					lon: 4.8,
					name: "École élémentaire Jules Ferry",
					refs: { "ref:UAI": "0690001A" },
				},
				sibling,
				indexRefs(sibling, ["ref:UAI"]),
			),
		).toBeNull();
	});

	it("reads a school's académie mailbox as its UAI", () => {
		const other = [
			el(10, 45.7, 4.8, { name: "IME", "contact:email": "ce.0311827T@ac-toulouse.fr" }),
		];
		const x = { lat: 45.7, lon: 4.8, name: "IME", refs: { "ref:UAI": "0312873E" } };
		expect(findMatch(x, other, new Map())).toBeNull();
		expect(findMatch({ ...x, refs: { "ref:UAI": "0311827T" } }, other, new Map())?.id).toBe(10);
	});

	it("never matches another operator's station by name or distance", () => {
		const tesla = [
			el(11, 45.7, 4.8, { name: "Blagnac Supercharger", "ref:EU:EVSE": "FR*TSL*P16979" }),
		];
		const x = {
			kind: "FR:charging_station",
			lat: 45.7,
			lon: 4.8,
			name: "Leclerc Blagnac",
			refs: { "ref:EU:EVSE": "FREVCP000406;FREVCE000406A" },
		};
		expect(findMatch(x, tesla, new Map())).toBeNull();
		expect(findMatch({ ...x, refs: {} }, tesla, new Map())?.id).toBe(11);
	});

	it("does not let an identifier several records carry decide a match", () => {
		const ime = [el(12, 45.71, 4.8, { "ref:FR:SIRET": "77558121800465" })];
		const recs = [
			{ refs: { "ref:FR:SIRET": "77558121800465", "ref:UAI": "0312873E" } },
			{ refs: { "ref:FR:SIRET": "77558121800465", "ref:UAI": "0311827T" } },
		];
		const shared = sharedRefs(recs);
		const idx = indexRefs(ime, ["ref:FR:SIRET"]);
		const x = { lat: 45.7, lon: 4.8, name: "", ...recs[0] };
		expect(findMatch(x, ime, idx, shared)).toBeNull();
		expect(findMatch(x, ime, idx)?.id).toBe(12);
	});

	it("matches an alias of a ref key and a ;-separated list", () => {
		const aliased = [el(9, 0, 0, { "ref:FR:UAI": "0690001A" })];
		expect(
			findMatch(
				{ lat: 5, lon: 5, name: "", refs: { "ref:UAI": "0690001A" } },
				aliased,
				indexRefs(aliased, ["ref:UAI"]),
			)?.id,
		).toBe(9);
		const idx = indexRefs(els, ["ref:EU:EVSE"]);
		expect(
			findMatch({ lat: 0, lon: 0, name: "", refs: { "ref:EU:EVSE": "FR*A*E2" } }, els, idx)?.id,
		).toBe(3);
	});

	it("falls back to distance and name similarity", () => {
		const m = findMatch(
			{ lat: 45.70002, lon: 4.80002, name: "Pharmacie Capitole", refs: {} },
			els,
			new Map(),
		);
		expect(m?.id).toBe(1);
	});

	it("does not match a different name nearby, nor a right name too far", () => {
		expect(
			findMatch({ lat: 45.7, lon: 4.8, name: "Boulangerie Martin", refs: {} }, [els[0]], new Map()),
		).toBeNull();
		expect(
			findMatch(
				{ lat: 45.7016, lon: 4.8, name: "Pharmacie du Capitole", refs: {} },
				[els[0]],
				new Map(),
			),
		).toBeNull();
	});

	it("reaches as far as a directory misplaces a place for a name that clearly names it", () => {
		const fourmi = [
			el(14, 45.7012, 4.8, {
				amenity: "school",
				name: "La Fourmi",
				operator: "Association La Fourmi",
			}),
		];
		const x = { lat: 45.7, lon: 4.8, name: "École élémentaire privée La Fourmi", refs: {} };
		expect(findMatch(x, fourmi, new Map())?.id).toBe(14);
		expect(findMatch({ ...x, name: "École La Ruche" }, fourmi, new Map())).toBeNull();
	});

	it("leaves a brand or a generic label to the operator, not the name", () => {
		const allego = [el(15, 45.7003, 4.8, { name: "Allego", operator: "Allego" })];
		const x = {
			lat: 45.7,
			lon: 4.8,
			name: "Tisséo Borderouge",
			refs: {},
			tags: [tag("operator", "Allego")],
		};
		expect(findMatch(x, allego, new Map())?.id).toBe(15);
		const generic = [el(16, 45.7001, 4.8, { name: "Recharge" })];
		expect(findMatch({ ...x, tags: [] }, generic, new Map())?.id).toBe(16);
	});

	it("tells stations apart by their EVSE ids, across a change of operator code", () => {
		const b02 = [
			el(17, 45.7, 4.8, { name: "Parvis Saint Martin - B02", "ref:EU:EVSE": "FR*M31*E31555*030" }),
		];
		const x = {
			kind: "FR:charging_station",
			lat: 45.7,
			lon: 4.8,
			name: "Parvis Saint Martin",
			refs: { "ref:EU:EVSE": "FRM31P31555029" },
		};
		expect(findMatch(x, b02, new Map())).toBeNull();
		const darty = [el(18, 45.7006, 4.8, { "ref:EU:EVSE": "FR*E13*PDARTYLIMONEST69760*1" })];
		const refs = { "ref:EU:EVSE": "FRSSDPDARTYLIMONEST697601" };
		expect(
			findMatch({ lat: 45.7, lon: 4.8, name: "", refs }, darty, indexRefs(darty, ["ref:EU:EVSE"]))
				?.id,
		).toBe(18);
		const perPoint = [el(19, 45.7, 4.8, { "ref:EU:EVSE": "FR*GLY*PLYON2221" })];
		const points = { "ref:EU:EVSE": "FRGLYPLYON222;FRGLYELYON2221" };
		expect(
			findMatch(
				{ lat: 45.7, lon: 4.8, name: "", refs: points },
				perPoint,
				indexRefs(perPoint, ["ref:EU:EVSE"]),
			)?.id,
		).toBe(19);
	});

	it("does not take an all-digit pool number for the same station under another operator", () => {
		const indigo = [el(21, 45.7, 4.8, { "ref:EU:EVSE": "FR*PKG*P31555002" })];
		const x = { lat: 45.7, lon: 4.8, name: "", refs: { "ref:EU:EVSE": "FRTLSP31555002" } };
		expect(findMatch(x, indigo, indexRefs(indigo, ["ref:EU:EVSE"]))).toBeNull();
	});

	it("believes a pool id's tail alone only as far off as a misplaced point", () => {
		const darty = [el(22, 45.703, 4.8, { "ref:EU:EVSE": "FR*E13*PDARTYLIMONEST69760*1" })];
		const refs = { "ref:EU:EVSE": "FRSSDPDARTYLIMONEST697601" };
		const idx = indexRefs(darty, ["ref:EU:EVSE"]);
		expect(findMatch({ lat: 45.7, lon: 4.8, name: "", refs }, darty, idx)).toBeNull();
		expect(findMatch({ lat: 45.702, lon: 4.8, name: "", refs }, darty, idx)?.id).toBe(22);
	});

	it("does not count the commune's name as a shared word", () => {
		const inseec = [el(23, 45.7002, 4.8, { amenity: "college", name: "INSEEC MSc Toulouse" })];
		const x = {
			lat: 45.7,
			lon: 4.8,
			name: "École Technique Privée - INSEEC Toulouse",
			addr: "1 rue X, 31000 Toulouse",
			refs: {},
		};
		expect(findMatch({ ...x, addr: "" }, inseec, new Map())?.id).toBe(23);
		expect(findMatch(x, inseec, new Map())).toBeNull();
	});

	it("matches a school mapped only as its building by name, never an unnamed one", () => {
		const isc = el(24, 45.7004, 4.8, {
			building: "university",
			name: "Institut Supérieur de Commerce",
		});
		const x = {
			lat: 45.7,
			lon: 4.8,
			name: "École technique privée Institut Supérieur de Commerce",
			refs: {},
		};
		expect(findMatch(x, [isc], new Map())?.id).toBe(24);
		const bare = el(25, 45.7, 4.8, { building: "college" });
		expect(findMatch({ ...x, name: "ADONIS" }, [bare], new Map())).toBeNull();
		const grounds = el(26, 45.7008, 4.8, {
			amenity: "school",
			name: "Institut Supérieur de Commerce",
		});
		expect(findMatch(x, [isc, grounds], new Map())?.id).toBe(26);
		const uai = { ...x, refs: { "ref:UAI": "0312914Z" } };
		const both = [
			{ ...isc, tags: { ...isc.tags, "ref:UAI": "0312914Z" } },
			{ ...grounds, tags: { ...grounds.tags, "ref:UAI": "0312914Z" } },
		];
		expect(findMatch(uai, both, indexRefs(both, ["ref:UAI"]))?.id).toBe(26);
	});

	it("reads a company's name without its legal or country suffix", () => {
		const powerdot = [
			el(27, 45.7002, 4.8, {
				amenity: "charging_station",
				name: "Powerdot",
				operator: "Powerdot",
			}),
		];
		const x = {
			lat: 45.7,
			lon: 4.8,
			name: "B&M - Saint-Orens",
			refs: {},
			tags: [tag("operator", "Power Dot France")],
		};
		expect(findMatch(x, powerdot, new Map())?.id).toBe(27);
	});

	it("matches a school by its académie mailbox", () => {
		const dottin = [el(20, 45.7012, 4.8, { "contact:email": "ce.0312819W@ac-toulouse.fr" })];
		const x = { lat: 45.7, lon: 4.8, name: "", refs: { "ref:UAI": "0312819W" } };
		expect(findMatch(x, dottin, indexRefs(dottin, ["ref:UAI"]))?.id).toBe(20);
	});

	it("matches an unnamed station further out when its operator or network agrees", () => {
		const reveo = [el(13, 45.7002, 4.8, { amenity: "charging_station", operator: "Révéo" })];
		const x = {
			lat: 45.7,
			lon: 4.8,
			name: "Reveo Av. Frédéric Estèbe",
			refs: {},
			tags: [tag("operator", "Bouygues Energies & Services"), tag("network", "Reveo")],
		};
		expect(findMatch(x, reveo, new Map())?.id).toBe(13);
		expect(findMatch({ ...x, tags: [tag("operator", "Izivia")] }, reveo, new Map())).toBeNull();
	});

	it("trusts only a coincident point when a name is missing", () => {
		const bare = [el(5, 45.7, 4.8, {})];
		expect(
			findMatch({ lat: 45.70005, lon: 4.8, name: "Anything", refs: {} }, bare, new Map())?.id,
		).toBe(5);
		expect(
			findMatch({ lat: 45.7003, lon: 4.8, name: "Anything", refs: {} }, bare, new Map()),
		).toBeNull();
	});
});

describe("updateOps", () => {
	it("adds missing tags, modifies differing ones and leaves agreeing ones", () => {
		const ops = updateOps(
			[
				tag("phone", "+33 5 61 23 45 67"),
				tag("website", "https://a.fr"),
				tag("fee", "yes"),
				tag("operator", "New"),
			],
			{ phone: "05.61.23.45.67", website: "http://www.a.fr/", operator: "Old" },
		);
		expect(ops.map((o) => [o.k, o.op, o.was])).toEqual([
			["fee", "add", null],
			["operator", "mod", "Old"],
		]);
	});

	it("only fills a gap with an add-only tag, never overwrites one", () => {
		const open = { ...tag("access", "yes"), addOnly: true };
		expect(updateOps([open], { access: "customers" })).toEqual([]);
		expect(updateOps([open], {}).map((o) => [o.k, o.op])).toEqual([["access", "add"]]);
	});

	it("treats a reordered ;-list as the same value", () => {
		expect(sameValue("ref:EU:EVSE", "a;b", "b; a")).toBe(true);
		expect(sameValue("name", "a", "b")).toBe(false);
	});

	it("proposes an address whole or not at all", () => {
		const addr = (k: string, v: string) => ({ ...tag(k, v), addOnly: true, group: "addr" });
		const proposed = [
			addr("addr:housenumber", "6"),
			addr("addr:street", "Boulevard Michelet"),
			addr("addr:postcode", "31000"),
		];
		expect(updateOps(proposed, { "addr:street": "Boulevard Jules Michelet" })).toEqual([]);
		expect(updateOps(proposed, { "addr:street": "boulevard michelet" }).map((o) => o.k)).toEqual([
			"addr:housenumber",
			"addr:postcode",
		]);
	});

	it("moves an address held as contact:* to addr:*, in the mapper's spelling", () => {
		const addr = (k: string, v: string) => ({ ...tag(k, v), addOnly: true, group: "addr" });
		const proposed = [addr("addr:street", "Rue des troubadours"), addr("addr:city", "Cugnaux")];
		const ops = updateOps(proposed, {
			"contact:street": "Rue des Troubadours",
			"contact:housenumber": "20",
		});
		expect(ops.map((o) => [o.op, o.k, o.v])).toEqual([
			["add", "addr:street", "Rue des Troubadours"],
			["del", "contact:street", "Rue des Troubadours"],
			["add", "addr:housenumber", "20"],
			["del", "contact:housenumber", "20"],
			["add", "addr:city", "Cugnaux"],
		]);
		expect(ops.map((o) => [o.k, o.pair, o.group])).toEqual([
			["addr:street", "contact:street", "addr"],
			["contact:street", "addr:street", "addr"],
			["addr:housenumber", "contact:housenumber", "addr"],
			["contact:housenumber", "addr:housenumber", "addr"],
			["addr:city", undefined, "addr"],
		]);
		expect(updateOps(proposed, { "contact:street": "Rue du Nord" })).toEqual([]);
	});

	it("leaves a level the object lists among others, and a number it has as its mobile", () => {
		expect(
			updateOps([tag("school:FR", "lycée")], { "school:FR": "collège;primaire;lycée" }),
		).toEqual([]);
		expect(
			updateOps([tag("phone", "+33 6 95 80 09 08")], {
				mobile: "+33 6 95 80 09 08",
				"contact:instagram": "x",
			}),
		).toEqual([]);
		expect(
			updateOps([tag("phone", "+33 4 00 00 00 00")], { "contact:instagram": "x" }).map((o) => o.k),
		).toEqual(["phone"]);
	});

	it("replaces an untyped connector count with the typed ones", () => {
		const ops = updateOps([tag("socket:type2_combo", "4")], {
			"socket:unknown": "4",
			"socket:unknown:output": "150",
		});
		expect(ops.map((o) => [o.op, o.k])).toEqual([
			["add", "socket:type2_combo"],
			["del", "socket:unknown"],
			["del", "socket:unknown:output"],
		]);
	});

	it("quotes every typed count an untyped one is replaced by, and no count that only fills a gap", () => {
		// Allego FREVCP000209 on node/14134684301, which maps socket:unknown=4.
		const fills = { ...tag("socket:type2", "2"), path: "prise_type_2", addOnly: true };
		const ops = updateOps(
			[
				fills,
				{ ...tag("socket:type2_combo", "4"), path: "prise_type_combo_ccs" },
				tag("socket:type2_combo:output", "150 kW"),
				{ ...tag("socket:typee", "2"), path: "prise_type_ef" },
			],
			{ amenity: "charging_station", "socket:unknown": "4" },
		);
		const del = ops.find((o) => o.op === "del");
		expect(del).toMatchObject({ k: "socket:unknown", path: "prise_type_combo_ccs, prise_type_ef" });
		expect(del?.parts.map((p) => p.text).join("")).toBe(
			"replaced by socket:type2_combo=4, socket:typee=2",
		);
		expect(updateOps([fills], { "socket:unknown": "4" }).map((o) => o.op)).toEqual(["add"]);
	});

	it("proposes no ad-hoc access to a station surveyed as badge-only", () => {
		const none = { ...tag("authentication:none", "yes"), addOnly: true };
		expect(updateOps([none], { "payment:membership_card": "yes" })).toEqual([]);
		expect(updateOps([none], {})).toHaveLength(1);
	});

	it("never replaces a list of ids that already holds the record's", () => {
		expect(updateOps([tag("ref:UAI", "0692864N")], { "ref:UAI": "0692864N;0690053H" })).toEqual([]);
	});

	it("never replaces another establishment's UAI or SIRET, and says which the object carries", () => {
		const calandreta = {
			kind: "FR:school",
			lat: 43.57643348998152,
			lon: 1.389875951209224,
			name: "Collège Calandreta del País Tolzan",
			tags: [
				tag("amenity", "school"),
				tag("ref:UAI", "0312885T"),
				tag("ref:FR:SIRET", "79441405200025"),
			],
			refs: { "ref:UAI": "0312885T", "ref:FR:SIRET": "79441405200025" },
		};
		const way = {
			...el(517299654, 43.5762399, 1.3895452, {
				amenity: "school",
				"contact:email": "ce.0312885T@ac-toulouse.fr",
				name: "Collège Calandreta del País Tolzan",
				"ref:FR:SIRET": "79441405200025",
				"ref:UAI": "0312123P",
				"school:FR": "collège",
			}),
			type: "way" as const,
		};
		expect(updateOps(calandreta.tags, way.tags)).toEqual([]);
		expect(matchWarnings(calandreta, way, [way])).toContain(
			"OSM has ref:UAI=0312123P where the source says 0312885T: left alone, since it may be another establishment's; check which is right",
		);
	});
});

describe("newOps / closureOps", () => {
	it("newOps adds everything", () => {
		expect(newOps([tag("a", "1")])).toMatchObject([{ op: "add", k: "a", was: null }]);
	});

	it("closure marks the main tag disused and removes hours and phone", () => {
		const ops = closureOps(
			{ path: "etat", kind: "dataset row", parts: [{ text: "FERME", mark: true }] },
			{ amenity: "school", opening_hours: "Mo-Fr 08:00-17:00", phone: "+33 1", name: "X" },
			0.8,
		);
		expect(ops.map((o) => [o.op, o.k, o.v])).toEqual([
			["mod", "disused:amenity", "school"],
			["del", "opening_hours", "Mo-Fr 08:00-17:00"],
			["del", "phone", "+33 1"],
		]);
		expect(ops[0].was).toBe("amenity=school");
	});

	it("closure of an element with no main tag proposes nothing", () => {
		expect(closureOps({ path: "p", kind: "k", parts: [] }, { name: "x" }, 0.8)).toEqual([]);
	});
});

describe("context", () => {
	it("labels the closest features within reach", () => {
		const els = [
			el(1, 45.7, 4.8, { amenity: "cafe", name: "Chez Paul" }),
			el(2, 45.7002, 4.8, { shop: "bakery" }),
			el(3, 46, 5, {}),
		];
		const labels = nearbyLabels({ lat: 45.7, lon: 4.8 }, els, els[0]);
		expect(labels).toHaveLength(1);
		expect(labels[0]).toMatch(/^22 m {2}shop=bakery$/);
	});

	it("shows what the object is and what identifies it before its address", () => {
		const out = contextTags(
			unchangedTags(
				{
					"addr:street": "Rue X",
					"addr:city": "Lyon",
					"addr:postcode": "69001",
					"addr:housenumber": "1",
					"contact:email": "ce.0690001A@ac-lyon.fr",
					"ref:UAI": "0690001A",
					"school:FR": "lycée",
					amenity: "college",
				},
				new Set(),
			),
		);
		expect(out.slice(0, 4).map((t) => t.k)).toEqual([
			"amenity",
			"ref:UAI",
			"school:FR",
			"contact:email",
		]);
		expect(out).toHaveLength(6);
	});

	it("does not propose an operator line the object already has as its phone", () => {
		expect(
			updateOps([tag("operator:phone", "+33 4 72 00 00 01")], { phone: "04 72 00 00 01" }),
		).toEqual([]);
	});

	it("keeps every tag the candidate did not touch, and shows only those that give context", () => {
		const out = unchangedTags(
			{ name: "A", phone: "1", "addr:city": "Lyon", wheelchair: "yes" },
			new Set(["phone"]),
		);
		expect(out).toEqual([
			{ k: "name", v: "A" },
			{ k: "addr:city", v: "Lyon" },
			{ k: "wheelchair", v: "yes" },
		]);
		expect(contextTags(out).map((t) => t.k)).toEqual(["name", "addr:city"]);
	});

	it("does not show a closed place's main tag as left alone", () => {
		const current = { amenity: "pharmacy", name: "P" };
		const ops = closureOps({ path: "p", kind: "k", parts: [] }, current, 0.8);
		expect(unchangedTags(current, new Set(ops.map((o) => o.k)))).toEqual([{ k: "name", v: "P" }]);
	});
});

describe("updateOps regressions", () => {
	it("agrees with a value another site of the same establishment gives", () => {
		const phone = { ...tag("phone", "+33 5 61 62 46 59"), also: ["+33 5 61 21 99 71"] };
		expect(updateOps([phone], { phone: "+33 5 61 21 99 71" })).toEqual([]);
		expect(updateOps([phone], { phone: "+33 5 61 00 00 00" })).toHaveLength(1);
	});

	it("reads a housenumber the same whatever its spacing, case or leading zero", () => {
		expect(sameValue("addr:housenumber", "62bis", "62 bis")).toBe(true);
		expect(sameValue("addr:housenumber", "7", "07")).toBe(true);
		expect(sameValue("addr:housenumber", "158bis", "158 BIS")).toBe(true);
		expect(sameValue("addr:housenumber", "17", "7")).toBe(false);
	});

	it("leaves a name that only differs by accents, case or punctuation", () => {
		expect(
			updateOps([tag("name", "Ecole maternelle Charles Peguy")], {
				name: "École maternelle Charles Péguy",
			}),
		).toEqual([]);
		expect(
			updateOps([tag("operator", "Bouygues Energies & Services")], {
				operator: "Bouygues Énergies et Services",
			}),
		).toEqual([]);
	});

	it("reads a power by its number, not its spelling", () => {
		expect(
			updateOps([tag("socket:type2:output", "22 kW")], { "socket:type2:output": "22.0 kW" }),
		).toEqual([]);
	});

	it("reads 23:57 as all day", () => {
		expect(
			updateOps([tag("opening_hours", "Mo-Su 00:00-23:57")], { opening_hours: "24/7" }),
		).toEqual([]);
	});

	it("keeps a contact detail in the scheme the object already uses", () => {
		expect(
			updateOps([tag("phone", "+33 5 61 21 83 64")], { "contact:phone": "+33 5 61 21 83 64" }),
		).toEqual([]);
		const added = updateOps([tag("website", "https://x.fr")], { "contact:email": "a@x.fr" });
		expect(added.map((o) => [o.op, o.k])).toEqual([["add", "contact:website"]]);
		expect(updateOps([tag("phone", "+33 5 61 00 00 00")], {}).map((o) => o.k)).toEqual(["phone"]);
	});
});

describe("matchWarnings", () => {
	const station = { k: "amenity", v: "charging_station" } as const;
	const x = { lat: 45.7, lon: 4.8, name: "", tags: [tag(station.k, station.v)], refs: {} };

	it("calls a new POI with one of its kind close by a possible duplicate", () => {
		const near = el(1, 45.7005, 4.8, { amenity: "charging_station" });
		expect(matchWarnings(x, null, [near])[0]).toMatch(/^Possible duplicate: .*node\/1, 56 m away/);
		expect(matchWarnings(x, null, [el(2, 45.71, 4.8, { amenity: "charging_station" })])).toEqual(
			[],
		);
	});

	it("looks for a moved record's duplicate where the source placed it too", () => {
		const moved = { ...x, lat: 45.71, from: { lat: 45.7, lon: 4.8 } };
		const near = el(1, 45.7005, 4.8, { amenity: "charging_station" });
		expect(matchWarnings(moved, null, [near])[0]).toMatch(/^Possible duplicate: .*node\/1, 56 m/);
	});

	it("names the other objects a matched site is split over", () => {
		const a = el(1, 45.7, 4.8, { amenity: "charging_station" });
		const b = el(2, 45.70005, 4.8, { amenity: "charging_station" });
		expect(matchWarnings(x, a, [a, b])[0]).toMatch(
			/^Same site may be mapped as 2 objects \(also node\/2/,
		);
		expect(matchWarnings(x, a, [a])).toEqual([]);
	});

	it("does not take a sibling school with its own UAI for a duplicate", () => {
		const school = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name: "ESARC",
			tags: [tag("amenity", "school")],
			refs: { "ref:UAI": "0690001A" },
		};
		const sibling = el(3, 45.7002, 4.8, { amenity: "school", "ref:UAI": "0690002B" });
		expect(matchWarnings(school, null, [sibling])).toEqual([]);
	});

	it("does not take another operator's or a private station for a part of the site", () => {
		const lidl = {
			kind: "FR:charging_station",
			lat: 45.7,
			lon: 4.8,
			name: "Lidl",
			tags: [tag("amenity", "charging_station"), tag("operator", "Lidl"), tag("access", "yes")],
			refs: { "ref:EU:EVSE": "FRLDLPLFR3657EVCP" },
		};
		const a = el(1, 45.7, 4.8, { amenity: "charging_station" });
		const izivia = el(2, 45.7001, 4.8, { amenity: "charging_station", operator: "Izivia" });
		const other = el(3, 45.7001, 4.8, {
			amenity: "charging_station",
			"ref:EU:EVSE": "FR*GLY*PLYON2212",
		});
		const closed = el(4, 45.7001, 4.8, { amenity: "charging_station", access: "private" });
		const part = el(5, 45.7001, 4.8, { amenity: "charging_station" });
		expect(splitParts(lidl, a, [a, izivia, other, closed, part]).map((k) => k.e.id)).toEqual([5]);
	});

	it("names the kind of object it found, and sees an institute mapped as a school", () => {
		const ime = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name: "IME",
			tags: [tag("amenity", "social_facility")],
			refs: {},
		};
		const school = el(6, 45.7005, 4.8, { amenity: "school" });
		expect(matchWarnings(ime, null, [school])[0]).toMatch(/^Possible duplicate: amenity=school /);
	});

	it("names a school carrying another UAI at the record's address or phone, never matching it", () => {
		const college = {
			kind: "FR:school",
			lat: 45.7406,
			lon: 4.8493,
			name: "Collège privé la Chrysalide",
			tags: [
				tag("amenity", "school"),
				tag("phone", "+33 9 50 12 86 71"),
				tag("addr:housenumber", "4"),
				tag("addr:street", "Rue de Cronstadt"),
			],
			refs: { "ref:UAI": "0694314P" },
		};
		const sister = el(7, 45.7405, 4.8491, {
			amenity: "school",
			name: "École primaire privée La Chrysalide",
			"ref:UAI": "0694243M",
			phone: "+33950128671",
		});
		expect(findMatch(college, [sister], indexRefs([sister], ["ref:UAI"]))).toBeNull();
		expect(matchWarnings(college, null, [sister])).toContainEqual(
			expect.stringMatching(
				/^Another establishment \(ref:UAI=0694243M\) with the same phone or email is mapped at node\/7/,
			),
		);
		const elsewhere = el(8, 45.7405, 4.8491, { amenity: "school", "ref:UAI": "0694243M" });
		expect(matchWarnings(college, null, [elsewhere]).join()).not.toMatch(/Another establishment/);
	});

	it("does not take another school in the same building for a part of the site", () => {
		const school = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name: "ESARC",
			tags: [tag("amenity", "school")],
			refs: {},
		};
		const esarc = el(4, 45.7, 4.8, { amenity: "school", name: "ESARC Évolution" });
		const lisaa = el(5, 45.70005, 4.8, { amenity: "school", name: "LISAA Toulouse" });
		const annex = el(6, 45.70005, 4.8, { amenity: "school" });
		expect(splitParts(school, esarc, [esarc, lisaa, annex]).map((k) => k.e.id)).toEqual([6]);
	});

	it("says when the matched object is far from the source's point", () => {
		const far = el(7, 45.702, 4.8, { amenity: "charging_station" });
		expect(matchWarnings(x, far, [far])[0]).toMatch(/^Matched to node\/7, 222 m away/);
		expect(matchWarnings(x, el(8, 45.7001, 4.8), [])).toEqual([]);
	});

	it("takes another object carrying the record's own id for a part of the site, however far", () => {
		const louis = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name: "École maternelle Louis Armand",
			tags: [tag("amenity", "school")],
			refs: { "ref:UAI": "0693634A", "ref:FR:SIRET": "21690266800013" },
		};
		const a = el(1, 45.7, 4.8, { amenity: "school", "ref:UAI": "0693634A" });
		const b = el(2, 45.7007, 4.8, {
			building: "school",
			name: "Bâtiment Maternelle",
			"ref:UAI": "0693634A",
		});
		const c = el(3, 45.7007, 4.8, { "ref:FR:SIRET": "21690266800013" });
		const idx = indexRefs([a, b, c], ["ref:UAI", "ref:FR:SIRET"]);
		expect(splitParts(louis, a, [a, b, c], idx).map((k) => k.e.id)).toEqual([2]);
		expect(matchWarnings(louis, a, [a, b, c], idx)[0]).toBe(
			"Another object carrying this UAI is node/2 “Bâtiment Maternelle”, 78 m away",
		);
		const shared = sharedRefs([louis, { refs: { "ref:UAI": "0693634A" } }]);
		expect(splitParts(louis, a, [a, b, c], idx, shared)).toEqual([]);
	});

	it("says a school mapped only as its building gets its amenity", () => {
		const school = { ...x, kind: "FR:school", name: "ISC", tags: [tag("amenity", "college")] };
		const isc = el(9, 45.7, 4.8, { building: "university", name: "ISC" });
		expect(matchWarnings(school, isc, [isc])).toEqual([
			"OSM maps this school only as building=university: amenity=college is added to the building",
		]);
	});

	it("sees an unnamed school building, a charge point or a health centre as a possible duplicate", () => {
		const school = { ...x, kind: "FR:school", name: "ADONIS", tags: [tag("amenity", "college")] };
		const bare = el(10, 45.7001, 4.8, { building: "college" });
		expect(matchWarnings(school, null, [bare])).toEqual([
			"Possible duplicate: building=college already mapped at node/10, 11 m away",
		]);
		const point = el(11, 45.7001, 4.8, { man_made: "charge_point" });
		expect(matchWarnings(x, null, [point])[0]).toMatch(
			/^Possible duplicate: man_made=charge_point/,
		);
		const six = el(13, 45.7001, 4.8, { "capacity:charging": "6" });
		expect(matchWarnings(x, null, [six])[0]).toMatch(
			/^Possible duplicate: capacity:charging=6 already mapped at node\/13/,
		);
		const cra = {
			...x,
			name: "Centre ressources autisme",
			tags: [
				tag("amenity", "social_facility"),
				tag("addr:housenumber", "95"),
				tag("addr:street", "Boulevard Pinel"),
			],
		};
		const centre = el(12, 45.7016, 4.8, {
			healthcare: "centre",
			"addr:housenumber": "95",
			"addr:street": "Boulevard Pinel",
		});
		expect(matchWarnings(cra, null, [centre])[0]).toMatch(
			/^Possible duplicate: healthcare=centre already mapped at node\/12, 178 m away/,
		);
		const elsewhere = { ...centre, tags: { healthcare: "centre" } };
		expect(matchWarnings(cra, null, [elsewhere])).toEqual([]);
		const home = el(13, 45.7005, 4.8, {
			amenity: "social_facility",
			"social_facility:for": "senior",
		});
		expect(matchWarnings(cra, null, [home])).toEqual([]);
	});

	it("looks further for a possible duplicate run by the same operator", () => {
		const allego = { ...x, tags: [...x.tags, tag("operator", "Allego")] };
		const far = el(14, 45.7018, 4.8, { amenity: "charging_station", operator: "Allego" });
		expect(matchWarnings(allego, null, [far])[0]).toMatch(/node\/14, 200 m away/);
		expect(matchWarnings(x, null, [far])).toEqual([]);
	});
});

describe("twinWarnings", () => {
	const rec = (key: string, lat: number, more: Partial<Extraction> = {}): Extraction => ({
		key,
		url: "",
		name: key,
		addr: "",
		lat,
		lon: 4.8,
		refs: {},
		tags: [],
		...more,
	});

	it("pairs new records at one point, with one SIRET or at one address", () => {
		const twins = twinWarnings([
			rec("a", 45.7),
			rec("b", 45.70001),
			rec("c", 45.71, { refs: { "ref:FR:SIRET": "1" } }),
			rec("d", 45.72, { refs: { "ref:FR:SIRET": "1" } }),
			rec("e", 45.73, { tags: [tag("addr:housenumber", "3"), tag("addr:street", "Rue X")] }),
			rec("f", 45.74, { tags: [tag("addr:housenumber", "3"), tag("addr:street", "rue x")] }),
			rec("g", 45.75),
		]);
		expect(twins.get("a")).toEqual([
			"Another new candidate, “b” (b), lies 1 m away: the two may be one place",
		]);
		expect(twins.get("d")?.[0]).toMatch(/“c” \(c\), has the same SIRET/);
		expect(twins.get("e")?.[0]).toMatch(/“f” \(f\), has the same address/);
		expect(twins.has("g")).toBe(false);
	});
});

describe("modWarnings", () => {
	const mod = (k: string, was: string, v: string) => ({
		...tag(k, v),
		op: "mod" as const,
		was,
	});
	const now = Date.UTC(2026, 9, 4);

	it("names every value of a mapper's a candidate overwrites, and a recent survey", () => {
		const ops = [
			mod("capacity", "4", "6"),
			{ ...tag("phone", "1"), op: "add" as const, was: null },
		];
		expect(modWarnings(ops, { capacity: "4" }, now)).toEqual([
			"OSM has capacity=4 where the source says 6; a mapper may have set it on purpose",
		]);
		expect(
			modWarnings(
				ops,
				{ capacity: "4", check_date: "2026-08-30", "check_date:opening_hours": "2024-01-01" },
				now,
			),
		).toEqual([
			"OSM has capacity=4 where the source says 6, and a mapper checked this object on 30-08-2026",
		]);
		expect(modWarnings(ops, { "survey:date": "2025-06-01" }, now)[0]).toMatch(/on purpose$/);
	});
});

describe("what the object is now", () => {
	const school = {
		kind: "FR:school",
		lat: 45.7,
		lon: 4.8,
		name: "Cours Diderot",
		tags: [tag("amenity", "college"), tag("name", "Cours Diderot")],
		refs: { "ref:UAI": "0694118B" },
	};
	const live = el(1, 45.70005, 4.8, { amenity: "college", name: "Cours Diderot" });

	it("lets no id on a closed, renamed, rebuilt or repurposed object settle the match", () => {
		const retired: Record<string, string>[] = [
			{ "disused:amenity": "college" },
			{ amenity: "college", "was:name": "Cours Diderot" },
			{ office: "company", name: "Acme" },
			{ landuse: "construction", opening_date: "2099-09-01" },
		];
		for (const tags of retired) {
			const stale = el(2, 45.73, 4.8, { ...tags, "ref:UAI": "0694118B" });
			const els = [live, stale];
			expect(findMatch(school, els, indexRefs(els, ["ref:UAI"]))?.id).toBe(1);
		}
	});

	it("names an object carrying the id it no longer answers to, and never reopens it", () => {
		const closed = el(2, 45.7001, 4.8, { "disused:amenity": "college", "ref:UAI": "0694118B" });
		const idx = indexRefs([closed], ["ref:UAI"]);
		expect(matchWarnings(school, null, [closed], idx)).toContainEqual(
			expect.stringMatching(
				/^node\/2, 11 m away carries this record's id, but it is mapped as disused:amenity=college/,
			),
		);
		expect(updateOps(school.tags, closed.tags).map((o) => o.k)).toEqual(["name"]);
		const site = el(3, 45.7, 4.8, { landuse: "construction", name: "Cours Diderot" });
		expect(planUpdate(school, site, [site]).ops).toEqual([]);
		expect(matchWarnings(school, site, [site])[0]).toMatch(
			/under construction, so amenity=college is not added/,
		);
	});
});

describe("far from the record's address", () => {
	const x = {
		kind: "FR:school",
		lat: 45.7,
		lon: 4.8,
		atAddress: { lat: 45.7, lon: 4.8, label: "1 Rue X 69001 Lyon" },
		name: "Ombrosa",
		tags: [
			tag("amenity", "school"),
			tag("phone", "+33 4 78 23 22 63"),
			tag("ref:FR:SIRET", "77984535300027"),
			{ ...tag("addr:street", "Quai Clemenceau"), group: "addr" },
		],
		refs: {},
	};

	it("leaves out the address, contacts and SIRET, and says why", () => {
		const far = el(1, 45.735, 4.8, { amenity: "school", "contact:website": "https://a.fr" });
		const plan = planUpdate(x, far, [far]);
		expect(plan.ops).toEqual([]);
		expect(plan.far).toBeCloseTo(3892, -1);
		expect(matchWarnings(x, far, [far])[0]).toMatch(
			/^Matched to node\/1, 3.9 km from where the source and the address base place it: .* so its address, contacts, SIRET and opening date are left out$/,
		);
		const near = el(2, 45.703, 4.8, { amenity: "school" });
		expect(planUpdate(x, near, [near]).ops).toHaveLength(3);
	});

	it("lists only what the record's kind writes", () => {
		const far = (kind: string, tags: string[]) => {
			const e = el(1, 45.735, 4.8, { amenity: tags[0] });
			return matchWarnings({ ...x, kind, tags: [tag("amenity", tags[0])] }, e, [e])[0];
		};
		expect(far("FR:charging_station", ["charging_station"])).toMatch(
			/stale, so its opening date is left out$/,
		);
		expect(far("FR:defibrillator", ["defibrillator"])).toMatch(
			/stale, so its opening date is left out$/,
		);
	});

	it("is near when either the source's point or the base's housenumber or street is", () => {
		const school = el(1, 45.735, 4.8, { amenity: "school" });
		const at = { lat: 45.734, lon: 4.8, label: "Chemin X" };
		expect(planUpdate({ ...x, lat: 45.734 }, school, [school]).ops).toHaveLength(3);
		expect(planUpdate({ ...x, atAddress: undefined, onStreet: at }, school, [school]).far).toBe(
			undefined,
		);
	});

	it("writes nothing that says what the place is onto a far object mapped as no place", () => {
		const building = el(1, 45.735, 4.8, { building: "yes", "ref:UAI": "0694161Y" });
		const y = {
			...x,
			tags: [...x.tags, tag("name", "Enfants Précoces"), tag("start_date", "2010")],
		};
		expect(planUpdate(y, building, [building]).ops).toEqual([]);
	});
});

describe("new records whose point stayed put", () => {
	const x = {
		kind: "FR:charging_station",
		key: "a",
		lat: 43.61665,
		lon: 1.352185,
		name: "Airbus M51",
		tags: [tag("amenity", "charging_station")],
		refs: {},
		atAddress: { lat: 43.618261, lon: 1.356936, label: "15 Avenue Yves Brunaud 31770 Colomiers" },
	};

	it("say how far their address is, once that is past what the preset would move them for", () => {
		const never = { ...x, geocode: { q: "", farM: Number.POSITIVE_INFINITY } };
		expect(matchWarnings(never, null, [])).toEqual([
			"Its address, 15 Avenue Yves Brunaud 31770 Colomiers, is 422 m away",
		]);
		expect(matchWarnings({ ...x, geocode: { q: "", farM: 1000 } }, null, [])).toEqual([]);
	});

	it("are matched at their address when nothing stands at their point, unless the counts say otherwise", () => {
		const never = { ...x, geocode: { q: "", farM: Number.POSITIVE_INFINITY } };
		const there = el(1, 43.61826, 1.35694, { amenity: "charging_station", operator: "Airbus" });
		const y = { ...never, tags: [...x.tags, tag("operator", "Airbus"), tag("capacity", "4")] };
		expect(findAtAddress(y, [there], new Map(), new Set())?.id).toBe(1);
		const small = { ...there, tags: { ...there.tags, capacity: "2" } };
		expect(findAtAddress(y, [small], new Map(), new Set())).toBeNull();
		expect(
			findAtAddress({ ...y, geocode: { q: "", farM: 100 } }, [there], new Map(), new Set()),
		).toBeNull();
	});
});

describe("split sites", () => {
	const toulibeo = {
		kind: "FR:charging_station",
		key: "FRTLSP31555021",
		lat: 45.7,
		lon: 4.8,
		name: "TOULOUSE - 10 Boulevard Escande",
		tags: [tag("amenity", "charging_station"), tag("operator", "Bouygues Energies & Services")],
		refs: { "ref:EU:EVSE": "FRALLEGO002084P1" },
	};

	it("takes a neighbour agreeing with the matched object's operator, and a point id without its connector", () => {
		const a = el(1, 45.7, 4.8, { amenity: "charging_station", brand: "EVBox", operator: "Izivia" });
		const b = el(2, 45.7001, 4.8, { amenity: "charging_station", operator: "Izivia" });
		const c = el(3, 45.71, 4.8, { amenity: "charging_station", "ref:EU:EVSE": "FRALLEGO002084" });
		const idx = indexRefs([a, b, c], ["ref:EU:EVSE"]);
		expect(splitParts(toulibeo, a, [a, b, c], idx).map((k) => k.e.id)).toEqual([2, 3]);
	});

	it("leaves out an object another record of the run matched", () => {
		const a = el(1, 45.7, 4.8, { amenity: "charging_station" });
		const b = el(2, 45.7001, 4.8, { amenity: "charging_station" });
		const taken = new Map([["node/2", [{ ...toulibeo, key: "other" }]]]);
		expect(splitParts(toulibeo, a, [a, b], new Map(), new Set(), taken)).toEqual([]);
	});
});

describe("which object", () => {
	const station = (who: [string, string][]) => ({
		kind: "FR:charging_station",
		lat: 45.7,
		lon: 4.8,
		name: "TOULOUSE - Avenue de Collignon",
		tags: [tag("amenity", "charging_station"), ...who.map(([k, v]) => tag(k, v))],
		refs: {},
	});

	it("counts another operator's sign against an object, and reads Alizé as Bouygues", () => {
		const chargepoint = el(1, 45.7, 4.80001, {
			amenity: "charging_station",
			name: "ChargePoint",
			operator: "ChargePoint",
		});
		const alize = el(2, 45.7001, 4.8, { amenity: "charging_station", brand: "Alizé" });
		const x = station([["operator", "Bouygues Energies & Services"]]);
		expect(findMatch(x, [chargepoint, alize], new Map())?.id).toBe(2);
	});

	it("reads the owner as who runs the network, but never past 50 m on that alone", () => {
		const x = station([["owner", "TOULIBEO"]]);
		const named = el(1, 45.7004, 4.8, { amenity: "charging_station", name: "Toulibeo" });
		expect(findMatch(x, [named], new Map())?.id).toBe(1);
		const unnamed = el(2, 45.7008, 4.8, { amenity: "charging_station", owner: "Toulibeo" });
		expect(findMatch(x, [unnamed], new Map())).toBeNull();
	});

	it("prefers the way holding the school's UAI over a bare node beside it", () => {
		const x = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name: "Collège Stendhal",
			tags: [tag("amenity", "school")],
			refs: { "ref:UAI": "0311630D" },
		};
		const tags = { amenity: "school", name: "Collège Stendhal", "ref:UAI": "0311630D" };
		const node = el(1, 45.7, 4.8, tags);
		const way = { ...el(2, 45.7003, 4.8, tags), type: "way" as const };
		expect(findMatch(x, [node, way], indexRefs([node, way], ["ref:UAI"]))?.id).toBe(2);
	});

	it("matches the grounds a school building carrying the UAI stands in, or leaves its amenity and name out", () => {
		const name = "Collège Notre-Dame du Bon Conseil";
		const x = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name,
			tags: [tag("amenity", "school"), tag("name", name), tag("school:FR", "collège")],
			refs: { "ref:UAI": "0690541N" },
		};
		const building = el(1, 45.7, 4.8, { building: "school", "ref:UAI": "0690541N" });
		const grounds = el(2, 45.70004, 4.8, { amenity: "school", name });
		const idx = indexRefs([building], ["ref:UAI"]);
		expect(findMatch(x, [building, grounds], idx)?.id).toBe(2);
		const other = { ...grounds, tags: { ...grounds.tags, "school:FR": "élémentaire" } };
		expect(findMatch(x, [building, other], idx)?.id).toBe(1);
		expect(planUpdate(x, building, [building, other]).ops.map((o) => o.k)).toEqual(["school:FR"]);
		expect(matchWarnings(x, building, [building, other])[0]).toMatch(
			/beside node\/2 .* amenity and name are left out/,
		);
	});

	it("tells an institute's building beside its grounds what an institute gets left out", () => {
		const x = {
			kind: "FR:school",
			lat: 45.7,
			lon: 4.8,
			name: "IME Les Tilleuls",
			tags: [tag("amenity", "social_facility"), tag("name", "IME Les Tilleuls")],
			refs: { "ref:UAI": "0690541N" },
		};
		const building = el(1, 45.7, 4.8, { building: "school", "ref:UAI": "0690541N" });
		const grounds = el(2, 45.70004, 4.8, { amenity: "social_facility", name: "IME Les Tilleuls" });
		expect(matchWarnings(x, building, [building, grounds])[0]).toMatch(
			/^OSM maps this institute as building=school beside node\/2 .*, mapped as amenity=social_facility: amenity and name are left out, so the institute is not mapped twice$/,
		);
	});

	describe("a station whose counts the object repeats exactly", () => {
		const station = (
			name: string,
			lat: number,
			lon: number,
			tags: ProposedTag[],
			evse: string,
		) => ({
			kind: "FR:charging_station",
			key: evse,
			lat,
			lon,
			name,
			tags: [tag("amenity", "charging_station"), ...tags],
			refs: { "ref:EU:EVSE": evse },
		});
		const fill = (k: string, v: string) => ({ ...tag(k, v), addOnly: true });

		it("is matched up to 150 m off when who runs it or its name agrees", () => {
			// IKEA LYON - STATION 2 (FRIKAPIKEA95) and node/11531825193, 125 m off.
			const ikea = station(
				"IKEA LYON - STATION 2",
				45.718092,
				4.881303,
				[
					fill("operator", "IZIVIA"),
					tag("capacity", "24"),
					tag("socket:type2", "24"),
					tag("socket:type2:output", "7.4 kW"),
					fill("owner", "IKEA"),
				],
				"FRIKAPIKEA95",
			);
			const izivia = el(11531825193, 45.7187799, 4.8825817, {
				amenity: "charging_station",
				capacity: "24",
				network: "Izivia Grand Lyon",
				"socket:type2": "24",
				"socket:type2:output": "7 kW",
				"socket:typee": "24",
			});
			expect(findMatch(ikea, [izivia], new Map())?.id).toBe(11531825193);
			expect(matchWarnings(ikea, izivia, [izivia])).toEqual([
				"Matched to node/11531825193, 125 m away from the source's point: check it is this place",
			]);
			const other = { ...izivia, tags: { ...izivia.tags, capacity: "22", "socket:type2": "22" } };
			expect(findMatch(ikea, [other], new Map())).toBeNull();

			// Parking Béraudier P1 (e-totem for LPA) and node/12696418802, 119 m off: its name
			// without the owner's word is the record's.
			const beraudier = station(
				"Parking Béraudier P1",
				45.75958,
				4.858517,
				[
					fill("operator", "e-totem"),
					tag("capacity", "75"),
					fill("socket:type2", "75"),
					tag("socket:typee", "75"),
					fill("owner", "LPA"),
				],
				"FRG10P69383DA",
			);
			const lpa = el(12696418802, 45.7606264, 4.8588079, {
				amenity: "charging_station",
				capacity: "75",
				name: "Parc LPA Béraudier P1",
				"socket:type2": "75",
			});
			expect(findMatch(beraudier, [lpa], new Map())?.id).toBe(12696418802);
		});

		it("measures a way from its nearest edge, and takes the network's renumbered pool", () => {
			// CLINIQUE MEDIPOLE GARONNE (PARERA, FR*MW1) and way/1493527170, 29 m from its centre
			// and 25 m from its edge, carrying the network's older pool id.
			const clinique = station(
				"CLINIQUE MEDIPOLE GARONNE",
				43.5632446,
				1.4237746,
				[
					fill("operator", "PARERA MOBILITE CPO"),
					tag("capacity", "4"),
					tag("socket:type2", "4"),
					tag("socket:typee", "2"),
					fill("owner", "CLINIQUE MEDIPOLE GARONNE"),
				],
				"FRMW1PAVGKG9E774II1MVHMWP",
			);
			const way: OsmElement = {
				...el(1493527170, 43.5634928, 1.4238799, {
					amenity: "charging_station",
					network: "Mobilygreen",
					operator: "Mobilygreen",
					owner: "CLINIQUE MEDIPOLE GARONNE",
					"ref:EU:EVSE": "FR*MW1*P7658798021619996006",
					"socket:type2": "4",
					"socket:typee": "2",
				}),
				type: "way",
				bounds: { minlat: 43.5634668, minlon: 1.4238158, maxlat: 43.5635188, maxlon: 1.423944 },
			};
			expect(findMatch(clinique, [way], new Map())?.id).toBe(1493527170);
			const another = { ...way, tags: { ...way.tags, "ref:EU:EVSE": "FR*TLS*P31555020" } };
			expect(findMatch(clinique, [another], new Map())).toBeNull();
		});
	});

	describe("a car station beside two-wheeler chargers", () => {
		// Carrefour Energies - Francheville (Allego, FREVCP000141): four CCS points and four type 2
		// + E/F points; OSM maps the car units and, a few metres off, an e-bike locker, a bicycle
		// station and a scooter station.
		const francheville = {
			kind: "FR:charging_station",
			key: "FREVCP000141",
			lat: 45.7342931,
			lon: 4.7746172,
			name: "Carrefour Energies - Francheville",
			tags: [
				tag("amenity", "charging_station"),
				tag("operator", "Allego"),
				tag("network", "Carrefour Energies"),
				tag("capacity", "8"),
				tag("socket:type2", "4"),
				tag("socket:type2_combo", "4"),
				tag("socket:type2_combo:output", "150 kW"),
				tag("socket:typee", "4"),
				tag("motorcar", "yes"),
			],
			refs: { "ref:EU:EVSE": "FREVCP000141;FREVCE9003791;FREVCE9005391" },
		};
		const car = { amenity: "charging_station", operator: "Carrefour Energies", motorcar: "yes" };
		const site = [
			el(13, 45.7342824, 4.7746239, {
				...car,
				capacity: "2",
				"socket:schuko": "1",
				"socket:type2": "2",
			}),
			el(14, 45.7342855, 4.7746101, {
				...car,
				capacity: "2",
				"socket:schuko": "1",
				"socket:type2": "2",
			}),
			el(15, 45.7342532, 4.7746061, { ...car, capacity: "2", "socket:type2_combo": "2" }),
			el(16, 45.7342457, 4.774591, { ...car, capacity: "2", "socket:type2_combo": "2" }),
			el(17, 45.7342147, 4.7745696, {
				amenity: "charging_station",
				capacity: "8",
				description: "Casiers avec pose de cadenas possible",
				operator: "Carrefour Energies",
				"socket:schuko": "8",
			}),
			el(18, 45.7342305, 4.7745728, {
				amenity: "charging_station",
				bicycle: "yes",
				capacity: "4",
				operator: "Carrefour Energies",
				"socket:schuko": "4",
			}),
			el(19, 45.7342277, 4.7745941, {
				amenity: "charging_station",
				capacity: "6",
				operator: "Carrefour Energies",
				scooter: "yes",
			}),
		];
		const twoWheels = [17, 18, 19];

		it("counts a connector the record lists and an object listing others lacks against it", () => {
			const locker = site[4];
			expect(stationFit(francheville, locker)).toMatchObject({ agree: 1, against: 1 });
			expect(stationFit(francheville, site[0])).toMatchObject({ agree: 0, against: 3 });
		});

		it("never takes a two-wheeler charger for a car station, nor for a part of its site", () => {
			const m = findMatch(francheville, site, new Map());
			expect(m).not.toBeNull();
			expect(twoWheels).not.toContain(m?.id);
			const parts = splitParts(francheville, site[0], site).map((k) => k.e.id);
			expect(parts.some((id) => twoWheels.includes(id))).toBe(false);
			const bikes = {
				...francheville,
				name: "Carrefour Energies - Francheville vélos",
				tags: [
					tag("amenity", "charging_station"),
					tag("operator", "Carrefour Energies"),
					tag("capacity", "4"),
					tag("motorcycle", "yes"),
				],
				refs: {},
				lat: 45.7342305,
				lon: 4.7745728,
			};
			expect(findMatch(bikes, site, new Map())?.id).toBe(18);
		});
	});

	it("makes way for the record whose id the object carries", () => {
		const obj = el(1, 45.7, 4.8, { amenity: "charging_station", "ref:EU:EVSE": "FR*TLS*P1" });
		const idx = indexRefs([obj], ["ref:EU:EVSE"]);
		const own = {
			x: { lat: 45.7, lon: 4.8, name: "", refs: { "ref:EU:EVSE": "FRTLSP1" } },
			el: obj,
		};
		const near = { x: { lat: 45.7, lon: 4.8, name: "", refs: {} }, el: obj };
		expect(yieldToIds([own, near], idx, new Set()).map((m) => m.el?.id ?? null)).toEqual([1, null]);
	});
});

describe("duplicates of a new record", () => {
	const x = {
		kind: "FR:school",
		lat: 45.7,
		lon: 4.8,
		name: "École maternelle privée Les Petites Familles 2",
		tags: [tag("amenity", "school"), tag("school:FR", "maternelle"), tag("ref:FR:SIRET", "1")],
		refs: { "ref:UAI": "0694649D" },
	};

	it("sees a maternelle mapped as a kindergarten of its name", () => {
		const kg = el(1, 45.7001, 4.8, { amenity: "kindergarten", name: "Les petites familles" });
		const creche = el(2, 45.7001, 4.8, { amenity: "kindergarten", name: "Les Lutins" });
		expect(matchWarnings(x, null, [kg])).toEqual([
			"Possible duplicate: amenity=kindergarten already mapped at node/1 “Les petites familles”, 11 m away",
		]);
		expect(matchWarnings(x, null, [creche])).toEqual([]);
	});

	it("reads what another record says of the object it matched as the object's own", () => {
		const ime = el(3, 45.7005, 4.8, {
			amenity: "social_facility",
			"contact:email": "ce.0310001A@ac-toulouse.fr",
		});
		const by = new Map([
			["node/3", [{ key: "0310001A", name: "IME", tags: [tag("ref:FR:SIRET", "1")], refs: {} }]],
		]);
		expect(matchWarnings(x, null, [ime], new Map(), new Set(), by)).toContainEqual(
			expect.stringMatching(/^Another establishment with the same SIRET is mapped at node\/3/),
		);
	});
});

describe("duplicates of a new station", () => {
	it("names an object without another station's id first, and says when the one it names has one", () => {
		// Brasserie Stade Toulousain (SOLVEO, DKMONE4198725).
		const x = {
			kind: "FR:charging_station",
			lat: 43.621588,
			lon: 1.413705,
			name: "Brasserie Stade Toulousain",
			tags: [tag("amenity", "charging_station"), tag("operator", "SOLVEO ENERGIES")],
			refs: { "ref:EU:EVSE": "DKMONE4198725" },
		};
		const alize = el(11434652994, 43.621479, 1.4136063, {
			amenity: "charging_station",
			capacity: "4",
			operator: "Bouygues Énergies et Services",
			"ref:EU:EVSE": "FR*TLS*P31555053",
		});
		const bare = el(11434652993, 43.6214625, 1.4138249, {
			access: "private",
			amenity: "charging_station",
			capacity: "6",
		});
		expect(matchWarnings(x, null, [alize, bare])).toEqual([
			"Possible duplicate: amenity=charging_station already mapped at node/11434652993, 17 m away",
		]);
		expect(matchWarnings(x, null, [alize])).toEqual([
			"Possible duplicate: amenity=charging_station already mapped at node/11434652994, 14 m away (carries ref:EU:EVSE=FR*TLS*P31555053, another station's)",
		]);
	});

	it("says how many more objects of its kind stand within 25 m of the one it names", () => {
		// Lidl TOULOUSE Labège (FRLDLPLFR1522EVCP): three nodes of the site, 2, 6 and 15 m off.
		const x = {
			kind: "FR:charging_station",
			lat: 43.559239,
			lon: 1.503482,
			name: "LFR1522EVCP03",
			tags: [tag("amenity", "charging_station"), tag("operator", "Lidl France")],
			refs: {},
		};
		const lidl = (id: number, lat: number, lon: number) =>
			el(id, lat, lon, { amenity: "charging_station", capacity: "2", operator: "Lidl" });
		const site = [
			lidl(11065956027, 43.5592535, 1.5035023),
			lidl(11065956028, 43.5592863, 1.5034615),
			lidl(11065956029, 43.5593519, 1.5033853),
		];
		expect(matchWarnings(x, null, site)).toEqual([
			"Possible duplicate: amenity=charging_station already mapped at node/11065956027, 2 m away, and 2 more objects of its kind within 25 m of it",
		]);
	});
});

describe("twins of one operator", () => {
	const rec = (key: string, lat: number, operator: string): Extraction => ({
		key,
		url: "",
		name: key,
		addr: "",
		lat,
		lon: 4.8,
		refs: {},
		tags: [tag("operator", operator)],
	});

	it("pairs one operator's new stations farther apart than unrelated ones", () => {
		const twins = twinWarnings([
			rec("a", 45.7, "Allego"),
			rec("b", 45.7004, "Allego"),
			rec("c", 45.7008, "Izivia"),
		]);
		expect(twins.get("a")).toEqual([
			"Another new candidate, “b” (b), lies 44 m away: the two may be one place",
		]);
		expect(twins.has("c")).toBe(false);
	});

	it("pairs records of one name, address and operator however far apart", () => {
		const at = (key: string, lat: number) => ({
			...rec(key, lat, "Edenauto"),
			name: "Edenauto Espace Toy Toulouse",
			addr: "159 Route de Labège, 31400 Toulouse",
		});
		expect(twinWarnings([at("a", 43.5746), at("b", 43.5691)]).get("a")).toEqual([
			"Another new candidate, “Edenauto Espace Toy Toulouse” (b), has the same name, address and operator: the two may be one place",
		]);
	});
});

describe("records sharing an object", () => {
	it("compares each value under the key the object keeps it, and leaves out a move or an address whole", () => {
		const current = { "contact:phone": "+33478765676", "contact:housenumber": "62" };
		const ops = updateOps(
			[
				tag("phone", "+33 4 78 76 00 00"),
				{ ...tag("addr:housenumber", "62"), group: "addr" },
				{ ...tag("addr:street", "Rue X"), group: "addr" },
			],
			current,
		);
		const other = {
			tags: [tag("phone", "04 78 76 56 76"), { ...tag("addr:street", "Rue Y"), group: "addr" }],
		};
		expect(
			disputedOps(ops, [other], current)
				.map((o) => `${o.op} ${o.k}`)
				.sort(),
		).toEqual([
			"add addr:housenumber",
			"add addr:street",
			"del contact:housenumber",
			"mod contact:phone",
		]);
	});

	it("dates no object another establishment's UAI is on", () => {
		const x = {
			lat: 45.7,
			lon: 4.8,
			name: "SEGPA",
			tags: [tag("start_date", "1991-08-25")],
			refs: { "ref:UAI": "0693486P" },
		};
		const group = el(1, 45.7, 4.8, { amenity: "school", "ref:UAI": "0690626F;0693486P" });
		expect(planUpdate(x, group, [group]).ops).toEqual([]);
		const own = el(2, 45.7, 4.8, { amenity: "school", "ref:UAI": "0693486P" });
		expect(planUpdate(x, own, [own]).ops).toHaveLength(1);
	});
});

const way = (id: number, lat: number, lon: number, tags: Record<string, string>): OsmElement => ({
	...el(id, lat, lon, tags),
	type: "way",
});

describe("schools of the fifth audit", () => {
	const school = (
		key: string,
		lat: number,
		lon: number,
		name: string,
		tags: ProposedTag[] = [],
		refs: Record<string, string> = {},
	) => ({
		kind: "FR:school",
		key,
		lat,
		lon,
		name,
		tags: [tag("amenity", "school"), tag("ref:UAI", key), ...tags],
		refs: { "ref:UAI": key, ...refs },
	});

	it("leaves out an académie mailbox on an object other records share, as it does the UAI", () => {
		const elementaire = school(
			"0693595H",
			45.73584384498814,
			4.877736697534625,
			"École élémentaire privée La Fourmi",
			[
				tag("ref:FR:SIRET", "39853414900016"),
				tag("email", "ce.0693595h@ac-lyon.fr"),
				tag("operator:type", "private"),
			],
		);
		const secondaire = school("0694738A", 45.7358, 4.8777, "École secondaire privée La Fourmi", [
			tag("ref:FR:SIRET", "39853414900016"),
			tag("operator:type", "private"),
		]);
		const fourmi = el(10128104663, 45.7359741, 4.8776588, {
			amenity: "school",
			name: "La Fourmi",
			operator: "Association La Fourmi",
			phone: "+33478002753",
			"school:FR": "élémentaire",
		});
		const byIt: MatchedBy = new Map([["node/10128104663", [elementaire, secondaire]]]);
		const plan = planUpdate(elementaire, fourmi, [fourmi], new Map(), new Set(), byIt);
		expect(plan.ops.map((o) => o.k)).toEqual(["ref:FR:SIRET", "operator:type"]);
		expect(plan.notes).toContain(
			"Left out, since another record on this object says otherwise: ref:UAI, email",
		);
	});

	it("changes no campus's level, not even one it already gives", () => {
		const jaures = school(
			"0692980P",
			45.78596927286488,
			4.8326481445030955,
			"École élémentaire d'application Jean Jaurès",
			[tag("school:FR", "élémentaire")],
		);
		const groupe = way(50550987, 45.7862193, 4.8326592, {
			"addr:housenumber": "1",
			amenity: "school",
			name: "Groupe scolaire Jean Jaurès",
			"operator:type": "public",
			"ref:UAI": "0692980P",
			"school:FR": "primaire",
		});
		expect(planUpdate(jaures, groupe, [groupe]).ops).toEqual([]);
	});

	it("keeps the building carrying the UAI over campus grounds that hold another school", () => {
		const college = school(
			"0690541N",
			45.71394688779167,
			4.801924593049579,
			"Collège Notre-Dame du Bon Conseil",
			[tag("school:FR", "collège")],
		);
		const grounds = way(172887509, 45.7136567, 4.8011051, {
			amenity: "school",
			landuse: "education",
			name: "École et collège privés Notre-Dame du Bon Conseil",
			"operator:type": "private",
		});
		const building = way(77882228, 45.7136455, 4.801044, {
			building: "school",
			name: "Collège privé Notre-Dame du Bon Conseil",
			"ref:UAI": "0690541N",
			"school:FR": "collège",
		});
		const ecole = el(13745144141, 45.7133648, 4.8015771, {
			amenity: "school",
			name: "École primaire privée Notre-Dame du Bon Conseil",
			"ref:UAI": "0692078J",
			"school:FR": "primaire",
		});
		const all = [grounds, building, ecole];
		expect(findMatch(college, all, indexRefs(all, ["ref:UAI"]))?.id).toBe(77882228);
		const alone = [grounds, building];
		expect(findMatch(college, alone, indexRefs(alone, ["ref:UAI"]))?.id).toBe(172887509);
	});

	it("names a namesake spelt a little otherwise just past the site, never a sister school", () => {
		const immaculee = school(
			"0692130R",
			45.7577256069601,
			4.890675315243371,
			"École primaire privée Immaculée-Conception",
		);
		const node = el(13391567972, 45.7577256, 4.8906753, {
			amenity: "school",
			name: "École primaire privée Immaculée-Conception",
			"ref:UAI": "0692130R",
			"school:FR": "primaire",
		});
		const prive = el(11727675958, 45.7574989, 4.8906427, {
			amenity: "school",
			name: "École primaire privé Immaculée Conception",
			"operator:type": "private",
		});
		expect(matchWarnings(immaculee, node, [node, prive])).toEqual([
			"Possible duplicate of this object: amenity=school is also mapped at node/11727675958 “École primaire privé Immaculée Conception”, 25 m away",
		]);
		const lasalle = school(
			"0690671E",
			45.77167247354931,
			4.830230362921922,
			"Lycée Aux Lazaristes - La Salle site Croix-Rousse",
		);
		const neyret = way(926303377, 45.7718058, 4.828743, {
			amenity: "school",
			name: "Lycée privé Jean-Baptiste de La Salle",
			"ref:UAI": "0690671E",
		});
		const baptiste = way(85639099, 45.7718058, 4.8284091, {
			amenity: "school",
			building: "school",
			name: "Lycée privé Baptiste de La Salle",
		});
		expect(matchWarnings(lasalle, neyret, [neyret, baptiste])).toContain(
			"Possible duplicate of this object: amenity=school is also mapped at way/85639099 “Lycée privé Baptiste de La Salle”, 26 m away",
		);
		const sister = {
			...prive,
			tags: { amenity: "school", name: "École maternelle privée Immaculée Conception" },
		};
		expect(matchWarnings(immaculee, node, [node, sister])).toEqual([]);
	});

	it("names a groupe scolaire at the record's own address as a possible duplicate", () => {
		const anthonioz = school(
			"0312921G",
			43.600507097619634,
			1.4061176505136046,
			"École primaire publique Geneviève de Gaulle Anthonioz",
			[
				tag("school:FR", "primaire"),
				tag("addr:housenumber", "7"),
				tag("addr:street", "Rue Marie de Gournay"),
			],
		);
		const node = el(14211912401, 43.6010745, 1.4061731, {
			amenity: "school",
			"contact:email": "ce.0312921G@ac-toulouse.fr",
			name: "École primaire publique Geneviève De Gaulle Anthonioz",
			"school:FR": "primaire",
		});
		const groupe = way(970882424, 43.6009052, 1.4058581, {
			"addr:city": "Toulouse",
			"addr:housenumber": "7",
			"addr:street": "Rue Marie de Gournay",
			amenity: "school",
			name: "Groupe scolaire Geneviève de Gaulle-Anthonioz",
			"school:FR": "primaire",
		});
		expect(matchWarnings(anthonioz, node, [node, groupe])).toEqual([
			"Possible duplicate of this object: amenity=school is also mapped at way/970882424 “Groupe scolaire Geneviève de Gaulle-Anthonioz”, 32 m away",
		]);
	});

	it("names an object carrying the id an update adds that is no longer the place", () => {
		const bellecour = school(
			"0693401X",
			45.755501306299095,
			4.832248988580168,
			"École technologique privée Arts Appliqués Bellecour",
		);
		const college = el(7538342444, 45.7553422, 4.8322696, {
			amenity: "college",
			name: "Bellecour École",
		});
		const disused = el(2635330079, 45.7588385, 4.8312753, {
			"disused:amenity": "school",
			"ref:UAI": "0693401X",
		});
		const all = [college, disused];
		expect(matchWarnings(bellecour, college, all, indexRefs(all, ["ref:UAI"]))).toContain(
			"node/2635330079, 379 m away carries this record's id, but it is mapped as disused:amenity=school: check where the place is now",
		);
	});

	it("leaves no opening date on a match far from where the record is, so it is counted", () => {
		const isitech = {
			...school(
				"0694215G",
				45.735335038494476,
				4.839704721611926,
				"École tech sup privée Isitech Partner Formation Partner Sup'",
				[{ ...tag("start_date", "2014-05-27"), addOnly: true }],
			),
			tags: [
				tag("amenity", "college"),
				tag("ref:UAI", "0694215G"),
				{ ...tag("start_date", "2014-05-27"), addOnly: true },
			],
		};
		const node = el(9386319476, 45.7281147, 4.8231537, {
			amenity: "college",
			name: "Isitech",
			"ref:UAI": "0694215G",
		});
		const plan = planUpdate(isitech, node, [node]);
		expect(plan.ops).toEqual([]);
		expect(plan.far).toBeGreaterThan(1500);
	});

	it("reads a street's day spelt out or in digits as the same street", () => {
		expect(sameValue("addr:street", "Rue du Onze Novembre 1918", "Rue du 11 Novembre 1918")).toBe(
			true,
		);
		expect(sameValue("addr:street", "Rue du Dix-Sept Juin", "Rue du 17 Juin")).toBe(true);
		expect(sameValue("addr:street", "Rue du 11 Novembre 1918", "Rue du 8 Mai 1945")).toBe(false);
		const address = [
			tag("addr:housenumber", "11"),
			tag("addr:street", "Rue du Onze Novembre 1918"),
			tag("addr:postcode", "31300"),
			tag("addr:city", "Toulouse"),
		].map((t) => ({ ...t, group: "addr" }));
		const vidal = { amenity: "university", "addr:street": "Rue du 11 Novembre 1918" };
		expect(updateOps(address, vidal).map((o) => o.k)).toEqual([
			"addr:housenumber",
			"addr:postcode",
			"addr:city",
		]);
	});

	it("matches nothing being built by name or distance, and names it", () => {
		const pompidou = school(
			"0693474B",
			45.75984486472076,
			4.86749302368711,
			"École élémentaire Pompidou",
			[tag("school:FR", "élémentaire")],
		);
		const site = way(440129348, 45.7596511, 4.8674324, {
			landuse: "construction",
			name: "École élémentaire Pompidou",
			opening_date: "2027-09-01",
			"ref:UAI": "0693474B",
			"school:FR": "élémentaire",
		});
		const idx = indexRefs([site], ["ref:UAI"]);
		const now = Date.UTC(2026, 9, 5);
		expect(findMatch(pompidou, [site], idx, new Set(), now)).toBeNull();
		expect(matchWarnings(pompidou, null, [site], idx).join("\n")).toMatch(
			/way\/440129348 “École élémentaire Pompidou”, 22 m away carries this record's id, but it is under construction \(opening_date=2027-09-01\)/,
		);
	});

	it("says another object far off carries the UAI rather than counting it into the site", () => {
		const anatole = school(
			"0691056Y",
			45.75274472015958,
			4.888241620724171,
			"École maternelle Anatole France",
		);
		const here = el(2865851197, 45.7527898, 4.8883687, {
			amenity: "school",
			name: "École maternelle Anatole France",
			"ref:UAI": "0691056Y",
		});
		const far = el(1422083143, 45.7682779, 4.8821887, {
			amenity: "school",
			name: "École maternelle Anatole France",
			"ref:UAI": "0691056Y",
		});
		const all = [here, far];
		expect(matchWarnings(anatole, here, all, indexRefs(all, ["ref:UAI"]))).toEqual([
			"Another object carrying this UAI is node/1422083143 “École maternelle Anatole France”, 1788 m away",
		]);
	});

	it("sees an unnamed school building beside an institute as a possible duplicate", () => {
		const ditep = {
			kind: "FR:school",
			lat: 45.7303986425007,
			lon: 4.832871750576011,
			name: "DITEP Gerland",
			tags: [tag("amenity", "social_facility"), tag("ref:UAI", "0692636R")],
			refs: { "ref:UAI": "0692636R" },
		};
		const building = way(44637225, 45.7304472, 4.832622, { building: "school" });
		expect(matchWarnings(ditep, null, [building])).toEqual([
			"Possible duplicate: building=school already mapped at way/44637225, 20 m away",
		]);
	});

	it("names what stands at the source's point when the match lies far from it", () => {
		const luizet = school(
			"0693676W",
			45.77648482113171,
			4.887378361222313,
			"École élémentaire Croix Luizet",
		);
		const old = el(1847438224, 45.7785759, 4.8852293, {
			amenity: "school",
			name: "École primaire Croix-Luizet",
			"ref:UAI": "0693676W",
		});
		const transitoire = way(1232435076, 45.7767157, 4.88741, {
			amenity: "school",
			building: "school",
			name: "École élémentaire transitoire Croix Luizet",
		});
		const all = [old, transitoire];
		expect(matchWarnings(luizet, old, all, indexRefs(all, ["ref:UAI"]))).toContain(
			"Matched to node/1847438224 “École primaire Croix-Luizet”, 286 m away from the source's point; way/1232435076 “École élémentaire transitoire Croix Luizet” stands 26 m from the source's point: check it is this place",
		);
	});

	it("names a school beside a new record whose UAI the directory no longer lists", () => {
		const pasteur = school(
			"0691164R",
			45.727692295756434,
			4.883773380549234,
			"École maternelle Louis Pasteur",
		);
		const olympe = el(2625598241, 45.7278137, 4.8837744, {
			amenity: "school",
			name: "École maternelle Olympe de Gouges",
			"ref:UAI": "0691782M",
		});
		const listed = new Set(["0691164R"]);
		const lines = (x: Placed, els: OsmElement[], keys: Set<string>) =>
			matchWarnings(x, null, els, new Map(), new Set(), new Map(), keys);
		expect(lines(pasteur, [olympe], listed)).toContain(
			"node/2625598241 “École maternelle Olympe de Gouges” 13 m away carries UAI 0691782M, which the directory no longer lists",
		);
		expect(lines(pasteur, [olympe], new Set([...listed, "0691782M"]))).toEqual([]);
		const junior = school(
			"0692883J",
			45.73406424527903,
			4.877125736695358,
			"École primaire privée bilingue Junior School",
		);
		const international = el(2003488786, 45.7340495, 4.8772571, {
			amenity: "school",
			name: "École primaire privée Junior School International",
			"ref:UAI": "0693360C",
		});
		const maternelle = el(2849212411, 45.734142, 4.8769844, {
			amenity: "school",
			name: "École maternelle privée bilingue Junior School",
			"ref:UAI": "0693606V",
		});
		expect(
			lines(junior, [international, maternelle], new Set(["0692883J"])).filter((l) =>
				l.includes("no longer lists"),
			),
		).toEqual([
			"node/2003488786 “École primaire privée Junior School International” 10 m away carries UAI 0693360C, which the directory no longer lists",
			"node/2849212411 “École maternelle privée bilingue Junior School” 14 m away carries UAI 0693606V, which the directory no longer lists",
		]);
		const plaine = school(
			"0690332L",
			45.74237946862848,
			4.782119509979755,
			"École primaire La Plaine",
		);
		const far = way(470098874, 45.742958, 4.7849025, {
			amenity: "school",
			name: "École primaire publique la Plaine",
			"ref:UAI": "0690333M",
		});
		expect(lines(plaine, [far], new Set(["0690332L"]))).toEqual([]);
	});

	it("leaves a lycée a school when a post-bac section housed in it is matched to it", () => {
		const saliege = {
			kind: "FR:school",
			lat: 43.60412513198991,
			lon: 1.4951799762460685,
			name: "Campus Saliège",
			tags: [
				tag("amenity", "college"),
				tag("ref:UAI", "0312408Z"),
				{ ...tag("addr:street", "Rue Georges Bernanos"), addOnly: true, group: "addr" },
			],
			refs: { "ref:UAI": "0312408Z" },
		};
		const lycee = way(221477354, 43.6032362, 1.4957088, {
			"addr:city": "Balma",
			"addr:housenumber": "3",
			"addr:postcode": "31130",
			amenity: "school",
			name: "Lycée Privé Saliège",
			"ref:UAI": "0312408Z",
			"school:FR": "lycée",
		});
		const plan = planUpdate(saliege, lycee, [lycee]);
		expect(plan.ops.map((o) => `${o.op} ${o.k}`)).toEqual(["add addr:street"]);
		expect(plan.notes).toEqual([
			"A post-bac section, “Campus Saliège”, is housed in this lycée (school:FR=lycée): its amenity is left alone, so the object stays a school",
		]);
		const billieres = {
			...saliege,
			name: "École supérieure Billières - Lycée technologique privé",
			tags: [tag("amenity", "college"), tag("ref:UAI", "0311186W")],
			refs: { "ref:UAI": "0311186W" },
		};
		const named = el(13633987466, 43.6144608, 1.4427985, {
			amenity: "school",
			name: "École supérieure Billières - Lycée technologique privé",
			"ref:UAI": "0311186W",
			"school:FR": "lycée",
		});
		const kept = planUpdate(billieres, named, [named]);
		expect(kept.ops).toEqual([]);
		expect(kept.notes.join("\n")).toMatch(/is housed in this lycée \(school:FR=lycée\)/);
		const plain = planUpdate(
			billieres,
			{ ...named, tags: { amenity: "school", name: "Billières" } },
			[named],
		);
		expect(plain.ops.map((o) => `${o.op} ${o.k}`)).toContain("mod amenity");
	});
});

describe("a commissioning date and the object's own history", () => {
	const dated = (since: string, own = false) => ({
		lat: 45.7,
		lon: 4.8,
		name: "",
		tags: [{ ...tag("start_date", since), mappedWithin: own ? undefined : 90 }],
		refs: {},
	});
	const station = (version: number, timestamp: string) => ({
		...el(1, 45.7, 4.8, { amenity: "charging_station" }),
		version,
		timestamp,
	});
	const dates = (since: string, e: OsmElement) =>
		planUpdate(dated(since), e, [e]).ops.map((o) => o.v);

	it("takes an operator's date for a re-commissioning where the object was mapped long before it", () => {
		// cf7c327bb58: node/9405205339, first mapped 2022-01-09, commissioned 2023-12-18.
		expect(dates("2023-12-18", station(1, "2022-01-09T10:12:00Z"))).toEqual([]);
		// c4e33ef15fb: Basso Cambo, mapped 56 days before it opened.
		expect(dates("2023-05-30", station(1, "2023-04-04T09:00:00Z"))).toEqual(["2023-05-30"]);
		expect(dates("2021-11-30", station(1, "2022-01-09T10:12:00Z"))).toEqual(["2021-11-30"]);
		// c5301f472db: node/12029214826, at version 4: its first day is the OSM API's to give.
		const edited = station(4, "2026-04-19T08:00:00Z");
		expect(dates("2026-03-11", edited)).toEqual([]);
		expect(dates("2026-03-11", { ...edited, firstMapped: "2024-07-02T07:30:00Z" })).toEqual([]);
		expect(dates("2024-08-01", { ...edited, firstMapped: "2024-07-02T07:30:00Z" })).toEqual([
			"2024-08-01",
		]);
	});

	it("leaves a date that is the place's own alone, whenever the object was mapped", () => {
		const school = planUpdate(dated("2005-09-01", true), station(8, "2024-08-22T10:00:00Z"), []);
		expect(school.ops.map((o) => o.v)).toEqual(["2005-09-01"]);
	});
});

describe("one object, several establishments", () => {
	const x = {
		kind: "FR:school",
		lat: 45.7,
		lon: 4.8,
		name: "École privée multilingue Ombrosa",
		tags: [tag("start_date", "1981-09-01")],
		refs: {},
	};

	it("dates no campus mapped as one object", () => {
		const named = el(1, 45.7, 4.8, { amenity: "school", name: "Ombrosa (École, Collège, Lycée)" });
		const cite = el(2, 45.7, 4.8, { amenity: "school", name: "Cité scolaire Ampère" });
		const levels = el(3, 45.7, 4.8, { amenity: "school", "school:FR": "primaire;secondaire" });
		for (const e of [named, cite, levels]) expect(planUpdate(x, e, [e]).ops).toEqual([]);
		const one = el(4, 45.7, 4.8, { amenity: "school", name: "École maternelle Ombrosa" });
		expect(planUpdate(x, one, [one]).ops).toHaveLength(1);
	});

	it("gives no campus a single level", () => {
		const collège = { ...x, tags: [...x.tags, tag("school:FR", "collège")] };
		const grounds = el(5, 45.7, 4.8, {
			amenity: "school",
			name: "École et collège privés Notre-Dame du Bon Conseil",
		});
		expect(planUpdate(collège, grounds, [grounds]).ops.map((o) => o.k)).not.toContain("school:FR");
	});

	it("takes a site's root and a page of it from two records for two values", () => {
		const ops = updateOps([tag("website", "https://www.la-favorite.org/college/")], {});
		const root = { tags: [tag("website", "https://la-favorite.org")] };
		expect(disputedOps(ops, [root], {})).toHaveLength(1);
		const same = { tags: [tag("website", "http://www.la-favorite.org/college")] };
		expect(disputedOps(ops, [same], {})).toEqual([]);
	});
});

describe("a duplicate of the matched object", () => {
	const x = {
		kind: "FR:school",
		lat: 43.5505,
		lon: 1.4868,
		name: "École technique privée ISPRA Institut",
		tags: [tag("amenity", "college")],
		refs: {},
	};
	const ispra = el(1, 43.5505, 1.4868, { amenity: "university", name: "ISPRA" });

	it("is named when it carries the matched object's name, a little off it", () => {
		const twin = el(2, 43.5511, 1.4868, { amenity: "college", name: "ISPRA" });
		expect(matchWarnings(x, ispra, [ispra, twin])).toEqual([
			"Possible duplicate of this object: amenity=college is also mapped at node/2 “ISPRA”, 67 m away",
		]);
		const group = el(3, 43.5511, 1.4868, { amenity: "school", name: "Groupe scolaire ISPRA" });
		const lycee = { key: "L", name: "Lycée privé ISPRA", tags: [], refs: {} };
		const byIt: MatchedBy = new Map([["node/9", [lycee]]]);
		expect(matchWarnings(x, ispra, [ispra, group], new Map(), new Set(), byIt)).toEqual([]);
	});
});

describe("stations told apart by what they hold", () => {
	const station = (key: string, capacity: string, operator = "Bouygues Energies & Services") => ({
		kind: "FR:charging_station",
		key,
		lat: 43.604,
		lon: 1.4503,
		name: key,
		tags: [
			tag("amenity", "charging_station"),
			tag("operator", operator),
			tag("capacity", capacity),
		],
		refs: {},
	});

	it("reads a mapper's output in watts or with a decimal comma in its own unit", () => {
		const fitting = (had: string) =>
			stationFit(
				{ tags: [tag("socket:type2:output", "7 kW")] },
				el(1, 0, 0, { "socket:type2:output": had }),
			);
		for (const had of ["7400 W", "7400W", "7,4 kW", "7.4kW", "7 kVA", "7"])
			expect(fitting(had)).toMatchObject({ agree: 1, against: 0 });
		expect(fitting("22000W")).toMatchObject({ agree: 0, against: 1 });
	});

	it("leaves an object to the record it fits, and makes the other new", () => {
		const node = el(1, 43.604, 1.4503, { amenity: "charging_station", capacity: "2" });
		const out = yieldToFit(
			[
				{ x: station("two-wheels", "3"), el: node },
				{ x: station("cars", "2"), el: node },
			],
			new Map(),
			new Set(),
		);
		expect(out.map((m) => m.el?.id ?? null)).toEqual([null, 1]);
		expect((out[0].x as { notes?: string[] }).notes).toEqual([
			"node/1 fits “cars” (cars) better, which keeps it",
		]);
	});

	it("does not take a fast DC unit for an AC station on the operator's word, and names the bays instead", () => {
		const ac = {
			...station("IKEA 2", "24", "IZIVIA"),
			tags: [
				tag("amenity", "charging_station"),
				tag("operator", "IZIVIA"),
				tag("capacity", "24"),
				tag("socket:type2", "24"),
			],
		};
		const dc = el(1, 43.6043, 1.4503, {
			amenity: "charging_station",
			network: "Izivia Grand Lyon",
			"socket:type2_combo": "2",
		});
		const bays = el(2, 43.6051, 1.4503, {
			amenity: "charging_station",
			capacity: "24",
			"socket:type2": "24",
		});
		expect(findMatch(ac, [dc, bays], new Map())).toBeNull();
		expect(matchWarnings(ac, null, [dc, bays])).toEqual([
			"Possible duplicate: amenity=charging_station already mapped at node/2, 122 m away",
		]);
	});

	it("matches the network's station a few metres off under a lost name or a renumbered pool id", () => {
		const x = {
			kind: "FR:charging_station",
			lat: 43.637548,
			lon: 1.375103,
			name: "Electra Blagnac - BYD & Quick",
			// An unsure count proposes no sockets; the points it lists still tell the object.
			tags: [tag("amenity", "charging_station"), tag("operator", "Electra")],
			fit: [{ k: "socket:type2_combo", v: "4" }],
			refs: { "ref:EU:EVSE": "FRELCP12953885;FRELCE7TTK" },
		};
		const at = (id: number, tags: Record<string, string>) =>
			el(id, 43.6377, 1.375103, {
				amenity: "charging_station",
				name: "Electra - Smart Lyon",
				"socket:type2_combo": "4",
				...tags,
			});
		const renamed = at(1, { operator: "Electra" });
		expect(findMatch(x, [renamed], new Map())?.id).toBe(1);
		const renumbered = at(2, { "ref:EU:EVSE": "FR*ELC*PBLAPC" });
		expect(findMatch(x, [renumbered], new Map())?.id).toBe(2);
		expect(matchWarnings(x, renumbered, [renumbered])).toEqual([
			"OSM carries the operator's other id ref:EU:EVSE=FR*ELC*PBLAPC",
		]);
		const another = at(3, { "ref:EU:EVSE": "FR*TLS*P1" });
		expect(findMatch(x, [another], new Map())).toBeNull();
	});
});

describe("plain refs on stations", () => {
	const x = {
		kind: "FR:charging_station",
		key: "FRTLSP31555059",
		lat: 43.61227,
		lon: 1.47655,
		name: "TOULOUSE - 70-74 rue de soupetard",
		tags: [tag("amenity", "charging_station"), tag("capacity", "4"), tag("socket:type2", "4")],
		refs: {
			"ref:EU:EVSE":
				"FRTLSP31555059;FRTLSE315550591;FRTLSE315550592;FRTLSE315550593;FRTLSE315550594",
		},
	};

	it("leave a borne's counts alone when its ref names one of the station's points", () => {
		const borne = el(1, 43.61227, 1.47655, {
			amenity: "charging_station",
			capacity: "2",
			ref: "FR*TLS*E31555*059*3*1",
		});
		const plan = planUpdate(x, borne, [borne]);
		expect(plan.ops).toEqual([]);
		expect(plan.notes[0]).toMatch(
			/ref=FR\*TLS\*E31555\*059\*3\*1 names 1 of the station's 4 points/,
		);
		const whole = { ...borne, tags: { ...borne.tags, capacity: "4" } };
		expect(planUpdate(x, whole, [whole]).ops.map((o) => o.k)).toEqual(["socket:type2"]);
	});

	it("read a list of a borne's point ids as the points it names", () => {
		// TOULOUSE - Avenue de Castres: node/12455535934 lists its two connectors' ids.
		const castres = {
			kind: "FR:charging_station",
			key: "FRTLSP31555007",
			lat: 43.59472,
			lon: 1.48832,
			name: "TOULOUSE - Avenue de Castres",
			tags: [tag("amenity", "charging_station"), tag("capacity", "4")],
			refs: {
				"ref:EU:EVSE":
					"FRTLSP31555007;FRTLSE315550071;FRTLSE315550072;FRTLSE315550073;FRTLSE315550074",
			},
		};
		const borne = el(1, 43.59472, 1.48832, {
			amenity: "charging_station",
			capacity: "2",
			name: "Alizé",
			ref: "FR*TLS*E31555*007*2*2;FR*TLS*E31555*007*2*1",
		});
		expect(planUpdate(castres, borne, [borne]).notes[0]).toMatch(
			/ref=FR\*TLS\*E31555\*007\*2\*2;FR\*TLS\*E31555\*007\*2\*1 names 1 of the station's 4 points/,
		);
	});

	it("tell one station's bornes from another's", () => {
		const y = { ...x, refs: {} };
		const own = (id: number, ref: string, lat: number) =>
			el(id, lat, 1.47655, { amenity: "charging_station", ref });
		const a = own(1, "BRN06A", 43.61227);
		const b = own(2, "BRN06B", 43.61231);
		const c = own(3, "BRN07A", 43.61235);
		expect(splitParts(y, a, [a, b, c]).map((k) => k.e.id)).toEqual([2]);
	});
});

describe("values that already agree", () => {
	it("keeps a mapper's finer operator:type and school level", () => {
		expect(sameValue("operator:type", "private", "private_non_profit")).toBe(true);
		expect(sameValue("operator:type", "public", "government")).toBe(true);
		expect(sameValue("operator:type", "private_non_profit", "private")).toBe(false);
		expect(sameValue("school:FR", "lycée", "lycée professionnel")).toBe(true);
		expect(sameValue("school:FR", "collège", "secondaire")).toBe(true);
		expect(sameValue("school:FR", "lycée", "primaire;secondaire")).toBe(true);
		expect(sameValue("school:FR", "élémentaire", "primaire")).toBe(false);
	});

	it("keeps a mapper's site at its root, its https, its TLD, and over an ENT", () => {
		const root = "https://college-moliere.etab.ac-lyon.fr/";
		expect(sameValue("website", `${root}spip/`, root)).toBe(true);
		expect(sameValue("website", "http://a.fr/x", "https://a.fr/y")).toBe(true);
		expect(
			sameValue("website", "http://www.lyceedecoiffure.com", "https://www.lyceedecoiffure.fr/"),
		).toBe(true);
		expect(sameValue("website", "https://x.ent.auvergnerhonealpes.fr", "https://x.org")).toBe(true);
		expect(sameValue("website", "https://institutmyriam.fr", "https://www.myriam31.com/")).toBe(
			false,
		);
	});

	it("reads hours, housenumbers and ligatures for what they say", () => {
		const everyDay =
			"Mo 00:00-23:59, Tu 00:00-23:59, We 00:00-23:59, Th 00:00-23:59, Fr 00:00-23:59";
		expect(sameValue("opening_hours", "Mo-Fr 00:00-24:00", everyDay)).toBe(true);
		expect(sameValue("opening_hours", "Mo-Fr 08:00-18:00", "Mo-Sa 08:00-18:00")).toBe(false);
		expect(sameValue("addr:housenumber", "62bis", "62 Bis")).toBe(true);
		expect(sameValue("addr:street", "Rue Soeur Bouvier", "Rue Sœur Bouvier")).toBe(true);
	});
});

describe("operations that make no sense", () => {
	it("writes whom an institute takes in only on a social facility, and no default 24/7 over real hours", () => {
		const forDisabled = { ...tag("social_facility:for", "disabled"), addOnly: true };
		const amenity = { ...tag("amenity", "social_facility"), addOnly: true };
		expect(updateOps([amenity, forDisabled], { amenity: "school" })).toEqual([]);
		expect(updateOps([amenity, forDisabled], {}).map((o) => o.k)).toEqual([
			"amenity",
			"social_facility:for",
		]);
		expect(updateOps([tag("opening_hours", "24/7")], { opening_hours: "10:00-20:00" })).toEqual([]);
	});
});

describe("settlePoints", () => {
	const station = (key: string, lat: number, lon: number, operator = "IZIVIA"): Extraction => ({
		key,
		url: "u",
		name: "",
		addr: "700 La Pyrénéenne, 31670 Labège",
		lat,
		lon,
		refs: {},
		tags: [
			{ ...tag("amenity", "charging_station"), group: undefined },
			{ ...tag("operator", operator), group: undefined },
		],
		geocode: { q: "700 La Pyrénéenne, 31670 Labège", farM: 100 },
		atAddress: { lat: 43.549142, lon: 1.506215, label: "700 La Pyreneenne 31670 Labège" },
	});
	const node = (id: number, lat: number, lon: number): OsmElement => ({
		type: "node",
		id,
		version: 1,
		lat,
		lon,
		tags: { amenity: "charging_station" },
	});
	const settle = (xs: Extraction[], els: OsmElement[] = []) =>
		settlePoints(xs, els, new Map(), new Set());

	it("moves a point far from its housenumber there, and says so", () => {
		const [x] = settle([station("a", 43.550283, 1.50233)]);
		expect(x).toMatchObject({
			lat: 43.549142,
			lon: 1.506215,
			from: { lat: 43.550283, lon: 1.50233 },
		});
		expect(x.notes?.[0]).toBe("Moved 338 m to its address, 700 La Pyreneenne 31670 Labège");
	});

	it("keeps a point an object already stands at", () => {
		const [x] = settle([station("a", 43.550283, 1.50233)], [node(1, 43.55031, 1.50235)]);
		expect(x).toMatchObject({ lat: 43.550283, lon: 1.50233 });
		expect(x.from).toBeUndefined();
	});

	it("leaves a point within reach of its address", () => {
		const [x] = settle([station("a", 43.5495, 1.5063)]);
		expect(x.from).toBeUndefined();
	});

	it("moves even a precise point its own commune's housenumber puts kilometres away", () => {
		// SAS agripat (ZEENCO): the registry places it in Lyon, its address is in Cleppé (42110).
		const agripat = (at: { lat: number; lon: number; label: string }, lat = 45.751829) => ({
			...station("FRLMSE10001422461", lat, 4.81745, "ZEENCO"),
			addr: "343,Route des Etangs, 42110 Cleppé",
			geocode: {
				q: "343,Route des Etangs, 42110 Cleppé",
				farM: Number.POSITIVE_INFINITY,
				wrongM: 2000,
			},
			atAddress: at,
		});
		const cleppe = { lat: 45.751852, lon: 4.181735, label: "343 Route des Etangs 42110 Cleppé" };
		const [x] = settle([agripat(cleppe)], [node(1, 45.75183, 4.81746)]);
		expect(x).toMatchObject({ lat: 45.751852, lon: 4.181735 });
		expect(x.notes).toEqual(["Moved 49.3 km to its address, 343 Route des Etangs 42110 Cleppé"]);
		const near = { ...cleppe, lat: 45.751829, lon: 4.8 };
		expect(settle([agripat(near)])[0].from).toBeUndefined();
		const elsewhere = { ...cleppe, label: "343 Route des Etangs 42600 Montbrison" };
		expect(settle([agripat(elsewhere)])[0].from).toBeUndefined();
	});
});

describe("deprecatedWarnings", () => {
	it("flags a deprecated tag the candidate writes, with iD's replacement", () => {
		expect(deprecatedWarnings(newOps([tag("amenity", "ev_charging")]))).toEqual([
			"amenity=ev_charging is deprecated: iD writes amenity=charging_station instead",
		]);
	});

	it("matches a wildcard against the object's tags and carries its value over", () => {
		const station = { amenity: "charging_station" };
		expect(deprecatedWarnings(updateOps([tag("car", "yes")], station), station)).toEqual([
			"amenity=charging_station + car=yes is deprecated: iD writes amenity=charging_station + motorcar=yes instead",
		]);
	});

	it("leaves a deprecated tag the candidate does not write to the mapper", () => {
		expect(deprecatedWarnings(updateOps([tag("name", "X")], { amenity: "ev_charging" }))).toEqual(
			[],
		);
		expect(deprecatedWarnings(newOps([tag("amenity", "charging_station")]))).toEqual([]);
	});
});
