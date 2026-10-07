import type { ColumnRenaming } from "../src/lib/server/pipeline/mapping/rename";

/** The renaming the sources spec finds stored: a unit test holds it to the model-answer checks, so a fixture they would refuse fails the suite. */
export const STORED_COLUMNS = [
	"code_uai",
	"intitule",
	"tel",
	"latitude",
	"longitude",
	"ligne_adresse",
	"notes_internes",
	"code_interne",
	"derniere_visite",
	"service_instructeur",
	"ref_dossier",
	"observations",
];

export const STORED_RENAMING: ColumnRenaming = {
	mapping: "FR:school",
	rename: {
		code_uai: "id",
		intitule: "name",
		tel: "phone",
		latitude: "lat",
		longitude: "lon",
		ligne_adresse: "street",
	},
	ignored: {
		notes_internes: "free text no rule reads",
		code_interne: "the operator's own code",
		derniere_visite: "no OSM key",
		service_instructeur: "no OSM key",
		ref_dossier: "the operator's own code",
		observations: "free text no rule reads",
	},
	steps: {},
};
