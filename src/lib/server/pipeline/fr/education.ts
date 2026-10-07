import { inputsOf, type Program } from "../mapping/compile";
import { evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import { closedEvidence, pickRow, proposedTags } from "../mapping/record";
import { type Preset, readingOf } from "../preset";
import { findCoords, str } from "../row";
import type { Row } from "../types";
import { addressBase } from "./ban";
import { functions } from "./functions";
import { alsoAtOtherSites } from "./school-sites";
import { fold } from "./text";

const SOURCE = "fr/annuaire-education";

/** Positions the directory gives to the building; anything coarser is worth a look. */
const EXACT = /^(parfaite|num[ée]ro de rue)$/i;

const SEGPA = "390";

/** A lycée's vocational (SEP) and general-and-technological (SEGT) sections. */
const LYCEE_SECTIONS = ["334", "335"];

const sameLine = (a: Row, b: Row) =>
	fold(str(a, "adresse_1")) === fold(str(b, "adresse_1")) &&
	str(a, "code_postal") === str(b, "code_postal");

/**
 * A SEGPA or a lycée's section lives in its parent's buildings, with the parent's SIRET and
 * switchboard: it is not a place of its own on the map. The directory attaches most as
 * sections, a SEGPA sometimes as a geographic annex, and a SEGT too (Toulouse's Sainte-Marie
 * Saint-Sernin, at its lycée's address); a lycée's annex elsewhere is a site of its own.
 */
function housedSection(r: Row, rowsOf?: (key: string) => Row[] | undefined): boolean {
	if (/section/i.test(str(r, "type_rattachement_etablissement_mere"))) return true;
	const nature = str(r, "code_nature");
	if (nature === SEGPA) return true;
	const parent = str(r, "etablissement_mere");
	return (
		LYCEE_SECTIONS.includes(nature) &&
		!!parent &&
		(rowsOf?.(parent) ?? []).some((p) => sameLine(p, r))
	);
}

/** Two rows of a UAI at one address and point are the directory repeating itself, not two sites. */
const placeOf = (r: Row) =>
	[fold(str(r, "adresse_1")), str(r, "code_postal"), findCoords(r)?.join(",")].join("|");

const build = (programOf: () => Program): Preset => ({
	id: "annuaire-education",
	label: "Annuaire de l'éducation",
	withProgram: (program) => build(() => program),
	mapping: "FR:school",
	source: SOURCE,
	keyField: "identifiant_de_l_etablissement",
	detect: (c) => c.includes("identifiant_de_l_etablissement") && c.includes("nom_etablissement"),
	...readingOf(programOf),
	address: addressBase,
	extract(rows, url, gaps, rowsOf) {
		const program = programOf();
		const toInputs = (row: Row) => inputsOf(program, row);
		const r = pickRow(program, rows, toInputs, gaps);
		if (housedSection(r, rowsOf)) return null;
		const inputs = toInputs(r);
		const made = evaluate(program, [inputs], functions);
		if (!made?.position || !made.key) return null;

		const name = made.tags.find((t) => t.key === "name")?.value ?? "";
		const tags = proposedTags(program, made.tags, [inputs]);
		alsoAtOtherSites(tags, rows, r);

		const places = new Set(rows.map(placeOf)).size;
		const precision = str(r, "precision_localisation");
		return {
			key: made.key,
			url,
			name,
			addr: [
				str(r, "adresse_1"),
				[str(r, "code_postal"), str(r, "nom_commune")].filter(Boolean).join(" "),
			]
				.filter(Boolean)
				.join(", "),
			lat: made.position[0],
			lon: made.position[1],
			closedBy: made.closed ? closedEvidence(program, inputs) : undefined,
			refs: made.refs,
			tags,
			notes: [
				...(places > 1
					? [
							`The directory lists this UAI at ${places} sites; the details are ${str(r, "adresse_1")}'s, the main one`,
						]
					: []),
				...(precision && !EXACT.test(precision)
					? [`The directory places it only to the precision of: ${precision}`]
					: []),
			],
			geocode: made.geocode,
			withheld: made.withheld,
		};
	},
});

/** Annuaire de l'éducation. */
export const education = build(() => programFor(SOURCE));
