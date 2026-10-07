import { OSM_MAX } from "$lib/changeset";
import type { TagFunction } from "../mapping/evaluate";
import { openingHours, truthy } from "../row";
import { normaliseName, tokens } from "../text";
import { company, NOT_A_POINT } from "./irve-declarations";
import { defaultSite, has, type In, type Site } from "./irve-site";
import { readSockets } from "./irve-sockets";
import { digits, mobileFR, phoneFR } from "./text";

const siteOf = (rows: In[], site: unknown) => (site as Site | undefined) ?? defaultSite(rows);

/** A slug is a web address's, not anybody's name ("hotel-crequi-lyon"). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** "Réseau de recharge Virta Public": what the network is, not its name. */
const DESCRIBED_NETWORK = /^r[ée]seau de (re)?charge\b/i;

/** Words any station's name may hold, which say nothing about whose site it is. */
const GENERIC = new Set(["borne", "bornes", "recharge", "charge", "station", "stations", "irve"]);

/** A station named for two-wheelers, whatever its flag says. */
const TWO_WHEEL_NAME = /deux[- ]roues|2[- ]roues|\bmotos?\b|scooter|v[ée]los?\b/i;

/** An operator's note that per-session payment goes through its own app, badge or account. */
const NEEDS_ACCOUNT = /\b(app|appli|application|badge|abonnement|compte|rfid|lidl plus|emsp)\b/i;

/** "Accessible de 9h à 18h": a stay limit ("1h maximum") or "24h/24" is not a span. */
const STATED_HOURS = /\b\d{1,2} ?(?:h|:)(?:\d{2})?\s*(?:à|a|-|–)\s*\d{1,2} ?(?:h|:)/i;

/** Filler numbers some operators declare when they have none to give: `+33 1 23 45 67 89`, `+33 1 00 00 00 00`. */
const PLACEHOLDER_PHONE = /^0\d(23456789|(\d)\2{7})$/;

/**
 * A station's `ref:EU:EVSE` is its pool id, written the way French mappers and the EVSE id
 * standard do: `FR*TLS*P31555019`. Point ids (`E`) belong on charge points, not here, and an
 * id outside the standard shape is the operator's own, so neither is proposed.
 */
export function poolId(raw: string): string | null {
	const m = /^([A-Z]{2})\*?([A-Z0-9]{3})\*?(P[A-Z0-9*]+)$/i.exec(raw.replace(/\s/g, ""));
	return m ? `${m[1]}*${m[2]}*${m[3]}`.toUpperCase() : null;
}

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

const operatorIn = (r: In) => company(r.operator_name || r.owner_name);

const network: TagFunction = (_, rows, site) => {
	const first = rows[0];
	const operator = first.operator_name || first.owner_name;
	// An older declaration's station or owner can be what the newest calls its network
	// (Howdens on ZEENCO's 366F-Toulouse, whose owner was "Howdens Toulouse"), but an owner that
	// was its own operator ("ENGIE Vianeo" twice) is the network's company, not a host.
	const host = (r: In) => (company(r.owner_name) === operatorIn(r) ? "" : r.owner_name);
	return normaliseName(first.brand) !== normaliseName(operator) &&
		!DESCRIBED_NETWORK.test(first.brand) &&
		!siteName(first.brand, first.station_name, first.owner_name) &&
		!siteOf(rows, site).declared.some((r) => siteName(first.brand, r.station_name, host(r)))
		? { network: first.brand }
		: {};
};

const capacity: TagFunction = (_, rows, site) => {
	const answer = readSockets(rows, siteOf(rows, site)).capacity;
	return answer ? { capacity: answer } : {};
};

const sockets: TagFunction = (_, rows, site) => readSockets(rows, siteOf(rows, site)).sockets;

const pool: TagFunction = (_, rows, site) => {
	const { current, declared } = siteOf(rows, site);
	const stations = current.map((s) => s.id).filter(Boolean);
	const pools = [...new Set(stations.map(poolId).filter((v) => v !== null))].join(";");
	// Every id ever declared here, a station since declared again included: a mapper may have
	// copied any of them.
	const known = [
		...new Set(
			declared.flatMap((r) =>
				[r.station_id, r.point_id].filter((id) => id && !NOT_A_POINT.test(id)),
			),
		),
	].join(";");
	// A mapper's pool id is often finer than the registry's (PLYON13011 under PLYON130), and
	// matching already reads both, so a differing id is never overwritten.
	return {
		"ref:EU:EVSE": {
			value: pools && pools.length <= OSM_MAX ? pools : "",
			ref: known,
			evidence: { input: "station_id", shown: stations.join(";") },
		},
	};
};

const hours: TagFunction = (_, rows, site) => {
	// Operators fill the hours with 24/7 by default and write the real hours in their notes,
	// and a site whose stations give different hours has no one value.
	const stated = new Set(
		siteOf(rows, site)
			.current.map((s) => s.rows[0].hours)
			.filter(Boolean)
			.map(openingHours),
	);
	const one = stated.size === 1 && [...stated][0];
	return one && !rows.some((r) => STATED_HOURS.test(r.notes)) ? { opening_hours: one } : {};
};

const ever = (site: Site, input: string) =>
	site.history
		.flat()
		.map((r) => r[input] ?? "")
		.filter(Boolean);

const vehicle: TagFunction = (_, rows, site) => {
	const first = rows[0];
	const twoWheels = new Set(ever(siteOf(rows, site), "two_wheelers").map(truthy));
	const twoWheel = twoWheels.has(true);
	// A flag the station's own name, its fast connectors or another declaration contradicts
	// says nothing.
	const fast = rows.some((r) => has(r, "socket_ccs") || has(r, "socket_chademo"));
	if (twoWheels.size >= 2 || (twoWheel ? fast : TWO_WHEEL_NAME.test(first.station_name))) return {};
	return {
		[twoWheel ? "motorcycle" : "motorcar"]: {
			value: "yes",
			evidence: { input: "two_wheelers", shown: first.two_wheelers || "false", kind: "derived" },
		},
	};
};

const authentication: TagFunction = (_, rows, site) => {
	// Paying per session is "without identification or subscription" in the schema, which
	// operators stretch to their own app or badge; their note then says so.
	const said = [...ever(siteOf(rows, site), "notes"), ...ever(siteOf(rows, site), "tariff")];
	return rows.some((r) => has(r, "pay_per_session")) && !said.some((n) => NEEDS_ACCOUNT.test(n))
		? {
				"authentication:none": {
					value: "yes",
					evidence: { input: "pay_per_session", shown: "true", kind: "derived" },
				},
			}
		: {};
};

/**
 * The earliest commissioning date. A bare 1 January is how several operators fill a date they
 * do not have, so it is left out rather than written as history.
 */
const serviceDate: TagFunction = (_, rows, site) => {
	const near = siteOf(rows, site).near;
	const dates = near
		.map((r) => /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(r.commissioning_date ?? ""))
		.flatMap((m) => (m ? [`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`] : []))
		.filter((d) => !d.endsWith("-01-01"))
		.sort();
	const since = dates[0];
	if (!since) return {};
	// A date after a declaration of the station was made (e-Totem's 2026-07-28 on a station in
	// its own file since 2025-06-17) is a plan, or a re-commissioning, not when it opened.
	// `created_at` is not a declaration's date: every row of one file carries the file's.
	const declared = near
		.map((r) => r.declared_on ?? "")
		.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
		.sort()[0];
	return declared && since > declared
		? {}
		: { start_date: { value: since, evidence: { input: "commissioning_date", shown: since } } };
};

/**
 * A site merged from stations of several owners (an AC car park and the DC units another
 * company owns beside it) has no one owner.
 */
const owner: TagFunction = (_, rows) => {
	const first = rows[0];
	const owners = new Set(rows.map((r) => normaliseName(r.owner_name)).filter(Boolean));
	const operator = first.operator_name || first.owner_name;
	return owners.size === 1 &&
		normaliseName(first.owner_name) !== normaliseName(operator) &&
		!SLUG.test(first.owner_name)
		? { owner: first.owner_name }
		: {};
};

/**
 * A mobile is usually somebody's own line, not the operator's. The column is numeric in some
 * operators' spreadsheets, which drops a leading 0 (`374090105`) or a `+` (`33975891501`).
 */
function operatorPhone(raw: string): string | null {
	const written = raw.replace(/^tel:/i, "").trim();
	const d = written.replace(/[\s.\-()]/g, "");
	const phone = phoneFR(
		/^[1-9]\d{8}$/.test(d) ? `0${d}` : /^33[1-9]\d{8}$/.test(d) ? `+${d}` : written,
	);
	return !phone || PLACEHOLDER_PHONE.test(digits(phone)) || mobileFR(phone) ? null : phone;
}

const phone: TagFunction = ({ operator_phone }) => {
	const written = operatorPhone(operator_phone);
	return written
		? {
				"operator:phone": {
					value: written,
					evidence: { input: "operator_phone", kind: "normalised" },
				},
			}
		: {};
};

/** Only an answer the registry actually gives: "Accessibilité inconnue" proposes nothing. */
function wheelchairOf(raw: string): string | null {
	if (/^réservé pmr/i.test(raw)) return "designated";
	if (/^accessible/i.test(raw)) return "yes";
	if (/^non accessible/i.test(raw)) return "no";
	return null;
}

/**
 * The station's accessibility from all its points: designated only when every point is
 * reserved, yes when some are and the rest accessible, nothing when some are not accessible.
 */
function stationWheelchair(rows: In[]): string | null {
	const each = rows.map((r) => wheelchairOf(r.wheelchair_access));
	if (each.some((v) => v === null)) return null;
	if (each.every((v) => v === "designated")) return "designated";
	if (each.every((v) => v === "designated" || v === "yes")) return "yes";
	return each.every((v) => v === "no") ? "no" : null;
}

const wheelchair: TagFunction = (_, rows, site) => {
	const { history } = siteOf(rows, site);
	const agreed = rows.every(
		(r, i) => new Set((history[i] ?? [r]).map((h) => wheelchairOf(h.wheelchair_access))).size === 1,
	);
	const pmr = agreed ? stationWheelchair(rows) : null;
	return pmr
		? { wheelchair: { value: pmr, evidence: { input: "wheelchair_access", kind: "derived" } } }
		: {};
};

export const chargingFunctions: Record<string, TagFunction> = {
	"fr.charging_station/network": network,
	"fr.charging_station/capacity": capacity,
	"any.charging_station/poolId": pool,
	"any.charging_station/sockets": sockets,
	"fr.charging_station/openingHours": hours,
	"fr.charging_station/vehicle": vehicle,
	"fr.charging_station/authentication": authentication,
	"fr.charging_station/serviceDate": serviceDate,
	"fr.charging_station/owner": owner,
	"fr/phone": phone,
	"fr.charging_station/wheelchair": wheelchair,
};
