import { afterEach, describe, expect, it, vi } from "vitest";
import { datasetBase, readApiArea, whereClause } from "./opendata";

const BASE = "https://data.test/api/explore/v2.1/catalog/datasets/schools";
const radius = {
	def: "radius" as const,
	bbox: null,
	centerLat: 45.76,
	centerLon: 4.83,
	km: null,
	radius: 1500,
};
const source = {
	endpoint: `${BASE}/records`,
	apiKey: "secret",
	extractor: "deterministic" as const,
	preset: "annuaire-education",
};

const school = (i: number) => ({
	identifiant_de_l_etablissement: `U${i}`,
	nom_etablissement: `Ecole ${i}`,
	type_etablissement: "Collège",
	latitude: 45.76,
	longitude: 4.83,
});

afterEach(() => vi.unstubAllGlobals());

describe("whereClause / datasetBase", () => {
	it("builds within_distance for a radius and in_bbox for a relation", () => {
		expect(whereClause("position", radius)).toBe(
			"within_distance(position, geom'POINT(4.83 45.76)', 1500m)",
		);
		expect(whereClause("geom", { ...radius, def: "relation", bbox: [1, 2, 3, 4] })).toBe(
			"in_bbox(geom, 1, 2, 3, 4)",
		);
	});

	it("reduces any endpoint spelling to the dataset", () => {
		expect(datasetBase(`${BASE}/records?limit=3`)).toBe(BASE);
		expect(datasetBase(`${BASE}/`)).toBe(BASE);
		expect(datasetBase(`${BASE}/exports/jsonl`)).toBe(BASE);
	});
});

describe("readApiArea", () => {
	it("pages by 100, finds the geo field from the metadata and sends the key", async () => {
		const seen: { url: string; auth: string | null }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string, init: RequestInit) => {
				const headers = init.headers as Record<string, string>;
				seen.push({ url: u, auth: headers.authorization ?? null });
				if (u === BASE)
					return Response.json({
						fields: [
							{ name: "identifiant_de_l_etablissement", type: "text" },
							{ name: "position", type: "geo_point_2d" },
						],
					});
				const offset = Number(new URL(u).searchParams.get("offset"));
				const n = offset === 0 ? 100 : 20;
				return Response.json({
					total_count: 120,
					results: Array.from({ length: n }, (_, i) => school(offset + i)),
				});
			}),
		);
		const res = await readApiArea(source, radius);
		expect(res.fetched).toBe(120);
		expect(res.rows.size).toBe(120);
		expect(res.reader?.preset?.id).toBe("annuaire-education");
		const pages = seen.filter((s) => s.url.includes("/records?"));
		expect(pages).toHaveLength(2);
		expect(decodeURIComponent(pages[0].url)).toContain("within_distance(position,");
		expect(pages.every((p) => p.url.includes("&order_by=identifiant_de_l_etablissement&"))).toBe(
			true,
		);
		expect(pages.every((p) => p.auth === "Apikey secret")).toBe(true);
	});

	it("switches to the jsonl export when the answer is too big to page", async () => {
		const requested: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) => {
				requested.push(u);
				if (u === BASE) return Response.json({ fields: [] });
				if (u.includes("/exports/jsonl"))
					return new Response([school(1), school(2)].map((r) => JSON.stringify(r)).join("\n"));
				const offset = Number(new URL(u).searchParams.get("offset"));
				return Response.json({
					total_count: 20_000,
					results: Array.from({ length: 100 }, (_, i) => school(offset + i + 1000)),
				});
			}),
		);
		const res = await readApiArea(source, radius);
		expect(requested.filter((u) => u.includes("/records?"))).toHaveLength(1);
		expect(requested.some((u) => u.includes("/exports/jsonl?where="))).toBe(true);
		expect([...res.rows.keys()]).toEqual(["U1", "U2"]);
		expect(res.fetched).toBe(2);
	});

	it("keeps the key of a row the mapping skips as listed, though it makes no record", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) => {
				if (u === BASE) return Response.json({ fields: [] });
				return Response.json({
					total_count: 2,
					results: [school(1), { ...school(2), type_etablissement: "Service administratif" }],
				});
			}),
		);
		const res = await readApiArea(source, radius);
		expect([...res.rows.keys()]).toEqual(["U1"]);
		expect([...res.notPlaces]).toEqual(["U2"]);
	});

	it("rejects an endpoint that is not Opendatasoft explore v2.1", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) => (u === BASE ? Response.json({}) : Response.json({ rows: [] }))),
		);
		await expect(readApiArea(source, radius)).rejects.toThrow(/Opendatasoft/);
	});
});
