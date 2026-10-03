import { describe, expect, it } from "vitest";
import {
	allowedBy,
	mergeSelectors,
	overpassFilter,
	parseMatching,
	selectorsFromTags,
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
	});

	it("derives main-tag selectors from what was extracted, and merges duplicates", () => {
		const derived = selectorsFromTags([
			{ k: "amenity", v: "school" },
			{ k: "amenity", v: "kindergarten" },
			{ k: "phone", v: "1" },
		]);
		expect(derived).toEqual([{ k: "amenity", v: ["school", "kindergarten"] }]);
		expect(mergeSelectors(derived, [{ k: "amenity", v: ["kindergarten", "school"] }])).toHaveLength(
			1,
		);
	});
});
