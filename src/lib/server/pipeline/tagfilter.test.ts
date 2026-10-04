import { describe, expect, it } from "vitest";
import {
	allowedBy,
	lookalike,
	lookalikeSelectors,
	mergeSelectors,
	overpassFilter,
	parseMatching,
	sameKind,
	selectorsFromTags,
	selects,
} from "./tagfilter";

describe("allowedBy", () => {
	it("matches exact keys and prefix wildcards, and an empty list restricts nothing", () => {
		expect(allowedBy(["phone", "socket:*"], "phone")).toBe(true);
		expect(allowedBy(["phone", "socket:*"], "socket:type2:output")).toBe(true);
		expect(allowedBy(["phone", "socket:*"], "website")).toBe(false);
		expect(allowedBy(["phone"], "phone:mobile")).toBe(false);
		expect(allowedBy([], "anything")).toBe(true);
	});
});

describe("parseMatching", () => {
	it("reads k=v terms, alternatives and wildcards", () => {
		expect(parseMatching("amenity=school  shop=bakery|butcher, website=*")).toEqual([
			{ k: "amenity", v: ["school"] },
			{ k: "shop", v: ["bakery", "butcher"] },
			{ k: "website", v: null },
		]);
	});

	it("treats legacy free text as no filter", () => {
		expect(parseMatching("SIRET ↔ ref:FR:SIRET, name similarity")).toEqual([]);
		expect(parseMatching("")).toEqual([]);
	});
});

describe("selectors", () => {
	it("builds Overpass filters", () => {
		expect(overpassFilter({ k: "amenity", v: ["school"] })).toBe('["amenity"="school"]');
		expect(overpassFilter({ k: "amenity", v: ["school", "kindergarten"] })).toBe(
			'["amenity"~"^(school|kindergarten)$"]',
		);
		expect(overpassFilter({ k: "website", v: null })).toBe('["website"]');
		expect(
			overpassFilter({ k: "ref:EU:EVSE", v: null, not: { k: "man_made", v: ["charge_point"] } }),
		).toBe('["ref:EU:EVSE"]["man_made"!~"^(charge_point)$"]');
	});

	it("derives main-tag selectors, with the kinds mapped in their place, and merges duplicates", () => {
		const derived = selectorsFromTags([
			{ k: "amenity", v: "school" },
			{ k: "amenity", v: "kindergarten" },
			{ k: "phone", v: "1" },
		]);
		expect(derived).toEqual([
			{ k: "amenity", v: ["school", "college", "university", "kindergarten"] },
			{ k: "building", v: ["school", "college", "university"] },
		]);
		expect(
			mergeSelectors(derived, [
				{ k: "amenity", v: ["kindergarten", "university", "college", "school"] },
			]),
		).toHaveLength(2);
		expect(selectorsFromTags([{ k: "amenity", v: "charging_station" }])).toEqual([
			{ k: "amenity", v: ["charging_station"] },
		]);
	});

	it("tells which fetched objects a selector picked", () => {
		const evse = { k: "ref:EU:EVSE", v: null, not: { k: "man_made", v: ["charge_point"] } };
		expect(selects(evse, { "ref:EU:EVSE": "FR*A*E1" })).toBe(true);
		expect(selects(evse, { "ref:EU:EVSE": "FR*A*E1", man_made: "charge_point" })).toBe(false);
		expect(selects({ k: "amenity", v: ["school"] }, { amenity: "college" })).toBe(false);
	});
});

describe("kinds", () => {
	it("takes an institute's kin only among facilities for whom it takes in", () => {
		const kin = (tags: Record<string, string>) => sameKind("amenity", "social_facility", tags);
		expect(kin({ amenity: "social_facility" })).toBe(true);
		expect(kin({ amenity: "social_facility", "social_facility:for": "disabled;senior" })).toBe(
			true,
		);
		expect(kin({ amenity: "school" })).toBe(true);
		expect(kin({ amenity: "social_facility", "social_facility:for": "senior" })).toBe(false);
		expect(kin({ amenity: "social_facility", "social_facility:for": "homeless" })).toBe(false);
		expect(kin({ amenity: "social_facility", "social_facility:for": "blind" })).toBe(true);
		expect(kin({ amenity: "social_facility", "social_facility:for": "deaf" })).toBe(true);
		expect(kin({ amenity: "social_facility", social_facility: "healthcare" })).toBe(false);
	});

	it("fetches what a place may be mapped as only for the kinds that need it", () => {
		expect(lookalikeSelectors([{ k: "amenity", v: "charging_station" }])).toEqual([
			{ k: "man_made", v: ["charge_point"] },
			{ k: "capacity:charging", v: null },
		]);
		expect(lookalikeSelectors([{ k: "amenity", v: "school" }])).toEqual([
			{ k: "amenity", v: ["kindergarten"] },
		]);
		expect(lookalikeSelectors([{ k: "shop", v: "bakery" }])).toEqual([]);
		expect(
			lookalike("amenity", "charging_station", { amenity: "parking", "capacity:charging": "4" }),
		).toBe(true);
		expect(lookalike("amenity", "social_facility", { healthcare: "centre" })).toBe(true);
		expect(lookalike("amenity", "social_facility", { amenity: "clinic" })).toBe(true);
		expect(lookalike("amenity", "school", { building: "college" })).toBe(true);
		expect(lookalike("amenity", "school", { building: "college", name: "Bâtiment A" })).toBe(false);
		expect(lookalike("amenity", "school", { building: "school", amenity: "library" })).toBe(false);
	});
});
