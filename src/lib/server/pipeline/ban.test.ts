// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeAddress } from "./ban";
import { updateOps } from "./match";
import type { Extraction, ProposedTag } from "./types";

const tag = (k: string, v: string): ProposedTag => ({
	k,
	v,
	conf: 0.8,
	path: "adresse_1",
	parts: [{ text: v, mark: true }],
	kind: "dataset row",
	addOnly: true,
	group: "addr",
});

/** Each test asks its own question: the lookup cache lives as long as the module. */
const school = (q: string, lat = 43.6, lon = 1.45): Extraction => ({
	key: "k",
	url: "u",
	name: "École",
	addr: "",
	lat,
	lon,
	refs: {},
	tags: [
		{ ...tag("ref:UAI", "0310001A"), group: undefined },
		tag("addr:housenumber", "20-28"),
		tag("addr:street", "rue louis auguste blanqui"),
		tag("addr:city", "Oullins"),
	],
	geocode: { q, farM: 1000 },
});

const answer = (score: number, { type = "housenumber", lon = 1.45, lat = 43.6 } = {}) =>
	Response.json({
		features: [
			{
				geometry: { coordinates: [lon, lat] },
				properties: {
					label: "20 Rue Louis-Auguste Blanqui 69600 Oullins-Pierre-Bénite",
					name: "20 Rue Louis-Auguste Blanqui",
					street: "Rue Louis-Auguste Blanqui",
					postcode: "69600",
					city: "Oullins-Pierre-Bénite",
					score,
					type,
				},
			},
		],
	});

const values = (x: Extraction) => Object.fromEntries(x.tags.map((t) => [t.k, t.v]));

afterEach(() => vi.unstubAllGlobals());

describe("placeAddress", () => {
	it("spells the address as the address base does, keeping the source's housenumber", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.97)),
		);
		const x = await placeAddress(school("spell"));
		expect(values(x)).toEqual({
			"ref:UAI": "0310001A",
			"addr:housenumber": "20-28",
			"addr:street": "Rue Louis-Auguste Blanqui",
			"addr:postcode": "69600",
			"addr:city": "Oullins-Pierre-Bénite",
		});
		expect(x.tags.filter((t) => t.group === "addr").every((t) => t.addOnly)).toBe(true);
		expect(x.notes).toBeUndefined();
	});

	it("proposes no address at all without a confident match", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.65)),
		);
		const x = await placeAddress(school("miss"));
		expect(values(x)).toEqual({ "ref:UAI": "0310001A" });
	});

	it("asks the address base once per address", async () => {
		const fetch = vi.fn(async () => answer(0.97));
		vi.stubGlobal("fetch", fetch);
		await placeAddress(school("once"));
		await placeAddress(school("once"));
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("moves a point far from its own housenumber there, and says so", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.95, { lon: 1.48942, lat: 43.529141 })),
		);
		const x = await placeAddress(school("far", 43.628, 1.4346));
		expect(x).toMatchObject({ lat: 43.529141, lon: 1.48942 });
		expect(x.notes?.[0]).toMatch(/^Moved 1\d\.\d km to its address, 20 Rue Louis-Auguste/);
	});

	it("leaves a point within reach of its address, or placed only on its street, where it is", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) =>
				answer(0.95, {
					type: u.includes("street") ? "street" : "housenumber",
					lon: 1.4346,
					lat: u.includes("street") ? 43.5 : 43.625,
				}),
			),
		);
		for (const q of ["near", "street"]) {
			const x = await placeAddress(school(q, 43.628, 1.4346));
			expect(x).toMatchObject({ lat: 43.628, lon: 1.4346 });
		}
	});

	it("leaves a record with nothing to ask alone", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const x = { ...school("none"), geocode: undefined };
		expect(await placeAddress(x)).toBe(x);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("agrees with an object whose address differs from the base's only in case and accents", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.97)),
		);
		const x = await placeAddress(school("agree"));
		expect(
			updateOps(x.tags, {
				"ref:UAI": "0310001A",
				"addr:housenumber": "20-28",
				"addr:street": "rue Louis Auguste Blanqui",
				"addr:postcode": "69600",
				"addr:city": "OULLINS-PIERRE-BENITE",
			}),
		).toEqual([]);
	});
});
