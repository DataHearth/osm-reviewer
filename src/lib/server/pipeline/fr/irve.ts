import { inputsOf, type Program } from "../mapping/compile";
import { type EvaluatedTag, type Evidence, evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import { type Preset, readingOf } from "../preset";
import { str, truthy } from "../row";
import type { ProposedTag, Row } from "../types";
import { addressBase } from "./ban";
import { functions } from "./functions";
import { stationAddress } from "./irve-address";
import { rawCoords, stationSite } from "./irve-declarations";
import { type In, readDeclarations } from "./irve-site";
import { link } from "./irve-sites";
import { readSockets } from "./irve-sockets";

const SOURCE = "fr/irve";

const decimals = (v: string) => /\.(\d+)$/.exec(v)?.[1].length ?? 0;

/** A tariff column says the charge is paid only when it gives a price or where to find one. */
const TARIFF = /\d|€|kwh|tarif|https?:/i;

/**
 * The input each rule-written tag quotes in the evidence panel. A tag made by a function says
 * so itself, and falls back to the first input it reads.
 */
const QUOTED: Record<string, (rows: In[], value: string) => Evidence> = {
	amenity: () => ({ input: "station_id" }),
	operator: (rows) => ({ input: rows[0].operator_name ? "operator_name" : "owner_name" }),
	// The branch of the fee rule that gave the value, found again from the same rows.
	fee: (rows, value) => {
		if (value === "no") return { input: "free", shown: "true", kind: "derived" };
		const notFree = rows.find((r) => r.free && !truthy(r.free));
		if (notFree) return { input: "free", shown: notFree.free, kind: "derived" };
		const paid = ["pay_per_session", "pay_by_card"].find((f) => rows.some((r) => truthy(r[f])));
		if (paid) return { input: paid, shown: "true", kind: "derived" };
		const priced = rows.find((r) => TARIFF.test(r.tariff) && !/inconnu|gratuit/i.test(r.tariff));
		return { input: "tariff", shown: priced?.tariff, kind: "derived" };
	},
	access: (rows) => ({
		input: "access_condition",
		shown: rows[0].access_condition,
		kind: "derived",
	}),
	"payment:credit_cards": () => ({ input: "pay_by_card", shown: "true", kind: "derived" }),
	reservation: (rows) => ({ input: "booking", shown: rows[0].booking, kind: "derived" }),
	maxheight: () => ({ input: "max_height" }),
};

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

			const proposed = (t: EvaluatedTag): ProposedTag => {
				const quote = t.evidence ?? QUOTED[t.key]?.(inputs, t.value) ?? { input: t.reads[0] };
				const column = program.columnOf.get(quote.input) ?? quote.input;
				return {
					k: t.key,
					v: t.value,
					conf: t.conf,
					path: column,
					kind: quote.kind ?? "dataset row",
					parts: [
						{ text: `${column}: `, mark: false },
						{ text: (quote.shown ?? str(first, column)) || "—", mark: true },
					],
					...(t.addOnly ? { addOnly: true } : {}),
					...(t.unless ? { unless: t.unless } : {}),
					...(t.mappedWithin ? { mappedWithin: t.mappedWithin } : {}),
				};
			};

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
				tags: made.tags.map(proposed),
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
