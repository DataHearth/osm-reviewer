import { str } from "../row";
import { houseNumber } from "../text";
import type { Row } from "../types";
import { addressQuery, expandStreet, spacedNumber } from "./text";

/** No lieu-dit or hameau: an address there is `addr:place` in OSM, which this does not write. */
const STREET =
	/^(rue|ruelle|avenue|boulevard|cheminement|chemin|place|port|allée|allées|impasse|route|quai|cours|cour|square|voie|passage|esplanade|rond-point|carrefour|montée|chaussée|parvis|promenade|sentier|traverse|venelle|faubourg|clos|cité|résidence|lotissement|domaine|villa|mail|parc|grande? rue|petite rue)(?![\p{L}\d])/iu;

/**
 * How far the directory's point may sit from its own housenumber before the address is taken
 * over the point. A school's grounds can stretch a few hundred metres from its gate.
 */
export const SCHOOL_FAR_M = 1000;

interface Lines {
	/** The line holding the housenumber and the street. */
	street: string;
	/** The lines after it, where a CEDEX or a postal box is written. */
	more: string;
	postcode: string;
	city: string;
}

/**
 * The street line split into number and street, with the commune the address uses: Lyon, not
 * "Lyon 6e Arrondissement", and no CEDEX postcode, which routes mail, not places. Null when
 * the line is not a plain street address. A range ("20-28") stays the housenumber, as OSM
 * writes it, and the address base is asked for its first number. The spelling here is the
 * directory's; the address base's replaces it before anything is proposed.
 */
export function addressOf(lines: Lines) {
	const line = expandStreet(
		lines.street
			.replace(/\s*\([^)]*\)/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	);
	const m = /^(\d+(?: ?- ?\d+)?(?: ?(?:bis|ter|quater|[a-z]))?) (.+)$/i.exec(line);
	const number = m ? spacedNumber(m[1]) : "";
	const street = m ? m[2] : line;
	if (!STREET.test(street)) return null;
	// A CEDEX code the lines do not flag (69321) only costs the address base its first try,
	// which the retry with the commune alone recovers.
	const postcode = /cedex|\bbp\b|\bcs ?\d/i.test(lines.more) ? "" : lines.postcode;
	const city = lines.city.replace(/\s+/g, " ").replace(/ \d+(?:er|e|ème)? arrondissement$/i, "");
	return {
		number,
		street: street[0].toUpperCase() + street.slice(1),
		postcode,
		city,
		query: addressQuery(
			`${houseNumber(number).replace(/-.*/, "")} ${street}`.trim(),
			postcode,
			city,
		),
	};
}

export const schoolAddress = (r: Row) =>
	addressOf({
		street: str(r, "adresse_1"),
		more: `${str(r, "adresse_2")} ${str(r, "adresse_3")}`,
		postcode: str(r, "code_postal"),
		city: str(r, "nom_commune"),
	});
