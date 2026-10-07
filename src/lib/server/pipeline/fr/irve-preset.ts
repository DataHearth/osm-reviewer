import { inputsOf, type Program } from "../mapping/compile";
import { evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import { notedBy, proposedTags } from "../mapping/record";
import { type Preset, readingOf } from "../preset";
import type { Row } from "../types";
import { addressBase } from "./ban";
import { functions, notesFunctions } from "./functions";
import { stationAddress } from "./irve-address";
import { stationSite } from "./irve-declarations";
import { readDeclarations } from "./irve-site";
import { link } from "./irve-sites";

const SOURCE = "fr/irve";

const build = (programOf: () => Program): Preset => {
	const reading = readingOf(programOf);
	return {
		id: "irve",
		label: "IRVE charging stations",
		withProgram: (program) => build(() => program),
		mapping: "FR:charging_station",
		source: SOURCE,
		keyField: "id_station_itinerance",
		detect: (c) => c.includes("id_station_itinerance") && c.includes("id_pdc_itinerance"),
		...reading,
		site: stationSite,
		address: addressBase,
		link,
		extract(declared, url) {
			const program = programOf();
			const read = readDeclarations(declared, (r: Row) => inputsOf(program, r));
			// The key `mergeSites` gave the record, whichever station is newest.
			const key = declared
				.map(reading.key)
				.filter((k) => k !== null)
				.sort((a, b) => a.localeCompare(b))[0];
			if (!read || !key) return null;
			const { inputs, site } = read;
			const made = evaluate(program, inputs, functions, site);
			if (!made?.position) return null;

			const first = inputs[0];
			return {
				key,
				url,
				name: first.station_name || first.brand || "Charging station",
				addr: stationAddress(first.station_address, first.postcode, first.city, first.insee),
				lat: made.position[0],
				lon: made.position[1],
				refs: made.refs,
				tags: proposedTags(program, made.tags, inputs),
				fit: made.fit,
				absent: made.absent,
				notes: [...made.notes, ...notedBy(program, notesFunctions, first)],
				geocode: made.geocode,
			};
		},
	};
};

/** IRVE "statique" v2.3, consolidated: one row per charge point, grouped into one station. */
export const irve = build(() => programFor(SOURCE));
