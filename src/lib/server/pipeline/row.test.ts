import { describe, expect, it } from "vitest";
import { openingHours, website } from "./row";

describe("openingHours", () => {
	it("reads every way a registry spells all day", () => {
		expect(openingHours("Mo-Su 00:00-23:57")).toBe("24/7");
		const day = (d: string) => `${d} 00:00-23:59`;
		expect(openingHours(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day).join(", "))).toBe(
			"24/7",
		);
		expect(openingHours(["Mo", "Tu", "We", "Th", "Fr"].map(day).join(", "))).toBe(
			"Mo-Fr 00:00-24:00",
		);
		expect(openingHours("Mo-Fr 08:00-18:00")).toBe("Mo-Fr 08:00-18:00");
	});

	it("keeps a real closing time late in the evening", () => {
		expect(openingHours("Mo-Fr 08:00-23:50")).toBe("Mo-Fr 08:00-23:50");
		expect(openingHours("Mo-Su 06:00-23:58")).toBe("Mo-Su 06:00-24:00");
	});

	it("folds days spelled out one by one into ranges", () => {
		const week = (span: string, days = ["Mo", "Tu", "We", "Th", "Fr", "Sa"]) =>
			days.map((d) => `${d} ${span}`).join(", ");
		expect(openingHours(week("09:30-19:45"))).toBe("Mo-Sa 09:30-19:45");
		expect(
			openingHours(
				`${week("07:30-12:30", ["Mo", "Tu"])}, ${week("13:30-19:00", ["Mo", "Tu"])}, Sa 09:00-12:00`,
			),
		).toBe("Mo-Tu 07:30-12:30,13:30-19:00; Sa 09:00-12:00");
		expect(openingHours("Mo-Fr 08:00-12:00,Mo-Fr 14:00-18:00,Th 08:00-18:00")).toBe(
			"Mo-We 08:00-12:00,14:00-18:00; Th 08:00-18:00; Fr 08:00-12:00,14:00-18:00",
		);
	});

	it("reads a day named again after a `;` as one split day, and refuses spans that overlap", () => {
		expect(openingHours("Mo-Sa 07:30-12:00;Mo-Sa 13:30-17:30")).toBe(
			"Mo-Sa 07:30-12:00,13:30-17:30",
		);
		expect(openingHours("Mo-Fr 08:00-12:00 ; Fr 14:00-18:00")).toBe(
			"Mo-Th 08:00-12:00; Fr 08:00-12:00,14:00-18:00",
		);
		expect(openingHours("Mo-Fr 08:00-18:00; Fr 08:00-12:00")).toBeNull();
		expect(openingHours("Mo-Fr 08:00-12:00,14:00-18:00; Mo 08:00-12:00")).toBeNull();
		expect(openingHours("Mo-Fr 08:00-18:00; Mo-Fr 08:00-18:00")).toBe("Mo-Fr 08:00-18:00");
	});

	it("repairs what OSM's parser can read and refuses the rest", () => {
		expect(openingHours("Mo-Fri: 07:30-19:00")).toBe("Mo-Fr 07:30-19:00");
		expect(openingHours("Mo-Fr 09:00-19:00,Sat 09:00-18:00")).toBe(
			"Mo-Fr 09:00-19:00, Sa 09:00-18:00",
		);
		expect(openingHours("Monday to Friday")).toBeNull();
	});
});

describe("website", () => {
	it("adds a scheme and drops a bare slash and a fragment", () => {
		expect(website("example.org")).toBe("https://example.org");
		expect(website("http://example.org/a/")).toBe("http://example.org/a/");
		expect(website("https://www.saint-thom.fr/oullins/le-site#content")).toBe(
			"https://www.saint-thom.fr/oullins/le-site",
		);
		expect(website("not a url")).toBeNull();
	});
});
