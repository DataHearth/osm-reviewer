import { describe, expect, it } from "vitest";
import {
	closureOps,
	findMatch,
	indexRefs,
	nearbyLabels,
	newOps,
	sameValue,
	unchangedTags,
	updateOps,
} from "./match";
import type { OsmElement, ProposedTag } from "./types";

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
				{ lat: 45.701, lon: 4.8, name: "Pharmacie du Capitole", refs: {} },
				[els[0]],
				new Map(),
			),
		).toBeNull();
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

	it("keeps context tags the candidate did not touch", () => {
		const out = unchangedTags(
			{ name: "A", phone: "1", "addr:city": "Lyon", wheelchair: "yes" },
			new Set(["phone"]),
		);
		expect(out).toEqual([
			{ k: "name", v: "A" },
			{ k: "addr:city", v: "Lyon" },
		]);
	});
});
