import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/config", () => ({ nominatim: { url: "http://nom.test" } }));

import { clearBoundaryCache, parseBoundaries, searchBoundaries } from "./nominatim";

const lyon = {
	osm_type: "relation",
	osm_id: 120965,
	category: "boundary",
	type: "administrative",
	name: "Lyon",
	display_name: "Lyon, Métropole de Lyon, France",
	lat: "45.7578",
	lon: "4.8320",
	boundingbox: ["45.7073666", "45.8082628", "4.7718489", "4.8983774"],
	extratags: { admin_level: "8" },
};

describe("parseBoundaries", () => {
	it("keeps administrative relations and reorders the bbox for Overpass", () => {
		const out = parseBoundaries([lyon, { ...lyon, osm_type: "node" }, { ...lyon, type: "city" }]);
		expect(out).toHaveLength(1);
		const [r] = out;
		expect(r.rel).toBe("120965");
		expect(r.level).toBe(8);
		expect(r.bbox).toEqual([45.7073666, 4.7718489, 45.8082628, 4.8983774]);
		expect(r.sqkm).toBeGreaterThan(50);
	});

	it("tolerates garbage", () => {
		expect(parseBoundaries(null)).toEqual([]);
		expect(parseBoundaries([{ osm_type: "relation", osm_id: 1 }])).toEqual([]);
	});
});

describe("searchBoundaries", () => {
	beforeEach(() => clearBoundaryCache());

	it("caches repeated queries", async () => {
		const f = vi.fn(async () => new Response(JSON.stringify([lyon])));
		await searchBoundaries("Lyon", f as unknown as typeof fetch);
		await searchBoundaries(" lyon ", f as unknown as typeof fetch);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it("turns an HTTP failure into an error", async () => {
		const f = vi.fn(async () => new Response("no", { status: 503 }));
		await expect(searchBoundaries("x", f as unknown as typeof fetch)).rejects.toThrow("503");
	});
});
