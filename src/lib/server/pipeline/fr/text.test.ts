import { describe, expect, it } from "vitest";
import { addressQuery, digits, expandStreet, phoneFR, spacedNumber } from "./text";

describe("expandStreet", () => {
	it("writes out a street type where it stands and a title anywhere", () => {
		expect(expandStreet("49 Bd Lucien Sampaix, 69190 Saint-Fons")).toBe(
			"49 Boulevard Lucien Sampaix, 69190 Saint-Fons",
		);
		expect(expandStreet("112 Av. Gén. Leclerc")).toBe("112 Avenue Général Leclerc");
		expect(expandStreet("11 ter Imp. Ste Anne")).toBe("11 ter Impasse Sainte Anne");
		expect(expandStreet("Pl. St-Jean")).toBe("Place Saint-Jean");
		expect(expandStreet("2 rue Générale")).toBe("2 rue Générale");
	});
});

describe("spacedNumber", () => {
	it("keeps a letter suffix in the source's case and writes bis and ter spaced, in lowercase", () => {
		expect(spacedNumber("6A")).toBe("6A");
		expect(spacedNumber("12 B")).toBe("12B");
		expect(spacedNumber("12b")).toBe("12B");
		expect(spacedNumber("20a-28")).toBe("20A-28");
		expect(spacedNumber("074BIS")).toBe("74 bis");
		expect(spacedNumber("3 Ter")).toBe("3 ter");
	});
});

describe("addressQuery", () => {
	it("adds the postcode and commune only when the line lacks them", () => {
		expect(addressQuery("49 Bd Lucien Sampaix, 69190 Saint-Fons", "69190", "Saint-Fons")).toBe(
			"49 Boulevard Lucien Sampaix, 69190 Saint-Fons",
		);
		expect(addressQuery("1 place de la Mairie", "69001", "Lyon")).toBe(
			"1 place de la Mairie 69001 Lyon",
		);
	});
});

describe("phoneFR", () => {
	it.each([
		["0561234567", "+33 5 61 23 45 67"],
		["05 61 23 45 67", "+33 5 61 23 45 67"],
		["+33 (0)5 61 23 45 67", "+33 5 61 23 45 67"],
		["0033561234567", "+33 5 61 23 45 67"],
		["12345", null],
		["0806141500", "08 06 14 15 00"],
		["+33 8 06 14 15 00", "08 06 14 15 00"],
		["0262 12 34 56", "+262 262 12 34 56"],
		["0692 12 34 56", "+262 692 12 34 56"],
		["+262 262 12 34 56", "+262 262 12 34 56"],
		["00590590123456", "+590 590 12 34 56"],
		["0694 12 34 56", "+594 694 12 34 56"],
		["0696 12 34 56", "+596 696 12 34 56"],
		["05 08 41 23 45", "+508 41 23 45"],
		["+508 41 23 45", "+508 41 23 45"],
		["+262 590 12 34 56", null],
	])("%s", (raw, want) => expect(phoneFR(raw)).toBe(want));

	it("compares a number across its national and international spellings", () => {
		for (const raw of ["0262 12 34 56", "0806141500", "05 08 41 23 45", "0561234567"])
			expect(digits(phoneFR(raw) ?? "")).toBe(digits(raw));
	});
});
