import { describe, expect, it } from "vitest";
import { buildQuery, parseElements } from "./overpass";

const base = { bbox: null, centerLat: 45.76, centerLon: 4.83, km: null };

describe("buildQuery", () => {
	it("matches a relation area over the box its records are cut by, with a margin", () => {
		const q = buildQuery(
			{ ...base, def: "relation", rel: "120965", radius: null, bbox: [45.7, 4.77, 45.81, 4.9] },
			[{ k: "amenity", v: ["charging_station"] }],
		);
		expect(q).not.toContain("area(id:");
		expect(q).toContain('nwr["amenity"="charging_station"](45.698,4.767,45.812,4.903);');
		expect(q).toContain("out center tags meta;");
	});

	it("falls back to the area id while a relation has no box yet", () => {
		const q = buildQuery({ ...base, def: "relation", rel: "120965", radius: null }, [
			{ k: "amenity", v: ["charging_station"] },
		]);
		expect(q).toContain("area(id:3600120965)->.a;");
		expect(q).toContain('nwr["amenity"="charging_station"](area.a);');
	});

	it("matches a radius area, or a relation with only a size, with the same margin as a box", () => {
		const q = buildQuery({ ...base, def: "radius", rel: null, radius: 1500 }, [
			{ k: "shop", v: null },
		]);
		expect(q).toContain('nwr["shop"](around:1720,45.76,4.83);');

		const sized = buildQuery({ ...base, def: "relation", rel: "120965", radius: null, km: 1 }, [
			{ k: "shop", v: null },
		]);
		expect(sized).not.toContain("area(id:");
		expect(sized).toContain('nwr["shop"](45.749017,4.814124,45.770983,4.845876);');
	});

	it("ANDs required tags onto every alternative", () => {
		const q = buildQuery(
			{ ...base, def: "radius", rel: null, radius: 100 },
			[
				{ k: "amenity", v: ["cafe"] },
				{ k: "shop", v: ["bakery"] },
			],
			[{ k: "website", v: null }],
		);
		expect(q).toContain('nwr["amenity"="cafe"]["website"](around');
		expect(q).toContain('nwr["shop"="bakery"]["website"](around');
	});

	it("uses the bounding box when a relation has no usable id", () => {
		const q = buildQuery(
			{ ...base, def: "relation", rel: null, radius: null, bbox: [1, 2, 3, 4] },
			[{ k: "amenity", v: null }],
		);
		expect(q).toContain('nwr["amenity"](0.998,1.997,3.002,4.003);');
	});
});

describe("parseElements", () => {
	it("reads nodes and the centre of ways, with version and user", () => {
		const els = parseElements({
			elements: [
				{ type: "node", id: 1, lat: 1, lon: 2, version: 4, user: "bob", tags: { a: "b" } },
				{ type: "way", id: 2, center: { lat: 3, lon: 4 }, tags: {} },
				{ type: "node", id: 3 },
			],
		});
		expect(els).toEqual([
			{ type: "node", id: 1, lat: 1, lon: 2, version: 4, user: "bob", tags: { a: "b" } },
			{ type: "way", id: 2, lat: 3, lon: 4, version: 1, user: undefined, tags: {} },
		]);
	});

	it("turns a runtime error remark into a failure", () => {
		expect(() => parseElements({ elements: [], remark: "runtime error: Query timed out" })).toThrow(
			/timed out/,
		);
	});
});
