import { inputsOf, type Program } from "../mapping/compile";
import { evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import { proposedTags } from "../mapping/record";
import { type Preset, readingOf } from "../preset";
import { str } from "../row";
import type { Row } from "../types";
import { addressBase } from "./ban";
import { functions } from "./functions";
import { stationAddress } from "./irve-address";
import { rawCoords, stationSite } from "./irve-declarations";
import { readDeclarations } from "./irve-site";
import { link } from "./irve-sites";
import { readSockets } from "./irve-sockets";

const SOURCE = "fr/irve";

const decimals = (v: string) => /\.(\d+)$/.exec(v)?.[1].length ?? 0;

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
			const { rows, inputs, site } = read;
			const made = evaluate(program, inputs, functions, site);
			if (!made?.position) return null;
			const first = rows[0];

			const sockets = readSockets(inputs, site);
			const raw = rawCoords(first);
			const precision = raw ? Math.min(...raw.map(decimals)) : 0;
			const notes = [...sockets.notes];
			if (raw && precision <= 2)
				notes.push(
					`The registry places it to ${precision} decimal${precision === 1 ? "" : "s"} only (${raw.join(", ")}), which can be a few hundred metres off`,
				);

			const { station_address, postcode, city, insee } = inputs[0];
			return {
				key,
				url,
				name: str(first, "nom_station", "nom_enseigne") || "Charging station",
				addr: stationAddress(station_address, postcode, city, insee),
				lat: made.position[0],
				lon: made.position[1],
				refs: made.refs,
				tags: proposedTags(program, made.tags, inputs),
				fit: sockets.fit,
				absent: sockets.absent,
				notes,
				geocode: made.geocode,
			};
		},
	};
};

/** IRVE "statique" v2.3, consolidated: one row per charge point, grouped into one station. */
export const irve = build(() => programFor(SOURCE));
