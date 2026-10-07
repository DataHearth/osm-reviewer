import { inputsOf, type Program } from "../mapping/compile";
import { evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import { closedEvidence, pickRow, proposedTags, settledBy, skippedBy } from "../mapping/record";
import { type Preset, readingOf } from "../preset";
import type { Row } from "../types";
import { addressBase } from "./ban";
import { functions, sitesFunctions, skipFunctions } from "./functions";

const SOURCE = "fr/annuaire-education";

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
		const inputs = toInputs(r);
		if (skippedBy(program, skipFunctions, inputs, rowsOf && ((key) => rowsOf(key)?.map(toInputs))))
			return null;
		const made = evaluate(program, [inputs], functions);
		if (!made?.position || !made.key) return null;

		const tags = proposedTags(program, made.tags, [inputs]);
		const notes = settledBy(program, sitesFunctions, rows.map(toInputs), rows.indexOf(r), tags);
		return {
			key: made.key,
			url,
			name: tags.find((t) => t.k === "name")?.v ?? "",
			addr: [inputs.street, [inputs.postcode, inputs.city].filter(Boolean).join(" ")]
				.filter(Boolean)
				.join(", "),
			lat: made.position[0],
			lon: made.position[1],
			closedBy: made.closed ? closedEvidence(program, inputs) : undefined,
			refs: made.refs,
			tags,
			notes: [...notes, ...made.notes],
			geocode: made.geocode,
			withheld: made.withheld,
		};
	},
});

/** Annuaire de l'éducation. */
export const education = build(() => programFor(SOURCE));
