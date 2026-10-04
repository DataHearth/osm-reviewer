import { describe, expect, it } from "vitest";
import {
	closureOps,
	contextTags,
	disputedOps,
	findMatch,
	indexRefs,
	matchWarnings,
	modWarnings,
	nearbyLabels,
	newOps,
	planUpdate,
	sameValue,
	sharedRefs,
	splitParts,
	twinWarnings,
	unchangedTags,
	updateOps,
	yieldToIds,
} from "./match";
import type { Extraction, OsmElement, ProposedTag } from "./types";

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

	it("proposes no ad-hoc access to a station surveyed as badge-only", () => {
		const none = { ...tag("authentication:none", "yes"), addOnly: true };
		expect(updateOps([none], { "payment:membership_card": "yes" })).toEqual([]);
		expect(updateOps([none], {})).toHaveLength(1);
	});

	it("never replaces a list of ids that already holds the record's", () => {
		expect(updateOps([tag("ref:UAI", "0692864N")], { "ref:UAI": "0692864N;0690053H" })).toEqual([]);
		expect(updateOps([tag("ref:UAI", "0692864N")], { "ref:UAI": "0690053H" })).toHaveLength(1);
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
		expect(matchWarnings(louis, a, [a, b, c], idx)[0]).toMatch(
			/^Same site may be mapped as 2 objects \(also node\/2 “Bâtiment Maternelle”, 78 m away/,
		);
		const shared = sharedRefs([louis, { refs: { "ref:UAI": "0693634A" } }]);
		expect(splitParts(louis, a, [a, b, c], idx, shared)).toEqual([]);
	});

	it("says a school mapped only as its building gets its amenity", () => {
		const school = { ...x, name: "ISC", tags: [tag("amenity", "college")] };
		const isc = el(9, 45.7, 4.8, { building: "university", name: "ISC" });
		expect(matchWarnings(school, isc, [isc])).toEqual([
			"OSM maps this school only as building=university: amenity=college is added to the building",
		]);
	});

	it("sees an unnamed school building, a charge point or a health centre as a possible duplicate", () => {
		const school = { ...x, name: "ADONIS", tags: [tag("amenity", "college")] };
		const bare = el(10, 45.7001, 4.8, { building: "college" });
		expect(matchWarnings(school, null, [bare])).toEqual([
			"Possible duplicate: building=college already mapped at node/10, 11 m away",
		]);
		const point = el(11, 45.7001, 4.8, { man_made: "charge_point" });
		expect(matchWarnings(x, null, [point])[0]).toMatch(
			/^Possible duplicate: man_made=charge_point/,
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

	it("says when a lycée would become a college", () => {
		const ops = [mod("amenity", "school", "college")];
		expect(modWarnings(ops, { amenity: "school", "school:FR": "lycée" }, now)[1]).toMatch(
			/^The object reads as a lycée \(school:FR=lycée\)/,
		);
	});
});

describe("what the object is now", () => {
	const school = {
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

	it("leaves out the address and contacts, and says why", () => {
		const far = el(1, 45.735, 4.8, { amenity: "school", "contact:website": "https://a.fr" });
		expect(planUpdate(x, far, [far]).ops.map((o) => o.k)).toEqual(["ref:FR:SIRET"]);
		expect(matchWarnings(x, far, [far])[0]).toMatch(
			/^Matched to node\/1, 3.9 km from the source's address: .* so its address and contacts are left out$/,
		);
		const near = el(2, 45.703, 4.8, { amenity: "school" });
		expect(planUpdate(x, near, [near]).ops).toHaveLength(3);
	});
});

describe("split sites", () => {
	const toulibeo = {
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
