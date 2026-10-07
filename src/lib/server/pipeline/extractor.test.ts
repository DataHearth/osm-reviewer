import { describe, expect, it } from "vitest";
import { extractorOf, shippedExtractor } from "./extractor";
import { mappingOfPreset, renamingFor, shippedCovering, shippedNamed } from "./mapping/files";
import type { Row } from "./types";

const shipped = renamingFor("fr/annuaire-education");

const row: Row = {
	identifiant_de_l_etablissement: "0690001A",
	nom_etablissement: "Ecole Jean Jaurès",
	type_etablissement: "Ecole",
	libelle_nature: "ECOLE ELEMENTAIRE PUBLIQUE",
	statut_public_prive: "Public",
	ecole_maternelle: "0",
	ecole_elementaire: "1",
	adresse_1: "2 rue Jaurès",
	code_postal: "69003",
	nom_commune: "Lyon",
	telephone: "04 72 00 00 01",
	etat: "OUVERT",
	precision_localisation: "Rue",
	latitude: 45.76,
	longitude: 4.85,
};

const scrambled = {
	rename: Object.fromEntries(Object.entries(shipped.rename).map(([c, i]) => [`c_${c}`, i])),
	steps: {},
};
const scrambledRow = Object.fromEntries(Object.entries(row).map(([c, v]) => [`c_${c}`, v]));

describe("a source's kind of place", () => {
	it("is named by a mapping's id, or by the name an older row holds for its shipped source", () => {
		expect(mappingOfPreset("FR:school")).toBe("FR:school");
		expect(mappingOfPreset("annuaire-education")).toBe("FR:school");
		expect(mappingOfPreset("irve")).toBe("FR:charging_station");
		expect(mappingOfPreset("FR:pharmacy")).toBeNull();
		expect(shippedNamed("irve")?.source).toBe("fr/irve");
	});

	it("is found by the shipped source whose columns hold the read's", () => {
		expect(shippedCovering(Object.keys(row))?.source).toBe("fr/annuaire-education");
		expect(shippedCovering([...Object.keys(row), "a column nobody ships"])).toBeNull();
	});
});

describe("an extractor over a model's table", () => {
	const official = shippedExtractor(shipped).extract([row], "u");
	const custom = extractorOf({ shipped, ...scrambled, own: false }).extract([scrambledRow], "u");

	it("proposes what the shipped source does, but for the overrides the shipped file alone carries", () => {
		const bare = ({ tags, ...x }: NonNullable<typeof official>) => ({
			...x,
			tags: tags.filter((t) => t.k !== "start_date").map(({ path, parts, ...t }) => t),
		});
		expect(custom && bare(custom)).toEqual(official && bare(official));
	});

	it("carries the position-precision note and the amenity's evidence the table's columns give", () => {
		expect(custom?.notes).toEqual(["The directory places it only to the precision of: Rue"]);
		const amenity = custom?.tags.find((t) => t.k === "amenity");
		expect(amenity?.path).toBe("c_libelle_nature");
		expect(amenity?.parts.map((p) => p.text).join("")).toBe(
			"c_libelle_nature: ECOLE ELEMENTAIRE PUBLIQUE",
		);
	});

	it("looks a record up by the column the table gives its key", () => {
		expect(extractorOf({ shipped, ...scrambled, own: false }).keyField).toBe(
			"c_identifiant_de_l_etablissement",
		);
	});
});
