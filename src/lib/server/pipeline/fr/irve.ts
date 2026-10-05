import { OSM_MAX } from "$lib/changeset";
import { distance } from "../geo";
import { fill, type Preset, type SiteLink, Tags } from "../preset";
import { openingHours, str, truthy } from "../row";
import { normaliseName, tokens } from "../text";
import type { Row } from "../types";
import { addressBase } from "./ban";
import {
	company,
	currentStations,
	declarationsOf,
	NOT_A_POINT,
	onePerPoint,
	operatorOf,
	pointOf,
	rawCoords,
	stationKey,
	stationPosition,
	stationSite,
	TAIL,
} from "./irve-declarations";
import { addressQuery, phoneFR } from "./text";

/**
 * How far apart two declarations of one site can be placed. A re-declared site's position is
 * sometimes retyped (Tisséo Balma-Gramont moved 200 m in 2024 on two transposed digits).
 */
const LINK_M = 400;

/** What `prise_type_autre` covers: every connector the schema has no column of its own for. */
const OTHER_SOCKETS = [
	"socket:type1",
	"socket:type1_combo",
	"socket:type3",
	"socket:type3a",
	"socket:type3c",
];

/**
 * What a connector can physically deliver: AC type 2 at 63 A three-phase, a domestic socket at
 * 16 A. Some operators declare a DC unit's power on its AC outlet too (150 kW on a type 2), and
 * one declares its type 2 points as domestic sockets at 7 kW; no output is better than those.
 */
const MAX_KW: Record<string, number> = {
	"socket:type2": 43.5,
	"socket:type2_cable": 43.5,
	"socket:typee": 3.7,
};

/** A registry's 22.08 is the 22 kW everyone writes; a real 7.4 or 3.7 keeps its decimal. */
const POWER_KW = (n: number) => {
	const whole = Math.round(n);
	return `${Math.abs(n - whole) < 0.15 ? whole : Number(n.toFixed(1))} kW`;
};

/**
 * The earliest commissioning date. A bare 1 January is how several operators fill a date they
 * do not have, so it is left out rather than written as history.
 */
function serviceDate(rows: Row[]): string | null {
	const dates = rows
		.map((r) => /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str(r, "date_mise_en_service")))
		.flatMap((m) => (m ? [`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`] : []))
		.filter((d) => !d.endsWith("-01-01"))
		.sort();
	const since = dates[0];
	if (!since) return null;
	// A date after a declaration of the station was made (e-Totem's 2026-07-28 on a station in
	// its own file since 2025-06-17) is a plan, or a re-commissioning, not when it opened.
	// `created_at` is not a declaration's date: every row of one file carries the file's.
	const declared = rows
		.map((r) => str(r, "date_maj"))
		.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
		.sort()[0];
	return declared && since > declared ? null : since;
}

/** Filler numbers some operators declare when they have none to give: `+33 1 23 45 67 89`, `+33 1 00 00 00 00`. */
const PLACEHOLDER_PHONE = /^\+33 \d (23 45 67 89|(\d)\2 \2\2 \2\2 \2\2)$/;

/** A mobile is usually somebody's own line, not the operator's. */
function operatorPhone(raw: string): string | null {
	const phone = phoneFR(raw.replace(/^tel:/i, ""));
	return !phone || PLACEHOLDER_PHONE.test(phone) || /^\+33 [67]/.test(phone) ? null : phone;
}

/** Only an answer the registry actually gives: "Accessibilité inconnue" proposes nothing. */
function wheelchair(raw: string): string | null {
	if (/^réservé pmr/i.test(raw)) return "designated";
	if (/^accessible/i.test(raw)) return "yes";
	if (/^non accessible/i.test(raw)) return "no";
	return null;
}

/**
 * The station's accessibility from all its points: designated only when every point is
 * reserved, yes when some are and the rest accessible, nothing when some are not accessible.
 */
function stationWheelchair(rows: Row[]): string | null {
	const each = rows.map((r) => wheelchair(str(r, "accessibilite_pmr")));
	if (each.some((v) => v === null)) return null;
	if (each.every((v) => v === "designated")) return "designated";
	if (each.every((v) => v === "designated" || v === "yes")) return "yes";
	return each.every((v) => v === "no") ? "no" : null;
}

/** A tariff column says the charge is paid only when it gives a price or where to find one. */
const isTariff = (v: string) => /\d|€|kwh|tarif|https?:/i.test(v) && !/inconnu|gratuit/i.test(v);

const isPrice = (v: string) => /\d\s*(€|eur|cts?\b)|€\s*\d/i.test(v) && !/gratuit/i.test(v);

/** A station named for two-wheelers, whatever its flag says. */
const TWO_WHEEL_NAME = /deux[- ]roues|2[- ]roues|\bmotos?\b|scooter|v[ée]los?\b/i;

/** An operator's note that per-session payment goes through its own app, badge or account. */
const NEEDS_ACCOUNT = /\b(app|appli|application|badge|abonnement|compte|rfid|lidl plus|emsp)\b/i;

/**
 * A station's `ref:EU:EVSE` is its pool id, written the way French mappers and the EVSE id
 * standard do: `FR*TLS*P31555019`. Point ids (`E`) belong on charge points, not here, and an
 * id outside the standard shape is the operator's own, so neither is proposed.
 */
export function poolId(raw: string): string | null {
	const m = /^([A-Z]{2})\*?([A-Z0-9]{3})\*?(P[A-Z0-9*]+)$/i.exec(raw.replace(/\s/g, ""));
	return m ? `${m[1]}*${m[2]}*${m[3]}`.toUpperCase() : null;
}

/** A slug is a web address's, not anybody's name ("hotel-crequi-lyon"). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** "Réseau de recharge Virta Public": what the network is, not its name. */
const DESCRIBED_NETWORK = /^r[ée]seau de (re)?charge\b/i;

/** Words any station's name may hold, which say nothing about whose site it is. */
const GENERIC = new Set(["borne", "bornes", "recharge", "charge", "station", "stations", "irve"]);

/**
 * `nom_enseigne` is meant to be the network's commercial name, but operators often put the
 * site's own name there ("LPA Perrache" at "Parking Perrache", "Allego - Leclerc Blagnac",
 * "VIL13"). A network shows up whole inside a station name ("Reveo" in "Reveo Route
 * d'Espagne"); a site name shares some of its words and adds its own.
 */
export function siteName(network: string, station: string, owner = ""): boolean {
	if (/ - |^\s*\d+\s*$/.test(network)) return true;
	const n = normaliseName(network);
	if (n === normaliseName(station)) return true;
	// The owner's own name is the host's ("CENTRAKOR"), its short form too ("ALDI" for "ALDI
	// MARCHE SARL"), and the owner's name and a place is one of its sites ("LPA Perrache").
	const o = normaliseName(owner);
	if (o && (n === o || n.startsWith(`${o} `) || o.startsWith(`${n} `))) return true;
	if (gluedSiteName(n, `${station} ${owner}`)) return true;
	const ours = new Set([...tokens(network)].filter((w) => !GENERIC.has(w)));
	const theirs = tokens(station);
	const shared = [...ours].filter((w) => theirs.has(w)).length;
	return shared > 0 && shared < ours.size;
}

/**
 * A site's words run together into one ("HCrequipublic" for the Hôtel Créqui): a word of the
 * station or owner, four letters or more, inside a word of the network with something else
 * beside it. A brand written in one word ("TotalEnergies" beside "Total Energies") is made of
 * those words alone.
 */
function gluedSiteName(network: string, theirs: string): boolean {
	const words = normaliseName(theirs).split(" ").filter(Boolean);
	return network.split(" ").some((w) => {
		if (!words.some((t) => t.length >= 4 && t !== w && w.includes(t))) return false;
		let rest = w;
		for (const t of words) if (t !== w) rest = rest.replace(t, "");
		return rest !== "";
	});
}

const decimals = (v: string) => /\.(\d+)$/.exec(v)?.[1].length ?? 0;

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

/** "Accessible de 9h à 18h": a stay limit ("1h maximum") or "24h/24" is not a span. */
const STATED_HOURS = /\b\d{1,2} ?(?:h|:)(?:\d{2})?\s*(?:à|a|-|–)\s*\d{1,2} ?(?:h|:)/i;

const has = (r: Row, field: string) => truthy(str(r, field));

/** A type 2 point with its cable attached is `socket:type2_cable`, not a socket. */
const cable = (r: Row) => has(r, "cable_t2_attache");

const SOCKETS: [string, string, (r: Row) => boolean][] = [
	["socket:type2", "prise_type_2", (r) => !cable(r)],
	["socket:type2_cable", "prise_type_2", cable],
	["socket:type2_combo", "prise_type_combo_ccs", () => true],
	["socket:chademo", "prise_type_chademo", () => true],
	["socket:typee", "prise_type_ef", () => true],
];

/** Each socket type's listed points, for matching only. */
const listedSockets = (rows: Row[]) =>
	SOCKETS.map(([k, field, only]) => ({
		k,
		v: String(rows.filter((r) => has(r, field) && only(r)).length),
	})).filter((s) => s.v !== "0");

const DC = ["prise_type_combo_ccs", "prise_type_chademo"];

/** How many connector types a point carries. */
const kinds = (r: Row) =>
	new Set(SOCKETS.filter(([, f, only]) => has(r, f) && only(r)).map(([, f]) => f)).size +
	(has(r, "prise_type_autre") ? 1 : 0);

const CONNECTORS = [
	"prise_type_2",
	"prise_type_combo_ccs",
	"prise_type_chademo",
	"prise_type_ef",
	"prise_type_autre",
];

/** A connector the schema has a column for, rather than "autre". */
const named = (r: Row) => SOCKETS.some(([, f]) => has(r, f));

/**
 * A point's newest row, with the connectors of an older declaration of it when the newest
 * names none: e-Totem's consolidated rows tick only "autre" on DC points its own file lists as
 * CCS, and some rows tick nothing at all.
 */
function withNamedConnectors(r: Row, history: Row[]): Row {
	if (named(r)) return r;
	const older = history.find(named);
	return older
		? { ...r, ...Object.fromEntries([...CONNECTORS, "cable_t2_attache"].map((f) => [f, older[f]])) }
		: r;
}

/**
 * A site moved to another operator's file keeps its points' numbers under the new operator's
 * prefix (EV Cars' FREVCE9009501 is Allego's FRALLEGO9009501). Seven digits are no accident
 * that close; under one operator they are its own numbering, and the site can have moved as far
 * as any re-declaration.
 */
const TAIL_M = 100;

/**
 * One car park declared as a station and its points as stations of their own a few metres apart
 * under its name or address (Bouygues spreads B612's eleven points along a line, 8 m apart).
 */
const SAME_SITE_M = 60;

/**
 * How far a station's point may sit from its own housenumber before the address is taken over
 * the point. It is where its operator placed it, often in a car park well away from the
 * address's door, so only a coarse one (`COARSE_DECIMALS`) is moved.
 */
const STATION_FAR_M = 100;

/** Four decimals is 11 m: a registry writing so few rounded a geocoded point, or typed it. */
const COARSE_DECIMALS = 4;

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
	link(r, record) {
		const point = pointOf(r);
		const who = operatorOf(r);
		const tail = point ? TAIL.exec(point)?.[0] : undefined;
		const name = normaliseName(str(r, "nom_station"));
		const address = normaliseName(str(r, "adresse_station"));
		const lone =
			new Set(record.map(pointOf)).size === 1 &&
			record.every((x) => !(Number.parseInt(str(x, "nbre_pdc"), 10) > 1));
		const ids: SiteLink[] = [];
		if (point) ids.push({ id: point, withinM: LINK_M });
		if (tail)
			ids.push(
				{ id: `tail ${tail}`, withinM: TAIL_M },
				{ id: `tail ${who} ${tail}`, withinM: LINK_M },
			);
		if (name) ids.push({ id: `name ${who} ${name}`, withinM: SAME_SITE_M, lone });
		if (address) ids.push({ id: `address ${who} ${address}`, withinM: SAME_SITE_M, lone });
		return ids;
	},
	extract(declared, url) {
		const current = currentStations(declared);
		// A newer declaration often leaves out what an older one of the same points said (an
		// aggregator's copy of an operator's file drops its notes and tariff).
		const own = declarationsOf(onePerPoint(current.flatMap((s) => s.rows)), declared);
		const history = new Map([...own].map(([r, h]) => [withNamedConnectors(r, h), h]));
		const rows = [...history.keys()];
		const recovered = [...own.keys()].filter((r) => !history.has(r)).length;
		const first = rows[0];
		const pos = stationPosition(first);
		// The key `mergeSites` gave the record, whichever station is newest.
		const key = declared
			.map(stationKey)
			.filter((k) => k !== null)
			.sort((a, b) => a.localeCompare(b))[0];
		if (!pos || !key) return null;
		const t = new Tags(first);

		// A row is a charge point whether or not the operator gave it an id ("Non concerné").
		const points = new Set(rows.map((r, i) => pointOf(r) ?? `row ${i}`)).size;
		const stations = current.map((s) => s.id).filter(Boolean);
		const counts = current.map(
			(s) =>
				new Set(s.rows.map((r) => Number.parseInt(str(r, "nbre_pdc"), 10)).filter((n) => n > 0)),
		);
		const declaredCount = counts.length === 1 && counts[0].size === 1 ? [...counts[0]][0] : 0;
		const oneRows = current.flatMap((s) => (s.oneRow && s.n ? [s.n] : []));
		// A lone station whose rows disagree on its count, or whose count is not the points it
		// lists, may list only some of them. On a site of several stations the listed points
		// stand: operators fill `nbre_pdc` with 1 on every station of a car park.
		const unsure =
			current.length === 1 &&
			!oneRows.length &&
			(counts[0].size > 1 || (counts[0].size === 1 && !counts[0].has(current[0].rows.length)));
		// A DC cabinet's type 2 outlet is declared as a point of its own at the cabinet's power
		// (180 kW), and is not a bay of its own. A station of type 2 points alone at that power
		// is an AC station declared at its feed's power, and its points are bays.
		const withDc = new Set(rows.filter((r) => DC.some((f) => has(r, f))).map(stationKey));
		const acOnDc = rows.filter(
			(r) =>
				withDc.has(stationKey(r)) &&
				pointOf(r) &&
				has(r, "prise_type_2") &&
				kinds(r) === 1 &&
				Number(str(r, "puissance_nominale")) > MAX_KW["socket:type2"],
		).length;
		const capacity = unsure
			? 0
			: points - oneRows.length + oneRows.reduce((a, n) => a + n, 0) - acOnDc || declaredCount;
		const oneRow = oneRows.length > 0;
		const notes: string[] = [];
		if (oneRow)
			notes.push(
				current.length === 1
					? `The registry declares ${declaredCount} charge points as a single row, so their sockets are left out`
					: oneRows.length === 1
						? "1 of the site's stations is declared as a single row, so sockets are left out"
						: `${oneRows.length} of the site's stations are each declared as a single row, so sockets are left out`,
			);
		if (unsure)
			notes.push(
				`The registry declares ${[...counts[0]].sort((a, b) => a - b).join(" and ")} charge points and lists ${current[0].rows.length}, so capacity and sockets are left out`,
			);

		t.add("amenity", "charging_station", 0.95, "id_station_itinerance");
		// Registry names are legal entities and shouting brands ("TotalEnergies Marketing
		// France", "Reveo"), so they fill a gap but never replace what a mapper wrote.
		const operatorField = str(first, "nom_operateur") ? "nom_operateur" : "nom_amenageur";
		const operator = str(first, operatorField);
		const network = str(first, "nom_enseigne");
		fill(t.add("operator", operator, 0.85, operatorField));
		// An older declaration's station or owner can be what the newest calls its network
		// (Howdens on ZEENCO's 366F-Toulouse, whose owner was "Howdens Toulouse"), but an owner that
		// was its own operator ("ENGIE Vianeo" twice) is the network's company, not a host.
		const host = (r: Row) => {
			const owner = str(r, "nom_amenageur");
			return company(owner) === operatorOf(r) ? "" : owner;
		};
		if (
			normaliseName(network) !== normaliseName(operator) &&
			!DESCRIBED_NETWORK.test(network) &&
			!siteName(network, str(first, "nom_station"), str(first, "nom_amenageur")) &&
			!declared.some((r) => siteName(network, str(r, "nom_station"), host(r)))
		)
			fill(t.add("network", network, 0.8, "nom_enseigne"));
		// `nbre_pdc` is what the operator declared for one of the stations merged here, and the
		// distinct points are what the rows show; quote the one the value really is.
		if (capacity && str(first, "nbre_pdc") === String(capacity))
			t.add("capacity", String(capacity), 0.85, "nbre_pdc");
		else if (capacity)
			t.add(
				"capacity",
				String(capacity),
				0.8,
				"id_pdc_itinerance",
				acOnDc
					? `${points} distinct, ${acOnDc} of them type 2 alone above 43.5 kW`
					: `${capacity} distinct`,
				"derived",
			);
		const pools = [...new Set(stations.map(poolId).filter((v) => v !== null))].join(";");
		// A mapper's pool id is often finer than the registry's (PLYON13011 under PLYON130), and
		// matching already reads both, so a differing id is never overwritten.
		if (pools.length <= OSM_MAX)
			fill(t.add("ref:EU:EVSE", pools, 0.95, "id_station_itinerance", stations.join(";")));

		const absent: string[] = [];
		// The schema gives one power per charge point and none per connector. That power is a
		// connector's only when the point has that connector alone, or when it is the CCS of a
		// DC unit: the type 2 cable on a 300 kW unit is AC, 22–43 kW, and CHAdeMO beside CCS
		// tops out near 50–100 kW. One point where the power cannot be pinned on this type and
		// the type gets no output, rather than a guess.
		// Absence is read over every declaration: two of one point can disagree on its
		// connectors, and only what none of them lists is known to be missing.
		// A declaration ticking every connector type on every point says nothing about any.
		const everything = rows.every((r) => CONNECTORS.every((f) => has(r, f)));
		if (everything)
			notes.push("The registry ticks every connector type on every point, so sockets are left out");
		// A point naming no connector may carry any, so no type's count is known to be whole,
		// nor any type known to be missing.
		const blank = oneRow || unsure ? 0 : rows.filter((r) => kinds(r) === 0).length;
		if (blank)
			notes.push(
				blank === rows.length
					? "None of its charge points names a connector, so sockets are left out"
					: `${blank} of its ${rows.length} charge points name no connector, so sockets are left out`,
			);
		if (recovered)
			notes.push(
				`The registry's newest declaration names no connector on ${recovered} of its charge points; their connectors are an older declaration's`,
			);
		for (const [k, field, only] of oneRow || everything || unsure || blank ? [] : SOCKETS) {
			const carrying = rows.filter((r) => has(r, field) && only(r));
			if (carrying.length === 0) {
				if (!declared.some((r) => has(r, field) && only(r))) absent.push(k);
				continue;
			}
			t.add(
				k,
				String(carrying.length),
				0.9,
				field,
				`true on ${carrying.length} of ${rows.length} points`,
				"derived",
			);
			const shared = carrying.some((r) => kinds(r) > 1);
			if (shared && k !== "socket:type2_combo") continue;
			const power = Math.max(0, ...carrying.map((r) => Number(str(r, "puissance_nominale")) || 0));
			if (power === 0 || power > (MAX_KW[k] ?? Number.POSITIVE_INFINITY)) continue;
			t.add(
				`${k}:output`,
				POWER_KW(power),
				shared ? 0.7 : 0.8,
				"puissance_nominale",
				String(power),
				"derived",
			);
		}
		if (!unsure && !blank && !declared.some((r) => has(r, "prise_type_autre"))) {
			absent.push(...OTHER_SOCKETS);
			// `prise_type_ef` is an E/F outlet, and F is Schuko: the registry cannot tell which.
			if (!declared.some((r) => has(r, "prise_type_ef"))) absent.push("socket:schuko");
		}
		if (!everything && rows.some((r) => has(r, "prise_type_autre")))
			notes.push(
				"The registry lists connectors of another type on this station, which it does not name",
			);

		const said = (field: string) =>
			rows.map((r) => str(history.get(r)?.find((h) => str(h, field)) ?? r, field)).filter(Boolean);
		const ever = (field: string) =>
			[...history.values()]
				.flat()
				.map((r) => str(r, field))
				.filter(Boolean);

		// `gratuit` is "free with no condition of use", so false means some users pay, which is
		// `fee=yes` (FR:Tag:amenity=charging_station). Free beside a price contradicts itself.
		const gratuit = said("gratuit");
		const price = said("tarification").find(isPrice);
		const tariff = said("tarification").find(isTariff);
		const paidBy = ["paiement_acte", "paiement_cb"].find((f) =>
			rows.some((r) => truthy(str(r, f))),
		);
		if (gratuit.length === rows.length && gratuit.every(truthy)) {
			if (!price) t.add("fee", "no", 0.8, "gratuit", "true", "derived");
		} else if (gratuit.some((g) => !truthy(g)))
			t.add(
				"fee",
				"yes",
				0.8,
				"gratuit",
				gratuit.find((g) => !truthy(g)),
				"derived",
			);
		else if (paidBy) t.add("fee", "yes", 0.75, paidBy, "true", "derived");
		else if (tariff) t.add("fee", "yes", 0.7, "tarification", tariff, "derived");

		// "Accès réservé" covers a shop's customers, residents, employees and a network's
		// subscribers alike (customers, private, no standard value), so it proposes nothing.
		// "Accès libre" only fills a gap: it is too coarse to overrule a mapper's survey.
		const access = str(first, "condition_acces");
		if (/libre/i.test(access))
			fill(t.add("access", "yes", 0.8, "condition_acces", access, "derived"));

		// Operators fill `horaires` with 24/7 by default and write the real hours in their notes,
		// and a site whose stations give different hours has no one value.
		const hours = new Set(
			current
				.map((s) => str(s.rows[0], "horaires"))
				.filter(Boolean)
				.map(openingHours),
		);
		const hoursOk = hours.size === 1 && [...hours][0];
		if (hoursOk && !rows.some((r) => STATED_HOURS.test(str(r, "observations"))))
			t.add("opening_hours", hoursOk, 0.7, "horaires");

		const anyRow = (f: string) => rows.some((r) => truthy(str(r, f)));
		const twoWheels = new Set(ever("station_deux_roues").map(truthy));
		const twoWheel = twoWheels.has(true);
		// A flag the station's own name, its fast connectors or another declaration contradicts
		// says nothing.
		const named = TWO_WHEEL_NAME.test(str(first, "nom_station"));
		const fast = anyRow("prise_type_combo_ccs") || anyRow("prise_type_chademo");
		if (twoWheels.size < 2 && (twoWheel ? !fast : !named))
			fill(
				t.add(
					twoWheel ? "motorcycle" : "motorcar",
					"yes",
					0.75,
					"station_deux_roues",
					str(first, "station_deux_roues") || "false",
					"derived",
				),
			);
		// Paying per session is "without identification or subscription" in the schema, which
		// operators stretch to their own app or badge; their note then says so.
		const notesText = [...ever("observations"), ...ever("tarification")];
		if (anyRow("paiement_acte") && !notesText.some((n) => NEEDS_ACCOUNT.test(n)))
			fill(t.add("authentication:none", "yes", 0.7, "paiement_acte", "true", "derived"));
		if (anyRow("paiement_cb"))
			fill(t.add("payment:credit_cards", "yes", 0.75, "paiement_cb", "true", "derived"));
		const bookings = new Set(
			rows
				.map((r) => str(r, "reservation"))
				.filter(Boolean)
				.map(truthy),
		);
		if (bookings.size === 1)
			fill(
				t.add(
					"reservation",
					[...bookings][0] ? "yes" : "no",
					0.7,
					"reservation",
					str(first, "reservation"),
					"derived",
				),
			);
		// Every declaration on this site: a newer one often leaves the commissioning date out.
		const since = serviceDate(
			declared.filter((r) => {
				const at = stationPosition(r);
				return !!at && distance(at[0], at[1], pos[0], pos[1]) <= LINK_M;
			}),
		);
		if (since) fill(t.add("start_date", since, 0.7, "date_mise_en_service", since));
		const owner = str(first, "nom_amenageur");
		if (normaliseName(owner) !== normaliseName(operator) && !SLUG.test(owner))
			fill(t.add("owner", owner, 0.7, "nom_amenageur"));
		const phone = operatorPhone(str(first, "telephone_operateur"));
		if (phone)
			fill(t.add("operator:phone", phone, 0.7, "telephone_operateur", undefined, "normalised"));
		const agreed = rows.every(
			(r) =>
				new Set((history.get(r) ?? [r]).map((h) => wheelchair(str(h, "accessibilite_pmr"))))
					.size === 1,
		);
		const pmr = agreed ? stationWheelchair(rows) : null;
		if (pmr) fill(t.add("wheelchair", pmr, 0.7, "accessibilite_pmr", undefined, "derived"));
		const height = str(first, "restriction_gabarit").replace(",", ".");
		if (/^\d(\.\d+)?$/.test(height) && Number(height) >= 1.5)
			fill(t.add("maxheight", String(Number(height)), 0.7, "restriction_gabarit"));

		const raw = rawCoords(first);
		const precision = raw ? Math.min(...raw.map(decimals)) : 0;
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
			tags: t.list,
			fit: unsure && !oneRow && !everything && !blank ? listedSockets(rows) : undefined,
			absent,
			notes,
			geocode: str(first, "adresse_station")
				? {
						q: addressQuery(addr, "", ""),
						farM: precision <= COARSE_DECIMALS ? STATION_FAR_M : Number.POSITIVE_INFINITY,
					}
				: undefined,
		};
	},
};
