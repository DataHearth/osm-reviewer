import { describe, expect, it } from "vitest";
import { addressQuery, expandStreet, phoneFR, spacedNumber } from "./text";

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
		expect(spacedNumber("12b")).toBe("12b");
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
	])("%s", (raw, want) => expect(phoneFR(raw)).toBe(want));
});
