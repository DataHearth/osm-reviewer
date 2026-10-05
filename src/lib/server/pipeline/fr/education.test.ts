import { describe, expect, it } from "vitest";
import { presetById } from "../presets";
import type { Row } from "../types";
import { openedForSure, personalMailbox, schoolAddress } from "./education";

describe("Annuaire de l'éducation preset", () => {
	const edu = presetById("annuaire-education");
	if (!edu) throw new Error("preset missing");
	const row = (over: Row = {}): Row => ({
		identifiant_de_l_etablissement: "0690001A",
		nom_etablissement: "Ecole Jean Jaurès",
		type_etablissement: "Ecole",
		statut_public_prive: "Public",
		ecole_maternelle: "1",
		ecole_elementaire: "1",
		adresse_1: "2 rue Jaurès",
		code_postal: "69003",
		nom_commune: "Lyon",
		telephone: "04 72 00 00 01",
		web: "ecole-jaures.fr",
		siren_siret: "21690001000019",
		etat: "OUVERT",
		latitude: 45.76,
		longitude: 4.85,
		...over,
	});

	it("proposes tags with normalised phone and website", () => {
		const x = edu.extract([row()], "u");
		const tags = Object.fromEntries((x?.tags ?? []).map((t) => [t.k, t.v]));
		expect(tags).toMatchObject({
			amenity: "school",
			"school:FR": "primaire",
			name: "École Jean Jaurès",
			"ref:UAI": "0690001A",
			"ref:FR:SIRET": "21690001000019",
			phone: "+33 4 72 00 00 01",
			website: "https://ecole-jaures.fr",
			"operator:type": "public",
		});
		expect(x?.closedBy).toBeUndefined();
	});

	it("maps every level to amenity=school with its school:FR, post-bac to college", () => {
		const kind = (r: Row) => {
			const tags = edu.extract([r], "u")?.tags ?? [];
			return [tags.find((t) => t.k === "amenity")?.v, tags.find((t) => t.k === "school:FR")?.v];
		};
		expect(kind(row({ ecole_elementaire: "0" }))).toEqual(["school", "maternelle"]);
		expect(kind(row({ ecole_maternelle: "0" }))).toEqual(["school", "élémentaire"]);
		expect(kind(row({ type_etablissement: "Collège" }))).toEqual(["school", "collège"]);
		expect(kind(row({ type_etablissement: "Lycée" }))).toEqual(["school", "lycée"]);
		expect(kind(row({ type_etablissement: "", code_nature: "400" }))).toEqual([
			"college",
			undefined,
		]);
	});

	it("maps a medico-social institute as a social facility, leaving a mapped one's main tag", () => {
		const tags = edu.extract(
			[row({ type_etablissement: "Médico-social", code_nature: "240" })],
			"u",
		)?.tags;
		expect(tags?.find((t) => t.k === "amenity")).toMatchObject({
			v: "social_facility",
			addOnly: true,
		});
		expect(tags?.find((t) => t.k === "social_facility:for")?.v).toBe("disabled");
		expect(tags?.find((t) => t.k === "school:FR")).toBeUndefined();
	});

	it("reads a UAI over several sites from its main site, and says so", () => {
		const annex = row({
			nom_etablissement: "Collège Michelet - annexe",
			adresse_1: "17 rue Larrey",
		});
		const main = row({ nom_etablissement: "Collège Michelet", adresse_1: "6 boulevard Michelet" });
		const x = edu.extract([annex, main], "u");
		expect(x?.name).toBe("Collège Michelet");
		expect(x?.notes?.[0]).toMatch(/at 2 sites.*6 boulevard Michelet/);
	});

	it("takes the site whose address is at the directory's point as the main one", () => {
		const there = row({
			nom_etablissement: "Lycée de coiffure de Lyon",
			adresse_1: "30 rue Couturier",
		});
		const away = row({ nom_etablissement: "École de coiffure", adresse_1: "2 quai Jean Moulin" });
		const gaps = new Map([
			[there, 15],
			[away, 1300],
		]);
		expect(edu.extract([there, away], "u", gaps)?.name).toBe("Lycée de coiffure de Lyon");
	});

	it("lets OSM keep the phone another site of the same UAI gives", () => {
		const annex = row({ adresse_1: "17 rue Larrey", telephone: "05 61 21 99 71" });
		const main = row({ nom_etablissement: "Ecole", telephone: "05 61 62 46 59" });
		const phone = edu.extract([annex, main], "u")?.tags.find((t) => t.k === "phone");
		expect(phone).toMatchObject({ v: "+33 5 61 62 46 59", also: ["+33 5 61 21 99 71"] });
	});

	it("keeps https where another site of the same UAI gives the page over it", () => {
		const annex = row({ adresse_1: "17 rue Larrey", web: "https://www.lamartinierediderot.fr/" });
		const main = row({ nom_etablissement: "Ecole", web: "http://www.lamartinierediderot.fr/" });
		const site = edu.extract([annex, main], "u")?.tags.find((t) => t.k === "website");
		expect(site?.v).toBe("https://www.lamartinierediderot.fr");
		expect(site?.also).toBeUndefined();
	});

	it("quotes the level flags a school's level comes from, and skips a webmail address", () => {
		const tags = edu.extract([row({ mail: "someone@gmail.com" })], "u")?.tags ?? [];
		expect(
			tags
				.find((t) => t.k === "school:FR")
				?.parts.map((p) => p.text)
				.join(""),
		).toBe("ecole_maternelle: 1, ecole_elementaire: 1");
		expect(tags.find((t) => t.k === "email")).toBeUndefined();
	});

	it("says when the directory places a school only roughly", () => {
		expect(edu.extract([row({ precision_localisation: "Rue" })], "u")?.notes).toEqual([
			"The directory places it only to the precision of: Rue",
		]);
		expect(edu.extract([row({ precision_localisation: "Parfaite" })], "u")?.notes).toEqual([]);
	});

	it("proposes nothing for a section housed in its parent establishment", () => {
		const section = { type_rattachement_etablissement_mere: "FILIERE OU DEPARTEMENT OU SECTION" };
		expect(edu.extract([row(section)], "u")).toBeNull();
		expect(
			edu.extract([row({ type_rattachement_etablissement_mere: "ANNEXE GEOGRAPHIQUE" })], "u"),
		).not.toBeNull();
		const segpa = {
			type_rattachement_etablissement_mere: "ANNEXE GEOGRAPHIQUE",
			code_nature: "390",
		};
		expect(edu.extract([row(segpa)], "u")).toBeNull();
	});

	it("proposes nothing for an office that is not a school", () => {
		expect(edu.extract([row({ type_etablissement: "Service Administratif" })], "u")).toBeNull();
		expect(edu.extract([row({ type_etablissement: "" })], "u")).toBeNull();
		expect(edu.extract([row({ code_nature: "809" })], "u")).toBeNull();
	});

	it("proposes the directory's email and opening date", () => {
		const tags = Object.fromEntries(
			(
				edu.extract(
					[
						row({
							mail: "ce.0690001A@ac-lyon.fr",
							date_ouverture: "2023-09-01",
							ecole_elementaire: "0",
						}),
					],
					"u",
				)?.tags ?? []
			).map((t) => [t.k, t.v]),
		);
		expect(tags).toMatchObject({ email: "ce.0690001A@ac-lyon.fr", start_date: "2023-09-01" });
	});

	it("leaves out a person's own mailbox and a mobile, and counts them", () => {
		const x = edu.extract(
			[row({ mail: "audrey.lagane@lespetitesfamilles.fr", telephone: "06 70 75 01 33" })],
			"u",
		);
		const keys = x?.tags.map((t) => t.k);
		expect(keys).not.toContain("email");
		expect(keys).not.toContain("phone");
		expect(x?.withheld).toBe(2);
		expect(edu.extract([row({ mail: "contact@ecole-jaures.fr" })], "u")?.withheld).toBe(0);
	});

	it("proposes no operator:type where the SIREN and the directory's status disagree", () => {
		const type = (over: Row) =>
			edu.extract([row(over)], "u")?.tags.find((t) => t.k === "operator:type")?.v;
		expect(type({ statut_public_prive: "Privé", siren_siret: "26690008300012" })).toBeUndefined();
		expect(type({ statut_public_prive: "Public", siren_siret: "77564661500564" })).toBeUndefined();
		expect(type({ statut_public_prive: "Privé", siren_siret: "77564661500564" })).toBe("private");
		expect(type({ statut_public_prive: "Privé", siren_siret: "" })).toBe("private");
	});

	it("asks the address base for its address, a kilometre off before its point moves", () => {
		expect(edu.extract([row()], "u")?.geocode).toEqual({
			q: "2 rue Jaurès 69003 Lyon",
			farM: 1000,
		});
		expect(edu.extract([row({ adresse_1: "Lieu-dit Les Prés" })], "u")?.geocode).toBeUndefined();
	});

	it("fills a missing name but never renames", () => {
		const name = edu.extract([row()], "u")?.tags.find((t) => t.k === "name");
		expect(name?.addOnly).toBe(true);
	});

	it("reads FERME as a closure, not an opening or a pending closure", () => {
		const x = edu.extract([row({ etat: "FERME" })], "u");
		expect(x?.closedBy?.path).toBe("etat");
		expect(edu.extract([row({ etat: "OUVERT" })], "u")?.closedBy).toBeUndefined();
		for (const etat of ["A OUVRIR", "A FERMER"])
			expect(edu.extract([row({ etat })], "u")?.closedBy).toBeUndefined();
	});

	it("needs a position", () => {
		expect(edu.extract([row({ latitude: "", longitude: "" })], "u")).toBeNull();
	});
});

describe("schoolAddress", () => {
	const at = (over: Row) =>
		schoolAddress({
			adresse_1: "68 boulevard de Strasbourg",
			code_postal: "31000",
			nom_commune: "Toulouse",
			...over,
		});
	it("splits the number from the street and keeps the commune, not its arrondissement", () => {
		expect(at({ nom_commune: "Lyon 6e  Arrondissement", code_postal: "69006" })).toEqual({
			number: "68",
			street: "Boulevard de Strasbourg",
			postcode: "69006",
			city: "Lyon",
			query: "68 boulevard de Strasbourg 69006 Lyon",
		});
	});
	it("drops a CEDEX postcode and refuses no street at all", () => {
		expect(at({ adresse_3: "31076 TOULOUSE CEDEX 3" })?.postcode).toBe("");
		expect(at({ adresse_1: "BP 41023" })).toBeNull();
	});
	it("asks for a street in capitals or abbreviated as written out", () => {
		expect(at({ adresse_1: "31 rue DES TUILLIERS" })?.query).toBe(
			"31 rue DES TUILLIERS 31000 Toulouse",
		);
		expect(at({ adresse_1: "95  bd PINEL" })?.query).toBe("95 boulevard PINEL 31000 Toulouse");
		expect(at({ adresse_1: "373 r L'Occitane" })?.street).toBe("Rue L'Occitane");
	});
	it("writes a housenumber without its leading zero, its suffix in lower case, and reads a port as a street", () => {
		expect(at({ adresse_1: "07 chemin des Prés" })?.number).toBe("7");
		expect(at({ adresse_1: "158 BIS RUE DU 4 AOUT 1789" })?.number).toBe("158 bis");
		// The address base scores "11 ter" under its floor and "11ter" over it.
		expect(at({ adresse_1: "158 BIS RUE DU 4 AOUT 1789" })?.query).toMatch(/^158bis /);
		expect(at({ adresse_1: "8 port SAINT-SAUVEUR" })?.street).toBe("Port SAINT-SAUVEUR");
	});
	it("keeps a housenumber range whole and asks for its first number", () => {
		const range = at({ adresse_1: "20-28 rue Louis Auguste Blanqui", code_postal: "69921" });
		expect(range).toMatchObject({
			number: "20-28",
			query: "20 rue Louis Auguste Blanqui Toulouse",
		});
	});
	it("keeps a note out of the street and a mail route out of the postcode", () => {
		expect(at({ adresse_1: "12 rue de la Solidarité (site Ariane)" })?.street).toBe(
			"Rue de la Solidarité",
		);
		expect(at({ code_postal: "69321" })?.postcode).toBe("");
		expect(at({ code_postal: "69005" })?.postcode).toBe("69005");
	});
});

describe("openedForSure", () => {
	it("trusts a register date only after the bulk entries, and never a merged primaire's", () => {
		expect(openedForSure("1965-05-01", "lycée")).toBe(false);
		expect(openedForSure("1977-03-08", "élémentaire")).toBe(false);
		expect(openedForSure("2023-09-01", "maternelle")).toBe(true);
		expect(openedForSure("2017-09-01", "primaire")).toBe(false);
		expect(openedForSure("", null)).toBe(false);
	});
});

describe("personalMailbox", () => {
	it("tells somebody's own address from the establishment's", () => {
		const own = (mail: string, name = "École Declic", city = "Lyon") =>
			personalMailbox(mail, name, city);
		expect(own("jean-armand.barone@college-declic.fr")).toBe(true);
		expect(own("l.gruer@espaceforma.com")).toBe(true);
		expect(own("audrey.lagane@lespetitesfamilles.fr")).toBe(true);
		expect(own("contact@college-declic.fr")).toBe(false);
		expect(own("secretariat.college@x.fr")).toBe(false);
		expect(own("vie-scolaire@x.fr")).toBe(false);
		expect(own("seguin.direction@ccass-sbe.org")).toBe(false);
		expect(own("ce.0690001A@ac-lyon.fr")).toBe(false);
		expect(own("immaculee.conception@immaculee.net")).toBe(false);
		expect(own("campus.lyon@x.fr")).toBe(false);
		expect(own("lycee.neyret@x.fr", "Lycée Neyret")).toBe(false);
	});

	it("reads a mailbox of one word as a person's unless the word is the school's", () => {
		const own = (mail: string, name = "Lycée professionnel de coiffure", place = "Lyon") =>
			personalMailbox(mail, name, place);
		expect(own("maubert@lyceedecoiffure.com")).toBe(true);
		expect(own("ehatzakortzian@prado.asso.fr")).toBe(true);
		expect(own("yolene@lespetitsplus.org")).toBe(true);
		expect(own("accueil@x.fr")).toBe(false);
		expect(own("lyceepro@slsb.fr")).toBe(false);
		expect(own("secretariatmontchat@pierre-termier.fr")).toBe(false);
		expect(own("carrel@carrel.fr")).toBe(false);
		expect(own("contact31-toulouse@epnak.org")).toBe(false);
		expect(own("maisondesenfants@adsea69.fr", "DITEP La Maison des enfants")).toBe(false);
		expect(own("neyret@lasalle-69.com", "Lycée La Salle", "Lyon 22 rue Neyret")).toBe(false);
	});
});
