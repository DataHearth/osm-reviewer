import { renameRow } from "../mapping/compile";
import { type EvaluatedTag, type Evidence, evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import type { Preset } from "../preset";
import { str, truthy } from "../row";
import { normaliseName } from "../text";
import type { ProposedTag, Row } from "../types";
import { addressBase } from "./ban";
import { functions } from "./functions";
import {
	NOT_A_POINT,
	rawCoords,
	stationKey,
	stationPosition,
	stationSite,
} from "./irve-declarations";
import { type In, readDeclarations } from "./irve-site";
import { link } from "./irve-sites";
import { readSockets } from "./irve-sockets";
import { addressQuery } from "./text";

const SOURCE = "fr/irve";

const decimals = (v: string) => /\.(\d+)$/.exec(v)?.[1].length ?? 0;

/** A mailbox ("_Bp 75", "CS 30012") or a CEDEX, which no street carries and the address base misreads. */
const POSTAL_BOX = /(?:[\s,_–-]+|^)(?:B\.?\s?P\.?|CS)\s*\d+\b|\s+CEDEX(?:\s*\d+)?\b/gi;

/**
 * `adresse_station` carries the postcode and commune or not, a country, sometimes another
 * postcode than the consolidated one ("…, 31000 Toulouse" at 31100): the street part is kept
 * and the consolidated postcode and commune are written once after it. Where the consolidation
 * has no postcode, the address's own postcode and commune stand, and so they do where the
 * address or its INSEE code is in another département than the consolidation put it ("363 Rte
 * de Toulouse, 33140 Villenave-d'Ornon", INSEE 33550, consolidated as 31400 Toulouse).
 */
function stationAddress(raw: string, postcode: string, commune: string, insee = ""): string {
	const place = normaliseName(commune);
	let street = raw
		.replace(POSTAL_BOX, "")
		.replace(/,\s*france\s*$/i, "")
		.trim()
		.replace(/[\s,–-]+$/, "");
	const cityAfter = (at: number) =>
		street
			.slice(at + 5)
			.split(",")
			.map((s) => s.trim())
			.find(Boolean) ?? "";
	// A number in front is the house's ("23535 Av. du Chater"), unless the commune follows it.
	const code = [...street.matchAll(/(?<!\d)\d{5}(?!\d)/g)].find(
		(m) => m.index > 0 || normaliseName(cityAfter(0)) === place,
	);
	const ownCity = code ? cityAfter(code.index) : "";
	if (code) street = street.slice(0, code.index).replace(/[\s,–-]+$/, "");
	// Only after a comma or a dash: "Rue de Lyon" in Lyon is a street.
	for (let i = street.length - 1; place && i > 0; i--)
		if (/[,–-]\s*$/.test(street.slice(0, i)) && normaliseName(street.slice(i)) === place) {
			street = street.slice(0, i).replace(/[\s,–-]+$/, "");
			break;
		}
	const consolidated = departement(postcode);
	const elsewhere =
		!!consolidated &&
		[code?.[0] ?? "", insee].some((c) => departement(c) && departement(c) !== consolidated);
	if (elsewhere) return [street, [code?.[0], ownCity].filter(Boolean).join(" ")].join(", ");
	const city = postcode || !ownCity || normaliseName(ownCity) === place ? commune : ownCity;
	return [street, [postcode || code?.[0], city].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");
}

/** A postcode's or an INSEE code's département: Corsica's 2A and 2B are 20, overseas ones three digits. */
function departement(code: string): string | null {
	if (!/^(\d{5}|2[AB]\d{3})$/i.test(code)) return null;
	return code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2).replace(/2[AB]/i, "20");
}

/**
 * How far a station's point may sit from its own housenumber before the address is taken over
 * the point. It is where its operator placed it, often in a car park well away from the
 * address's door, so only a coarse one (`COARSE_DECIMALS`) is moved.
 */
const STATION_FAR_M = 100;

/** Four decimals is 11 m: a registry writing so few rounded a geocoded point, or typed it. */
const COARSE_DECIMALS = 4;

/**
 * Past this from its own housenumber even a precise point is a mistyped one: SAS agripat's,
 * 49 km off in Lyon, against the 2 km a car park or a site's postal address puts between them.
 */
const STATION_WRONG_M = 2000;

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

/** IRVE "statique" v2.3, consolidated: one row per charge point, grouped into one station. */
export const irve: Preset = {
	id: "irve",
	label: "IRVE charging stations",
	keyField: "id_station_itinerance",
	detect: (c) => c.includes("id_station_itinerance") && c.includes("id_pdc_itinerance"),
	key: stationKey,
	site: stationSite,
	position: stationPosition,
	address: addressBase,
	link,
	extract(declared, url) {
		const program = programFor(SOURCE);
		const toInputs = (r: Row) =>
			renameRow(program, Object.fromEntries([...program.rename.keys()].map((c) => [c, str(r, c)])));
		const read = readDeclarations(declared, toInputs);
		// The key `mergeSites` gave the record, whichever station is newest.
		const key = declared
			.map(stationKey)
			.filter((k) => k !== null)
			.sort((a, b) => a.localeCompare(b))[0];
		if (!read || !key) return null;
		const { rows, inputs, site, pos } = read;
		const made = evaluate(program, inputs, functions, site);
		if (!made) return null;
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

		// Every id ever declared here, a station since declared again included: a mapper may
		// have copied any of them.
		const known = [
			...new Set(
				declared.flatMap((r) =>
					[str(r, "id_station_itinerance"), str(r, "id_pdc_itinerance")].filter(
						(id) => id && !NOT_A_POINT.test(id),
					),
				),
			),
		].join(";");
		const refs: Record<string, string> = known ? { "ref:EU:EVSE": known } : {};
		const addr = stationAddress(
			str(first, "adresse_station"),
			str(first, "consolidated_code_postal"),
			str(first, "consolidated_commune"),
			str(first, "code_insee_commune"),
		);
		return {
			key,
			url,
			name: str(first, "nom_station", "nom_enseigne") || "Charging station",
			addr,
			lat: pos[0],
			lon: pos[1],
			refs,
			tags: made.tags.map(proposed),
			fit: sockets.fit,
			absent: sockets.absent,
			notes,
			geocode: str(first, "adresse_station")
				? {
						q: addressQuery(addr, "", ""),
						farM: precision <= COARSE_DECIMALS ? STATION_FAR_M : Number.POSITIVE_INFINITY,
						wrongM: STATION_WRONG_M,
					}
				: undefined,
		};
	},
};
