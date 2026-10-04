import { describe, expect, it } from "vitest";
import { daysSince, fmtCount, fmtDuration, osmUrl, recordBlocks } from "./format";

describe("fmtDuration", () => {
	it("picks the longest unit that keeps the number small", () => {
		expect(fmtDuration(2000)).toBe("2 s");
		expect(fmtDuration(41 * 60_000)).toBe("41 min");
		expect(fmtDuration(65 * 60_000)).toBe("1 h 05 min");
	});
});

describe("fmtCount", () => {
	it("groups thousands and abbreviates millions", () => {
		expect(fmtCount(3742)).toBe("3,742");
		expect(fmtCount(34_200_000)).toBe("34.2M");
	});
});

describe("daysSince", () => {
	it("counts whole days and never goes negative", () => {
		const now = new Date(2026, 9, 3, 12);
		expect(daysSince(new Date(2026, 8, 21, 12), now)).toBe(12);
		expect(daysSince(new Date(2026, 9, 4), now)).toBe(0);
	});
});

describe("osmUrl", () => {
	const base = "https://master.apis.dev.openstreetmap.org";
	it("has no link for a POI OSM does not have yet", () => {
		expect(osmUrl(base, null)).toBeUndefined();
	});
	it("opens nodes, ways and relations on the configured instance", () => {
		expect(osmUrl(base, "node/1")).toBe(`${base}/node/1`);
		expect(osmUrl(base, "way/2")).toBe(`${base}/way/2`);
	});
});

describe("recordBlocks", () => {
	it("prints what every row shares once, then only what differs per row", () => {
		const rows = [
			{ station: "S1", pdc: "P1", kw: 300 },
			{ station: "S1", pdc: "P2", kw: 300 },
		];
		expect(recordBlocks(rows)).toEqual([
			[
				["station", "S1"],
				["kw", 300],
			],
			[["pdc", "P1"]],
			[["pdc", "P2"]],
		]);
	});
	it("leaves a single row whole", () => {
		expect(recordBlocks([{ a: 1, b: null }])).toEqual([
			[
				["a", 1],
				["b", null],
			],
		]);
	});
});
