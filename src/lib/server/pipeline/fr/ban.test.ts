import { afterEach, describe, expect, it, vi } from "vitest";
import { updateOps } from "../match/ops";
import { addressGaps } from "../preset";
import type { Extraction, ProposedTag } from "../types";
import { addressBase } from "./ban";

const placeAddress = addressBase.place;

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
	geocode: { q: `20 rue Louis Auguste Blanqui 69600 Oullins ${q}`, farM: 1000 },
});

const answer = (
	score: number,
	{ type = "housenumber", lon = 1.45, lat = 43.6, ...props }: Record<string, string | number> = {},
) =>
	Response.json({
		features: [
			{
				geometry: { coordinates: [lon, lat] },
				properties: {
					label: "20 Rue Louis-Auguste Blanqui 69600 Oullins-Pierre-Bénite",
					name: "20 Rue Louis-Auguste Blanqui",
					street: "Rue Louis-Auguste Blanqui",
					housenumber: "20",
					postcode: "69600",
					city: "Oullins-Pierre-Bénite",
					score,
					type,
					...props,
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

	it("takes the base's housenumber when it is the source's, and drops a merged commune's old name from the street", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				answer(0.97, {
					housenumber: "158bis",
					street: "Rue Ampère (Oullins)",
					oldcity: "Oullins",
				}),
			),
		);
		const x = school("oldcity");
		x.tags[1] = tag("addr:housenumber", "158 BIS");
		x.geocode = { q: "158 bis rue Ampère 69600 Oullins", farM: 1000 };
		expect(values(await placeAddress(x))).toMatchObject({
			"addr:housenumber": "158 bis",
			"addr:street": "Rue Ampère",
		});
	});

	it("proposes no address at all without a confident match", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.45)),
		);
		const x = await placeAddress(school("miss"));
		expect(values(x)).toEqual({ "ref:UAI": "0310001A" });
	});

	it("takes a hit under the score floor on the source's own housenumber of a street holding all its words", async () => {
		// The base's answers to these questions, as asked on 05-10-2026.
		const base: Record<string, [number, string, string, string, number, number]> = {
			"25 rue Rebatel 69003 Lyon": [
				0.6775,
				"25",
				"Rue Docteur Rebatel",
				"69003",
				4.872465,
				45.747544,
			],
			"12 rue Hénon 69004 Lyon": [
				0.563,
				"12",
				"Rue Jacques-Louis Hénon",
				"69004",
				4.831052,
				45.779595,
			],
			"4 impasse Roger Brechan 69003 Lyon": [
				0.6968,
				"4",
				"Passage Roger Bréchan",
				"69003",
				4.866877,
				45.751081,
			],
			"82 rue Hénon Lyon": [0.4994, "82", "Rue Jacques-Louis Hénon", "69004", 4.821889, 45.779662],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				const q = new URL(url).searchParams.get("q") ?? "";
				const [score, housenumber, street, postcode, lon, lat] = base[q];
				return answer(score, {
					housenumber,
					street,
					postcode,
					city: "Lyon",
					name: `${housenumber} ${street}`,
					label: `${housenumber} ${street} ${postcode} Lyon`,
					lon,
					lat,
				});
			}),
		);
		const placed = async (q: string, number: string, street: string) =>
			values(
				await placeAddress({
					...school(""),
					tags: [
						tag("addr:housenumber", number),
						tag("addr:street", street),
						tag("addr:city", "Lyon"),
					],
					geocode: { q, farM: 1000 },
				}),
			);
		expect(await placed("25 rue Rebatel 69003 Lyon", "25", "rue Rebatel")).toEqual({
			"addr:housenumber": "25",
			"addr:street": "Rue Docteur Rebatel",
			"addr:postcode": "69003",
			"addr:city": "Lyon",
		});
		expect(await placed("12 rue Hénon 69004 Lyon", "12", "rue Hénon")).toMatchObject({
			"addr:street": "Rue Jacques-Louis Hénon",
		});
		expect(
			await placed("4 impasse Roger Brechan 69003 Lyon", "4", "impasse Roger Brechan"),
		).toMatchObject({ "addr:street": "Passage Roger Bréchan" });
		expect(await placed("82 rue Hénon Lyon", "82", "rue Hénon")).toEqual({});
	});

	it("takes no hit under the floor from another commune's street named for the one asked", async () => {
		// The base's answer on 05-10-2026 to the line asked again without its postcode.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				answer(0.5396, {
					housenumber: "41",
					street: "rue de Toulouse",
					name: "41 rue de Toulouse",
					label: "41 rue de Toulouse 87000 Limoges",
					postcode: "87000",
					city: "Limoges",
				}),
			),
		);
		const x = await placeAddress({
			...school(""),
			tags: [
				tag("addr:housenumber", "41"),
				tag("addr:street", "rue des 36 ponts"),
				tag("addr:city", "Toulouse"),
			],
			geocode: { q: "41 rue des 36 ponts 31000 Toulouse", farM: 1000 },
		});
		expect(values(x)).toEqual({});
	});

	it("takes the base's street type, but no address from a street of another name", async () => {
		const street = (q: string, theirs: string) => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => answer(0.75, { street: theirs })),
			);
			const x = school(q);
			x.geocode = { q, farM: 1000 };
			return placeAddress(x).then(values);
		};
		expect(await street("4 rue Félix Faure 69007 Lyon", "Avenue Félix Faure")).toMatchObject({
			"addr:street": "Avenue Félix Faure",
		});
		expect(await street("25 rue des 36 ponts 31400 Toulouse", "Rue des Potiers")).toEqual({
			"ref:UAI": "0310001A",
		});
	});

	it("asks again without the postcode when the line with it misses", async () => {
		const fetch = vi.fn(async (u: string) =>
			answer(/\d{5}/.test(decodeURIComponent(u)) ? 0.46 : 0.98),
		);
		vi.stubGlobal("fetch", fetch);
		const x = await placeAddress(school("retry"));
		expect(values(x)["addr:street"]).toBe("Rue Louis-Auguste Blanqui");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("asks the address base once per address", async () => {
		const fetch = vi.fn(async () => answer(0.97));
		vi.stubGlobal("fetch", fetch);
		await placeAddress(school("once"));
		await placeAddress(school("once"));
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("places the housenumber for later, on the source's street only", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) =>
				u.includes("Matabiau")
					? answer(0.76, { street: "Rue Matabiau", label: "5 Rue Matabiau 31000 Toulouse" })
					: u.includes("Tuilliers")
						? answer(0.9, { street: "Rue des Tuiliers", label: "31 Rue des Tuiliers" })
						: u.includes("street")
							? answer(0.95, { type: "street" })
							: answer(0.95, { lon: 1.48942, lat: 43.529141 }),
			),
		);
		const x = await placeAddress(school("far", 43.628, 1.4346));
		expect(x).toMatchObject({ lat: 43.628, lon: 1.4346 });
		expect(x.atAddress).toMatchObject({ lat: 43.529141, lon: 1.48942 });
		const street = await placeAddress(school("street"));
		expect(street.atAddress).toBeUndefined();
		expect(street.onStreet).toBeDefined();
		const at = async (q: string) =>
			(await placeAddress({ ...school(q), geocode: { q, farM: 100 } })).atAddress;
		expect(await at("5 Boulevard de Matabiau 31000 Toulouse")).toBeUndefined();
		expect(await at("31 rue des Tuilliers 69008 Lyon")).toBeDefined();
	});

	it("leaves a record with nothing to ask alone", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const x = { ...school("none"), geocode: undefined };
		expect(await placeAddress(x)).toBe(x);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("agrees with an object whose address differs from the base's only in case, accents and spacing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => answer(0.97)),
		);
		const x = await placeAddress(school("agree"));
		expect(
			updateOps(x.tags, {
				"ref:UAI": "0310001A",
				"addr:housenumber": "20 - 28",
				"addr:street": "rue Louis Auguste Blanqui",
				"addr:postcode": "69600",
				"addr:city": "OULLINS-PIERRE-BENITE",
			}),
		).toEqual([]);
	});
});

describe("addressGaps", () => {
	it("measures each site's address from its point", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) =>
				answer(0.95, u.includes("quai") ? { lat: 43.61, lon: 1.45 } : { lat: 43.6, lon: 1.45 }),
			),
		);
		const near = { adresse: "30 rue Couturier" };
		const far = { adresse: "2 quai Moulin" };
		const gaps = await addressGaps([near, far], {
			siteQuery: (r) => String(r.adresse),
			position: () => [43.6, 1.45],
			address: addressBase,
		});
		expect(gaps.get(near)).toBeLessThan(1);
		expect(gaps.get(far)).toBeGreaterThan(1000);
	});
});
