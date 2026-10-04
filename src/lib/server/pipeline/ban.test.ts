// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAddress } from "./ban";
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

const school = (street: string, lat = 43.6, lon = 1.45): Extraction => ({
	key: "k",
	url: "u",
	name: "École",
	addr: "",
	lat,
	lon,
	refs: {},
	tags: [
		tag("addr:housenumber", "17"),
		tag("addr:street", street),
		tag("addr:postcode", "31000"),
		tag("addr:city", "Toulouse"),
	],
});

const answer = (score: number, postcode: string, lon = 1.45, lat = 43.6) =>
	Response.json({
		features: [
			{
				geometry: { coordinates: [lon, lat] },
				properties: {
					label: `17 Avenue ${postcode} Toulouse`,
					postcode,
					score,
					type: "housenumber",
				},
			},
		],
	});

afterEach(() => vi.unstubAllGlobals());

describe("checkAddress", () => {
	it("takes the postcode the address base gives the address", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.98, "31200")),
		);
		const x = await checkAddress(school("Avenue des Etats-Unis"));
		expect(x.tags.find((t) => t.k === "addr:postcode")).toMatchObject({
			v: "31200",
			group: "addr",
		});
		expect(x.notes).toEqual([]);
	});

	it("proposes no postcode without a confident match", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.4, "31500")),
		);
		const x = await checkAddress(school("Rue Inconnue"));
		expect(x.tags.find((t) => t.k === "addr:postcode")).toBeUndefined();
	});

	it("says when the source's point is far from its own address", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.95, "31320", 1.49, 43.52)),
		);
		const x = await checkAddress(school("Route de Narbonne", 43.628, 1.4346));
		expect(x.notes?.[0]).toMatch(/^The source places it 1\d\.\d km from its own address/);
	});

	it("leaves a record with no street alone", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const x = { ...school("x"), tags: [] };
		expect(await checkAddress(x)).toBe(x);
		expect(fetch).not.toHaveBeenCalled();
	});
});
