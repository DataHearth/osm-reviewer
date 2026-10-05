import { describe, expect, it } from "vitest";
import { schoolName } from "./school-name";

describe("schoolName", () => {
	it("puts the accent back on École and quiets shouted words, not acronyms", () => {
		expect(schoolName("Ecole élémentaire  Jules-Géraud SALIEGE")).toBe(
			"École élémentaire Jules-Géraud Saliege",
		);
		expect(schoolName("Collège Rosa PARKS - SEGPA")).toBe("Collège Rosa Parks - SEGPA");
	});

	it("drops the contract status and writes a shouted name as a name", () => {
		expect(schoolName("Ecole primaire privée hors contrat  Les sarments")).toBe(
			"École primaire privée Les sarments",
		);
		expect(schoolName("ASSOCIATION DE GESTION DES ECOLES DU CAMPUS VIDAL")).toBe(
			"Association de Gestion des Écoles du Campus Vidal",
		);
		expect(schoolName("IME Les Troënes")).toBe("IME Les Troënes");
		expect(schoolName("DITEP La Maison des enfants")).toBe("DITEP La Maison des enfants");
		expect(schoolName("Ecole Technique privée ESTM Lebreton")).toBe(
			"École Technique privée ESTM Lebreton",
		);
		expect(schoolName("Lycée Pierre de FERMAT")).toBe("Lycée Pierre de Fermat");
		expect(schoolName("Ecole privée hors-contrat Rose Carmin")).toBe("École privée Rose Carmin");
	});

	it("puts accents back on the words the directory drops them from", () => {
		expect(schoolName("Institut Médico-Educatif Le Bouquet")).toBe(
			"Institut Médico-Éducatif Le Bouquet",
		);
		expect(schoolName("Centre de Référence pour l'Evaluation")).toBe(
			"Centre de Référence pour l'Évaluation",
		);
		expect(schoolName("DITEP Elise Rivet")).toBe("DITEP Élise Rivet");
		expect(schoolName("Ecole technique prive Lumière")).toBe("École technique privé Lumière");
		expect(schoolName("SESSAD A VISEE PROFESSIONNELLE")).toBe("SESSAD à Visée Professionnelle");
		expect(schoolName("Lycée A Rimbaud")).toBe("Lycée A Rimbaud");
		expect(schoolName("Ecole maternelle Edouard Herriot")).toBe("École maternelle Édouard Herriot");
		expect(schoolName("Collège privé hors contrat La boetie")).toBe("Collège privé La Boétie");
		expect(schoolName("Insitut médico-éducatif Eclat de rire")).toBe(
			"Insitut médico-éducatif Éclat de rire",
		);
		expect(schoolName("Ecole Supérieure Privée des Metiers")).toBe(
			"École Supérieure Privée des Métiers",
		);
	});

	it("drops a capital typed twice and lowers a particle in mid-name", () => {
		expect(schoolName("Iinstitut médico éducatif CHU La Grave")).toBe(
			"Institut médico éducatif CHU La Grave",
		);
		expect(schoolName("Lycée Lloyd Aaron")).toBe("Lycée Lloyd Aaron");
		expect(schoolName("Institut Médico-Educatif De Fourvière")).toBe(
			"Institut Médico-Éducatif de Fourvière",
		);
		expect(schoolName("De Gaulle Primaire")).toBe("De Gaulle Primaire");
	});

	it("quiets a run of shouted words but keeps initialisms and a lone word in capitals", () => {
		expect(schoolName("Ecole technique prive hors contrat CAMAS ACADEMY")).toBe(
			"École technique privé Camas Academy",
		);
		expect(schoolName("Lycée professionnel ORT LYON")).toBe("Lycée professionnel ORT LYON");
		expect(schoolName("Ecole Technique Privée ISSEC PIGIER")).toBe(
			"École Technique Privée ISSEC Pigier",
		);
		expect(schoolName("Ecole secondaire privée IPESS")).toBe("École secondaire privée IPESS");
		expect(schoolName("Ecole technique privée hors contrat ADONIS")).toBe(
			"École technique privée ADONIS",
		);
	});

	it("keeps the initialisms of a name written all in capitals", () => {
		expect(schoolName("ICS LYON")).toBe("ICS Lyon");
		expect(schoolName("ADONIS IESCA")).toBe("Adonis IESCA");
		expect(schoolName("ASEI CENTRE PHILIAE")).toBe("ASEI Centre Philiae");
		expect(schoolName("EPNAK TOULOUSE")).toBe("EPNAK Toulouse");
		expect(schoolName("Foyer de la Fondation OVE - Appartements")).toBe(
			"Foyer de la Fondation OVE - Appartements",
		);
	});
});
