import { fmtDate } from "$lib/format";
import { distance, houseNumber, normaliseName, spacedNumber, tokens } from "./geo";
import { openingHours as parsedHours } from "./llm";
import type { Extraction, ProposedTag, Row } from "./types";

/** First non-empty value among the field names a dataset has used for the same thing. */
export function str(row: Row, ...names: string[]): string {
	for (const n of names) {
		const v = row[n];
		if (v === null || v === undefined) continue;
		const s = String(v).trim();
		if (s) return s;
	}
	return "";
}

const truthy = (v: string) => /^(true|1|oui|yes|vrai)$/i.test(v);

function coord(lat: unknown, lon: unknown): [number, number] | null {
	const a = Number(lat);
	const o = Number(lon);
	if (lat === "" || lon === "" || lat == null || lon == null) return null;
	if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180)
		return null;
	if (a === 0 && o === 0) return null;
	return [a, o];
}

/** Latitude and longitude from the shapes Opendatasoft and CSV exports give a point. */
export function findCoords(row: Row): [number, number] | null {
	for (const [la, lo] of [
		["latitude", "longitude"],
		["lat", "lon"],
		["lat", "lng"],
	]) {
		const c = coord(row[la], row[lo]);
		if (c) return c;
	}
	for (const f of ["position", "geo_point_2d", "geom", "geopoint", "coordonnees", "geometry"]) {
		const v = row[f];
		if (v && typeof v === "object") {
			const o = v as Record<string, unknown>;
			const c = coord(o.lat ?? o.latitude, o.lon ?? o.lng ?? o.longitude);
			if (c) return c;
			const g = o.coordinates;
			if (Array.isArray(g)) {
				const c2 = coord(g[1], g[0]);
				if (c2) return c2;
			}
		}
		if (typeof v === "string") {
			const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(v);
			if (m) {
				const c = coord(m[1], m[2]);
				if (c) return c;
			}
		}
	}
	return null;
}

export function phoneFR(raw: string): string | null {
	let d = raw.replace(/\(0\)/, "").replace(/[\s.\-()]/g, "");
	if (d.startsWith("+33")) d = `0${d.slice(3)}`;
	else if (d.startsWith("0033")) d = `0${d.slice(4)}`;
	if (!/^0[1-9]\d{8}$/.test(d)) return null;
	return `+33 ${d[1]} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
}

export function website(raw: string): string | null {
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	try {
		const u = new URL(withScheme);
		if (!u.hostname.includes(".")) return null;
		u.hash = "";
		return u.toString().replace(/\/$/, u.pathname === "/" && !u.search ? "" : "/");
	} catch {
		return null;
	}
}

export interface Preset {
	id: string;
	label: string;
	/** The column the source's own stable id lives in, which is also how a record is looked up again. */
	keyField: string;
	detect(columns: string[]): boolean;
	key(row: Row): string | null;
	position(row: Row): [number, number] | null;
	/**
	 * `rows` are every row that shares the key; `url` is the record's own address; `gaps`, for
	 * a key at several sites, how far each row's address lies from its point (`addressGaps`).
	 */
	extract(rows: Row[], url: string, gaps?: Map<Row, number>): Extraction | null;
	/** What to ask the address base for one row's own address, for a key at several sites. */
	siteQuery?(row: Row): string | null;
	/** Records whose rows give the same site are one place, whatever their keys say. */
	site?(row: Row): string | null;
	/**
	 * What names one thing in every declaration of it (a charge point's id), so records sharing
	 * one close enough are one site even where their keys and positions differ. `record` is
	 * every row of the record `row` belongs to.
	 */
	link?(row: Row, record: Row[]): SiteLink[];
}

export interface SiteLink {
	id: string;
	/** How far apart two declarations of it can be placed. */
	withinM: number;
	/**
	 * Set where the id names a place rather than a thing (a station's name): records sharing it
	 * join only when one of them is a lone charge point, the way some operators declare each
	 * point of a car park as a station, and two stations of one name otherwise stay two.
	 */
	lone?: boolean;
}

/**
 * How far apart two declarations of one site can be placed. A re-declared site's position is
 * sometimes retyped (Tisséo Balma-Gramont moved 200 m in 2024 on two transposed digits).
 */
const LINK_M = 400;

/**
 * Some operators declare every charge point of a car park as a station of its own, which
 * would make one candidate per point, all on the same spot, and a site re-declared under new
 * station ids keeps some of its point ids, often at a slightly different position. Records on
 * one site become one, under the smallest key, so an existing candidate keeps its id and the
 * others are swept as gone.
 */
export function mergeSites<R extends { key: string; rows: Row[] }>(
	records: R[],
	preset: Preset | null | undefined,
): R[] {
	const site = preset?.site;
	if (!preset || !site) return records;
	const bySite = new Map<string, R>();
	const out: R[] = [];
	for (const rec of [...records].sort((a, b) => a.key.localeCompare(b.key))) {
		const s = rec.rows[0] ? site(rec.rows[0]) : null;
		const into = s ? bySite.get(s) : undefined;
		if (into) {
			into.rows.push(...rec.rows);
			continue;
		}
		const own = { ...rec, rows: [...rec.rows] };
		if (s) bySite.set(s, own);
		out.push(own);
	}
	const link = preset.link;
	if (!link) return out;

	// `out` is in key order, so the root a record joins is always the one with the smaller key.
	const root = new Map<R, R>();
	const find = (r: R): R => {
		const up = root.get(r);
		return up ? find(up) : r;
	};
	const holders = new Map<string, { rec: R; at: [number, number]; lone?: boolean }[]>();
	for (const rec of out)
		for (const row of rec.rows) {
			const at = preset.position(row);
			if (!at) continue;
			for (const { id, withinM, lone } of link(row, rec.rows)) {
				const seen = holders.get(id) ?? [];
				for (const other of seen) {
					const a = find(other.rec);
					const b = find(rec);
					if (a === b || distance(at[0], at[1], other.at[0], other.at[1]) > withinM) continue;
					if (lone === false && other.lone === false) continue;
					if (out.indexOf(a) < out.indexOf(b)) root.set(b, a);
					else root.set(a, b);
				}
				if (!seen.some((o) => o.rec === rec)) holders.set(id, [...seen, { rec, at, lone }]);
			}
		}
	for (const rec of out) {
		const r = find(rec);
		if (r !== rec) r.rows.push(...rec.rows);
	}
	return out.filter((r) => find(r) === r);
}

class Tags {
	readonly list: ProposedTag[] = [];
	constructor(private readonly row: Row) {}

	/** `field` names where `value` was read, and is what the evidence row quotes. */
	add(k: string, v: string, conf: number, field: string, shown?: string, kind = "dataset row") {
		if (!v) return;
		const value = shown ?? str(this.row, field);
		const tag: ProposedTag = {
			k,
			v,
			conf,
			path: field,
			kind,
			parts: [
				{ text: `${field}: `, mark: false },
				{ text: value || "—", mark: true },
			],
		};
		this.list.push(tag);
		return tag;
	}
}

/** Proposed only where OSM has nothing: the source is too coarse to overrule a mapper. */
const fill = (tag: ProposedTag | undefined) => {
	if (tag) tag.addOnly = true;
};

/** Already written in OSM's day tokens: the parser reads plain English too, "Monday to Friday" as open all day. */
const OPENING_HOURS = /^(24\/7|(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?![a-z])[A-Za-z0-9:,;\-+ /]*)$/;

/**
 * Registries write "all day" as the last minute they count to, and some spell every day
 * out: `Mo 00:00-23:59, Tu 00:00-23:59, …`. The days are folded into ranges and checked by
 * OSM's own parser, which repairs `Mo-Fri:` and `Sat` and refuses what it cannot read.
 */
export function openingHours(raw: string): string | null {
	const v = raw
		.trim()
		.replace(/23:5\d\b/g, "24:00")
		.replace(/00:00-00:00/g, "00:00-24:00");
	if (/^24\/7$/i.test(v)) return "24/7";
	return OPENING_HOURS.test(v) ? parsedHours(v) : null;
}

/** What `prise_type_autre` covers: every connector the schema has no column of its own for. */
const OTHER_SOCKETS = [
	"socket:type1",
	"socket:type1_combo",
	"socket:type3",
	"socket:type3a",
	"socket:type3c",
	"socket:schuko",
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
export const POWER_KW = (n: number) => {
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

const NOT_A_POINT = /^non concern/i;

/**
 * A station's `ref:EU:EVSE` is its pool id, written the way French mappers and the EVSE id
 * standard do: `FR*TLS*P31555019`. Point ids (`E`) belong on charge points, not here, and an
 * id outside the standard shape is the operator's own, so neither is proposed.
 */
export function poolId(raw: string): string | null {
	const m = /^([A-Z]{2})\*?([A-Z0-9]{3})\*?(P[A-Z0-9*]+)$/i.exec(raw.replace(/\s/g, ""));
	return m ? `${m[1]}*${m[2]}*${m[3]}`.toUpperCase() : null;
}

/** OSM refuses a longer value, and the upload batch with it. */
export const OSM_MAX = 255;

const newest = (r: Row) => `${str(r, "date_maj")}|${str(r, "last_modified")}`;

/**
 * An EVSE id the way two declarations of one point or station are compared: without `*`, the
 * `E`/`P` type letter, or the `P` some files put before a connector's number
 * (`FRALLEGO002084P1` in 2023 is `FRALLEGO0020841` in 2024).
 */
export const evseId = (id: string) =>
	id
		.toUpperCase()
		.replace(/[\s*]/g, "")
		.replace(/^([A-Z]{2}[A-Z0-9]{3})[EP]/, "$1")
		.replace(/P(\d+)$/, "$1");

const pointOf = (r: Row) => {
	const id = str(r, "id_pdc_itinerance");
	return id && !NOT_A_POINT.test(id) ? evseId(id) : null;
};

/** Each point's newest row, newest first, so a station's single values are read from it. */
function onePerPoint(rows: Row[]): Row[] {
	const seen = new Set<string>();
	return [...rows]
		.sort((a, b) => newest(b).localeCompare(newest(a)))
		.filter((r) => {
			const id = pointOf(r);
			if (!id) return true;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
}

/**
 * Every declaration of each of `rows`' points, newest first: the same id, or the same number
 * under another operator's prefix.
 */
function declarationsOf(rows: Row[], declared: Row[]): Map<Row, Row[]> {
	const byNewest = [...declared].sort((a, b) => newest(b).localeCompare(newest(a)));
	const same = (p: string) => {
		const tail = TAIL.exec(p)?.[0];
		return (h: Row) => {
			const q = pointOf(h);
			return !!q && (q === p || (!!tail && TAIL.exec(q)?.[0] === tail));
		};
	};
	return new Map(
		rows.map((r) => {
			const p = pointOf(r);
			return [r, p ? byNewest.filter(same(p)) : [r]];
		}),
	);
}

interface Station {
	id: string;
	file: string;
	rows: Row[];
	points: Set<string>;
	latest: string;
	name: string;
	at: [number, number] | null;
	/** The point count its newest declaration gives, when it gives one. */
	n: number | null;
	/** Declared as a single row under its own id, standing for `n` points whose connectors are unknown. */
	oneRow: boolean;
}

/** A point's number without its operator's prefix, which a site moved to another operator's file keeps. */
const TAIL = /\d{7,}$/;

/** Within this, two declarations are on the same spot. */
const SAME_SPOT_M = 2;

/**
 * The consolidated file keeps every declaration a station has had: an operator's own file
 * beside its aggregator's, and older ones listing points since removed. Each station is read
 * from its newest declaration whole, by `date_maj` and then `last_modified` (an operator's file
 * and its aggregator's often share the day), rather than from a union that counts what no
 * longer exists.
 *
 * A station is gone when newer ones list all its points (a pool taking in the stations an
 * operator declared one per point), or a newer one in another file declares it again: some of
 * its points under the same name or the same count (Tisséo Balma-Gramont in 2023, 2024 and
 * 2026; Sowatt's EVBOX at MG Vénissieux), the same name and count on the same spot with none of
 * its points (Caliceo Sainte-Foy), or, for a station declared as one row, as many points as
 * it counted. A point the newer declaration left out was renumbered, so an older station still
 * listing it does not count it again. Stations of one file are one snapshot and never replace
 * each other; two sharing only some points otherwise both stay, and their points count once.
 */
function currentStations(rows: Row[]): Station[] {
	const file = (r: Row) => str(r, "datagouv_resource_id");
	const byId = new Map<string, Row[]>();
	for (const r of rows) {
		const id = irve.key(r) ?? "";
		byId.set(id, [...(byId.get(id) ?? []), r]);
	}
	const all = [...byId].map(([id, own]): Station => {
		const latest = own.reduce((a, r) => (newest(r) > newest(a) ? r : a), own[0]);
		const decl = onePerPoint(own.filter((r) => file(r) === file(latest)));
		const points = new Set(decl.map(pointOf).filter((p) => p !== null));
		const counts = new Set(decl.map((r) => Number.parseInt(str(r, "nbre_pdc"), 10)));
		const n = counts.size === 1 ? [...counts][0] : Number.NaN;
		return {
			id,
			file: file(latest),
			rows: decl,
			points,
			latest: newest(latest),
			name: normaliseName(str(latest, "nom_station")),
			at: irve.position(latest),
			n: n > 0 ? n : null,
			oneRow: decl.length === 1 && points.size === 1 && [...points][0] === evseId(id) && n > 1,
		};
	});
	// Some operators declare every point of a site as a station of its own and repeat the
	// site's total on each: as many one-row stations as each says there are, each one point.
	for (const f of new Set(all.map((s) => s.file))) {
		const ones = all.filter((s) => s.file === f && s.oneRow);
		if (ones.length > 1 && ones.every((s) => s.n === ones.length))
			for (const s of ones) {
				s.oneRow = false;
				s.n = 1;
			}
	}
	const listed = (t: Station, p: string) => {
		const tail = TAIL.exec(p)?.[0];
		return t.points.has(p) || (!!tail && [...t.points].some((q) => TAIL.exec(q)?.[0] === tail));
	};
	const shared = (t: Station, s: Station) => [...s.points].filter((p) => listed(t, p)).length;
	const sameSpot = (t: Station, s: Station) =>
		!!t.at && !!s.at && distance(t.at[0], t.at[1], s.at[0], s.at[1]) <= SAME_SPOT_M;
	const sameName = (t: Station, s: Station) => !!t.name && t.name === s.name;
	const sameCount = (t: Station, s: Station) => !!t.n && t.n === s.n;
	const redeclares = (t: Station, s: Station) =>
		t.file !== s.file &&
		(shared(t, s) > 0
			? sameName(t, s) || sameCount(t, s) || ![...s.points].some((p) => t.points.has(p))
			: sameName(t, s) && sameCount(t, s) && sameSpot(t, s));
	const gone = new Map<string, string>();
	const current = all.filter((s) => {
		const newer = all.filter((t) => t.latest > s.latest);
		const by = newer.find((t) => redeclares(t, s));
		if (by) {
			for (const p of s.points) if (!listed(by, p)) gone.set(p, by.latest);
			return false;
		}
		if (s.points.size && [...s.points].every((p) => newer.some((t) => listed(t, p)))) return false;
		if (!s.oneRow) return true;
		const later = newer.filter((t) => t.file !== s.file && !t.oneRow);
		return new Set(later.flatMap((t) => [...t.points])).size !== s.n;
	});
	for (const s of current) {
		s.rows = s.rows.filter((r) => {
			const p = pointOf(r);
			return !p || (gone.get(p) ?? "") <= s.latest;
		});
		s.points = new Set(s.rows.map(pointOf).filter((p) => p !== null));
	}
	return current.filter((s) => s.rows.length > 0);
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
export function stationAddress(raw: string, postcode: string, commune: string, insee = ""): string {
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

/** The coordinates `position` reads, as the registry wrote them. */
function rawCoords(r: Row): [string, string] | null {
	if (coord(r.consolidated_latitude, r.consolidated_longitude))
		return [str(r, "consolidated_latitude"), str(r, "consolidated_longitude")];
	const xy = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(str(r, "coordonneesXY"));
	return xy && coord(xy[2], xy[1]) ? [xy[2], xy[1]] : null;
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

/** Legal forms and trade words an operator's files add to its name or not ("ZEENCO e-mobility"). */
const COMPANY_NOISE =
	/\b(sas|sasu|sarl|sa|eurl|france|e mobility|emobility|marketing|charging|services|partner network)\b/g;

function company(name: string): string {
	const n = normaliseName(name);
	return n.replace(COMPANY_NOISE, " ").replace(/\s+/g, " ").trim() || n;
}

const operatorOf = (r: Row) => company(str(r, "nom_operateur") || str(r, "nom_amenageur"));

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

/** IRVE "statique" v2.3, consolidated: one row per charge point, grouped into one station. */
const irve: Preset = {
	id: "irve",
	label: "IRVE charging stations",
	keyField: "id_station_itinerance",
	detect: (c) => c.includes("id_station_itinerance") && c.includes("id_pdc_itinerance"),
	key(r) {
		const id = str(r, "id_station_itinerance");
		if (!NOT_A_POINT.test(id)) return id || null;
		// "Non concerné" names no station, and every row of an area saying so would be one record.
		const site = irve.site?.(r);
		return site ? `${id} ${site}` : null;
	},
	site(r) {
		const pos = irve.position(r);
		return pos ? `${pos[0].toFixed(6)},${pos[1].toFixed(6)}|${operatorOf(r)}` : null;
	},
	position(r) {
		const flag = str(r, "consolidated_is_lon_lat_correct");
		if (flag && !truthy(flag)) return null;
		const c = rawCoords(r);
		return c ? coord(c[0], c[1]) : null;
	},
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
		const pos = irve.position(first);
		// The key `mergeSites` gave the record, whichever station is newest.
		const key = declared
			.map(irve.key)
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
		const withDc = new Set(rows.filter((r) => DC.some((f) => has(r, f))).map(irve.key));
		const acOnDc = rows.filter(
			(r) =>
				withDc.has(irve.key(r)) &&
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
		const operator = str(first, "nom_operateur") || str(first, "nom_amenageur");
		const network = str(first, "nom_enseigne");
		fill(t.add("operator", operator, 0.85, "nom_operateur"));
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
		if (!unsure && !blank && !declared.some((r) => has(r, "prise_type_autre")))
			absent.push(...OTHER_SOCKETS);
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
				const at = irve.position(r);
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

/** Directory natures that are offices, not places anyone is taught. */
const NOT_A_SCHOOL = /^(service administratif|information et orientation)$/i;
const CIRCONSCRIPTION = "809";
/** "Écoles composées uniquement de STS et/ou CPGE": post-bac only. */
const POST_BAC_ONLY = "400";

/**
 * French OSM maps every level from the maternelle up as `amenity=school`, with the level in
 * `school:FR` (FR:Key:school:FR); `amenity=kindergarten` there is a crèche. Post-bac-only
 * schools are `amenity=college`. Null for a row that is not a school at all.
 *
 * Medico-social institutes (IME, ITEP, IES…) are in the directory for the classroom they
 * host, but are care facilities run under the Health ministry, and Toulouse and Lyon mappers
 * tag them `amenity=social_facility`. Whether one is a day centre or residential, which
 * `social_facility=*` would say, is not in the directory (`hebergement` is empty on all of
 * them), so that tag is left to the mapper. `social_facility:for` keeps to `disabled`: the
 * wiki documents no value for the blind or deaf.
 */
function schoolKind(r: Row): { amenity: string; level: string | null; for?: string } | null {
	const type = str(r, "type_etablissement");
	const nature = str(r, "code_nature");
	if (nature === POST_BAC_ONLY) return { amenity: "college", level: null };
	if (/^m[ée]dico/i.test(type)) return { amenity: "social_facility", level: null, for: "disabled" };
	if (!type || NOT_A_SCHOOL.test(type) || nature === CIRCONSCRIPTION) return null;
	if (/^[ée]cole/i.test(type)) {
		const mat = truthy(str(r, "ecole_maternelle"));
		const elem = truthy(str(r, "ecole_elementaire"));
		const level = mat && elem ? "primaire" : mat ? "maternelle" : elem ? "élémentaire" : null;
		return { amenity: "school", level };
	}
	if (/^coll[èe]ge/i.test(type)) return { amenity: "school", level: "collège" };
	if (/^lyc[ée]e/i.test(type)) return { amenity: "school", level: "lycée" };
	return { amenity: "school", level: null };
}

/** Initialisms a directory name keeps in capitals on purpose. */
const ACRONYMS = new Set([
	"EREA",
	"SEGPA",
	"ULIS",
	"LEGTA",
	"LEPA",
	"ITEP",
	"DITEP",
	"IME",
	"IMPRO",
	"IEM",
	"IES",
	"SESSAD",
	"SEPAD",
	"CAMSP",
	"CMPP",
	"IFSI",
	"ISSEC",
	"EPNAK",
	"IESCA",
	"ICS",
	"ASEI",
	"OVE",
	"ISO",
]);

/** Small words a name written all in capitals has in capitals too. */
const PARTICLES = new Set(["DE", "DES", "DU", "LA", "LE", "LES", "ET", "AU", "AUX", "EN", "SUR"]);

/** Words the directory, or a name quieted from capitals, writes without their accents. */
const ACCENTED = [
	"École",
	"Écoles",
	"Établissement",
	"Établissements",
	"Éducation",
	"Éducatif",
	"Éducative",
	"Éducatifs",
	"Éducatives",
	"Évaluation",
	"Étude",
	"Études",
	"Élémentaire",
	"Épée",
	"Médico",
	"Pédagogique",
	"Thérapeutique",
	"Spécialisé",
	"Spécialisée",
	"Supérieur",
	"Supérieure",
	"Privé",
	"Privée",
	"Visée",
	"Collège",
	"Lycée",
	"Métiers",
	"Éclat",
];
/** Names, which keep their capital even where the directory dropped it ("La boetie"). */
const ACCENTED_NAMES = ["Élise", "Émile", "Étienne", "Édouard", "Boétie"];
const bare = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
const spellings = (w: string, lower: string): [string, string][] => [
	[bare(w), w],
	[bare(w).toLowerCase(), lower],
];
const UNACCENTED = new Map([
	...ACCENTED.flatMap((w) => spellings(w, w.toLowerCase())),
	...ACCENTED_NAMES.flatMap((w) => spellings(w, w)),
]);
const UNACCENTED_WORD = new RegExp(
	`(?<![\\p{L}\\d])(${[...UNACCENTED.keys()].join("|")})(?![\\p{L}\\d])`,
	"gu",
);

const capitals = (word: string) => /\p{Lu}{2}/u.test(word) && !/\p{Ll}/u.test(word);
/** Short or vowelless capitals are an organisation's letters ("ORT", "CHU"); longer ones are words. */
const initialism = (w: string) => ACRONYMS.has(w) || w.length <= 4 || !/[AEIOUY]/.test(w);

/**
 * The directory drops the accent off "École" and shouts surnames ("Rosa PARKS"), sometimes
 * a brand ("CAMAS ACADEMY") or the whole name; OSM France writes neither. A single word in
 * capitals anywhere else is left as written: it is an initialism as often as a brand
 * ("IPESS", "CESDDA", "ADONIS"), and only the school can say which.
 *
 * "hors contrat" goes: it is the private school's legal status (no contract with the state),
 * which the directory writes into the name on 29 of its 111 such schools in Toulouse and Lyon.
 * OSM has no key for it, and of 773 school names already mapped there 1 keeps it; mappers who
 * named these schools wrote "École primaire privée Les Sarments", not "…privée hors contrat…".
 */
export function schoolName(raw: string): string {
	const shouting = raw === raw.toUpperCase();
	const quiet = (w: string) => w[0] + w.slice(1).toLowerCase();
	let out = raw
		.replace(/\s+/g, " ")
		.replace(/ hors[- ]contrat\b/i, "")
		.replace(/\p{Lu}{2,}/gu, (w, at: number, all: string) => {
			if (ACRONYMS.has(w)) return w;
			if (shouting) return PARTICLES.has(w) ? w.toLowerCase() : quiet(w);
			const start = all.lastIndexOf(" ", at) + 1;
			const end = all.indexOf(" ", at) < 0 ? all.length : all.indexOf(" ", at);
			const before = all.slice(0, start).trimEnd().split(" ").pop() ?? "";
			const after = all.slice(end).trimStart().split(" ")[0];
			if (capitals(before) || capitals(after)) {
				if (PARTICLES.has(w)) return w.toLowerCase();
				return initialism(w) ? w : quiet(w);
			}
			// In a name written in mixed case, capitals after a first name or a particle are a
			// surname ("Rosa PARKS", "Pierre de FERMAT"); anywhere else an initialism ("ESTM").
			return SURNAME_AFTER.test(before) ? quiet(w) : w;
		})
		.replace(UNACCENTED_WORD, (w) => UNACCENTED.get(w) ?? w)
		.replace(STUTTER, (w, first: string, second: string) =>
			first.toLowerCase() === second && !"aelo".includes(second) ? first : w,
		)
		// French writes the particle small inside a name ("Geneviève de Gaulle"), only the
		// directory capitalises it there ("Institut De Fourvière").
		.replace(/(?<=\S )(De|Du|Des)(?= \p{Lu})/gu, (w) => w.toLowerCase());
	if (shouting) out = out.replace(/ A (?=\p{L})/gu, " à ");
	return out[0].toUpperCase() + out.slice(1);
}

/**
 * A capital typed twice ("Iinstitut"). No French word starts that way, but names can
 * ("Aaron", "Eeckhout", "Lloyd", "Oosterhof"), so a doubled A, E, L or O stays.
 */
const STUTTER = /(?<![\p{L}\d])(\p{Lu})(\p{Ll})(?=\p{Ll})/gu;

const SURNAME_AFTER = /^(\p{Lu}\p{Ll}+([-'’]\p{Lu}\p{Ll}+)*|de|du|des|d'|la|le)$/u;

const STREET =
	/^(rue|avenue|boulevard|cheminement|chemin|place|port|allée|allées|impasse|route|quai|cours|square|voie|passage|esplanade|rond-point|montée|chaussée|parvis|promenade|sentier|faubourg|clos|cité|grande? rue|petite rue)\b/i;

/** Street types as an address line abbreviates them, read only where the type stands. */
const STREET_TYPES: Record<string, string> = {
	bd: "boulevard",
	bld: "boulevard",
	bvd: "boulevard",
	blvd: "boulevard",
	av: "avenue",
	ave: "avenue",
	pl: "place",
	rte: "route",
	chem: "chemin",
	ch: "chemin",
	imp: "impasse",
	fbg: "faubourg",
	fg: "faubourg",
	all: "allée",
	crs: "cours",
	sq: "square",
	r: "rue",
	prom: "promenade",
	mte: "montée",
};
/** Abbreviations no street name uses as a word of its own. */
const NAME_WORDS: Record<string, string> = {
	st: "saint",
	ste: "sainte",
	gal: "général",
	gén: "général",
	mal: "maréchal",
	pdt: "président",
};
const STREET_TYPE = new RegExp(
	`^((?:\\d+\\S*\\s+(?:(?:bis|ter|quater)\\s+)?)?)(${Object.keys(STREET_TYPES).join("|")})\\.?(?=\\s)`,
	"iu",
);
const NAME_WORD = new RegExp(
	`(?<![\\p{L}\\d])(${Object.keys(NAME_WORDS).join("|")})\\.?(?=[\\s-])`,
	"giu",
);

/** The expansion in the abbreviation's own case: "Bd" is "Boulevard", "ST" is "SAINT". */
function cased(abbr: string, word: string): string {
	if (abbr.length > 1 && abbr === abbr.toUpperCase()) return word.toUpperCase();
	return abbr[0] === abbr[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * An address line with its abbreviations written out. The address base scores "49 Bd Lucien
 * Sampaix" 0.67 and "49 Boulevard Lucien Sampaix" 0.96, so an abbreviation alone can make
 * an address a miss.
 */
export function expandStreet(line: string): string {
	return line
		.replace(
			STREET_TYPE,
			(_, lead: string, abbr: string) => lead + cased(abbr, STREET_TYPES[abbr.toLowerCase()]),
		)
		.replace(NAME_WORD, (_, abbr: string) => cased(abbr, NAME_WORDS[abbr.toLowerCase()]));
}

/**
 * How far a source's point may sit from its own housenumber before the address is taken
 * over the point. A school's grounds can stretch a few hundred metres from its gate. A
 * charging station's point is where its operator placed it, often in a car park well away
 * from the address's door, so only a coarse one (`COARSE_DECIMALS`) is moved.
 */
const SCHOOL_FAR_M = 1000;
const STATION_FAR_M = 100;
/** Four decimals is 11 m: a registry writing so few rounded a geocoded point, or typed it. */
const COARSE_DECIMALS = 4;

/**
 * What to ask the address base for a line: with its postcode and commune, unless the line
 * already carries them. Naming the commune twice costs the match a third of its score.
 */
export function addressQuery(line: string, postcode: string, city: string): string {
	const q = expandStreet(line);
	return postcode && q.includes(postcode) ? q : [q, postcode, city].filter(Boolean).join(" ");
}

/**
 * Whether a postcode is a place's rather than a CEDEX mail route, which the address lines do
 * not always say (69321, 31506). La Poste gives places codes ending in 0, except the
 * arrondissements of Paris, Lyon and Marseille and the overseas departments.
 */
export const placePostcode = (cp: string) =>
	/^\d{4}0$|^750\d\d$|^6900\d$|^130\d\d$|^9[78]\d{3}$/.test(cp);

/**
 * `adresse_1` split into number and street, with the commune the address uses: Lyon, not
 * "Lyon 6e Arrondissement", and no CEDEX postcode, which routes mail, not places. Null when
 * the line is not a plain street address. A range ("20-28") stays the housenumber, as OSM
 * writes it, and the address base is asked for its first number. The spelling here is the
 * directory's; the address base's replaces it before anything is proposed.
 */
export function schoolAddress(r: Row) {
	const line = expandStreet(
		str(r, "adresse_1")
			.replace(/\s*\([^)]*\)/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	);
	const m = /^(\d+(?: ?- ?\d+)?(?: ?(?:bis|ter|quater|[a-z]))?) (.+)$/i.exec(line);
	const number = m ? spacedNumber(m[1]) : "";
	const street = m ? m[2] : line;
	if (!STREET.test(street)) return null;
	const mail = `${str(r, "adresse_2")} ${str(r, "adresse_3")}`;
	const postcode =
		/cedex|\bbp\b|\bcs ?\d/i.test(mail) || !placePostcode(str(r, "code_postal"))
			? ""
			: str(r, "code_postal");
	const city = str(r, "nom_commune")
		.replace(/\s+/g, " ")
		.replace(/ \d+(?:er|e|ème)? arrondissement$/i, "");
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

/**
 * `date_ouverture` is when the UAI entered the register, not when the school opened. Every
 * school that already existed was entered in batches up to the late 1970s (98 on two days of
 * 1965 alone, the Lycée du Parc's 1914 among them); from 1978 the dates fall on the first
 * day of a school year and read as real openings. A primaire is usually a maternelle and an
 * élémentaire merged under a new UAI, so its date is the merger's.
 */
export function openedForSure(date: string, level: string | null): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= "1978" && level !== "primaire";
}

/** Positions the directory gives to the building; anything coarser is worth a look. */
const EXACT = /^(parfaite|num[ée]ro de rue)$/i;

/** A school's address at a webmail provider is often a person's, which does not belong on the map. */
const WEBMAIL =
	/@(gmail|hotmail|outlook|live|yahoo|icloud|wanadoo|orange|free|laposte|sfr|neuf)\.[a-z.]+$/i;

/** first.last, initial.last, first-last, compound first names included. */
const PERSON_MAILBOX = /^[a-z]+(?:-[a-z]+)?[._-][a-z]+(?:-[a-z]+)?$/;
/** Mailbox words that name a role, a level or a place rather than someone. */
const ROLE_WORDS = new Set(
	(
		"contact contacts info infos infocontact accueil dir direction directeur directrice " +
		"secretariat secretaire admin adm administration ce scolarite vie scolaire ecole college " +
		"clg lycee lyc lp primaire maternelle campus centre institut institution etablissement ime " +
		"itep sessad legta compta comptabilite inscription inscriptions communication standard " +
		"gestion intendance cpe proviseur principal rh bureau service pole superieur formation " +
		"formations saint sainte st ste association asso groupe education projet site"
	).split(" "),
);

/** A first name, or an initial run into a surname ("maubert", "ehatzakortzian"). */
const ONE_WORD = /^[a-z]{4,}$/;
/** Shorter words turn up inside names by chance ("ce" in "vincent"). */
const WORD_INSIDE = 4;

/**
 * A mailbox that reads as somebody's own: a staff member's address is personal data, and
 * one that leaves with them. A part that is a role word, or is in the domain, the school's
 * name or its place (commune and street) is the establishment's
 * ("immaculee.conception@immaculee.net", "campus.toulouse@…"), and so is a single word
 * built on one ("secretariatmontchat", "lyceepro", "neyret" on rue Neyret).
 */
export function personalMailbox(mail: string, name: string, place: string): boolean {
	const [local, domain = ""] = bare(mail).toLowerCase().split("@");
	const own = new Set([...tokens(name), ...tokens(place)]);
	const theirs = (p: string) =>
		ROLE_WORDS.has(p) || own.has(p) || (p.length >= 3 && domain.includes(p));
	if (PERSON_MAILBOX.test(local)) return !local.split(/[._-]/).some(theirs);
	if (!ONE_WORD.test(local) || theirs(local)) return false;
	return ![...ROLE_WORDS, ...own, ...domain.split(/[.-]/)].some(
		(w) => w.length >= WORD_INSIDE && local.includes(w),
	);
}

const isMobile = (phone: string) => /^\+33 [67] /.test(phone);

/**
 * The first digit of a SIREN says whose legal person it is: 1 the State, 2 a local authority
 * or public body (hospitals included). Where it disagrees with the directory's status (a
 * public hospital's school listed as private), neither is taken.
 */
const publicBody = (siret: string) => (/^\d{14}$/.test(siret) ? /^[12]/.test(siret) : null);

const SEGPA = "390";

/** Addresses this close to the point are one site as far as the point can tell. */
const ONE_ADDRESS_M = 100;

/**
 * One UAI over several sites comes as several rows, each at the one point the directory has
 * for the UAI: the main site is the one whose address is at that point. Where the address
 * base cannot tell, the main row carries the plain name and its annexes a suffix ("Collège
 * Michelet - annexe", "… - Site St Didier").
 */
function mainSite(rows: Row[], gaps?: Map<Row, number>): Row {
	const gap = (r: Row) => gaps?.get(r) ?? Number.POSITIVE_INFINITY;
	const nearest = Math.min(...rows.map(gap));
	return rows
		.filter((r) => gap(r) <= nearest + ONE_ADDRESS_M || nearest === Number.POSITIVE_INFINITY)
		.sort((a, b) => str(a, "nom_etablissement").length - str(b, "nom_etablissement").length)[0];
}

/** The values a UAI's other sites give for the same tag, which OSM may hold just as well. */
function alsoAt(tag: ProposedTag | undefined, rows: Row[], read: (row: Row) => string | null) {
	if (!tag) return;
	const also = [...new Set(rows.map(read))].filter((v): v is string => !!v && v !== tag.v);
	if (also.length) tag.also = also;
}

/** Annuaire de l'éducation. */
const education: Preset = {
	id: "annuaire-education",
	label: "Annuaire de l'éducation",
	keyField: "identifiant_de_l_etablissement",
	detect: (c) => c.includes("identifiant_de_l_etablissement") && c.includes("nom_etablissement"),
	key: (r) => str(r, "identifiant_de_l_etablissement") || null,
	position: (r) => findCoords(r),
	siteQuery: (r) => schoolAddress(r)?.query ?? null,
	extract(rows, url, gaps) {
		const r = mainSite(rows, gaps);
		const pos = education.position(r);
		const key = education.key(r);
		if (!pos || !key) return null;
		const kind = schoolKind(r);
		// A SEGPA or a lycée's vocational section lives in its parent's buildings, with the
		// parent's SIRET and switchboard: it is not a place of its own on the map, even where the
		// directory attaches a SEGPA as a geographic annex rather than as a section.
		if (
			!kind ||
			/section/i.test(str(r, "type_rattachement_etablissement_mere")) ||
			str(r, "code_nature") === SEGPA
		)
			return null;
		const t = new Tags(r);
		const name = schoolName(str(r, "nom_etablissement"));
		const state = str(r, "etat", "etat_etablissement");
		const siret = str(r, "siren_siret", "numero_siren_siret").replace(/\s/g, "");

		const nature = str(r, "libelle_nature");
		const precision = str(r, "precision_localisation");
		const mat = str(r, "ecole_maternelle") || "0";
		const elem = str(r, "ecole_elementaire") || "0";
		const amenity = t.add("amenity", kind.amenity, 0.9, "libelle_nature", nature, "derived");
		if (kind.for) {
			// Already mapped, an institute is a school to some mappers and a social facility to
			// others; which main tag it keeps is theirs to decide.
			fill(amenity);
			fill(t.add("social_facility:for", kind.for, 0.8, "libelle_nature", nature, "derived"));
		}
		if (kind.level && /^[ée]cole/i.test(str(r, "type_etablissement")))
			t.add(
				"school:FR",
				kind.level,
				0.9,
				"ecole_maternelle",
				`${mat}, ecole_elementaire: ${elem}`,
				"derived",
			);
		else if (kind.level)
			t.add("school:FR", kind.level, 0.9, "type_etablissement", undefined, "derived");
		// The directory's name is the administrative one, level words and all; a mapper's
		// usual name stays, and the directory's is still on screen in the header.
		fill(t.add("name", name, 0.9, "nom_etablissement"));
		t.add("ref:UAI", key, 0.98, "identifiant_de_l_etablissement");
		if (/^\d{14}$/.test(siret))
			t.add(
				"ref:FR:SIRET",
				siret,
				0.95,
				"siren_siret",
				str(r, "siren_siret", "numero_siren_siret"),
			);
		const at = schoolAddress(r);
		let withheld = 0;
		const phoneOf = (row: Row) => phoneFR(str(row, "telephone"));
		const phone = phoneOf(r);
		if (phone && isMobile(phone)) withheld += 1;
		else if (phone)
			alsoAt(t.add("phone", phone, 0.85, "telephone", undefined, "normalised"), rows, phoneOf);
		const sites = rows.map((row) => website(str(row, "web", "site_web")));
		// One site's row may write http where another's writes https for the same page.
		const siteOf = (row: Row) => {
			const v = sites[rows.indexOf(row)];
			const secure = v?.replace(/^http:/, "https:");
			return secure && sites.includes(secure) ? secure : v;
		};
		const site = siteOf(r);
		if (site) alsoAt(t.add("website", site, 0.8, "web"), rows, siteOf);
		const mail = str(r, "mail");
		if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(mail) && !WEBMAIL.test(mail)) {
			if (personalMailbox(mail, name, `${str(r, "nom_commune")} ${str(r, "adresse_1")}`))
				withheld += 1;
			else fill(t.add("email", mail, 0.8, "mail"));
		}
		const opened = str(r, "date_ouverture");
		if (openedForSure(opened, kind.level)) fill(t.add("start_date", opened, 0.7, "date_ouverture"));
		const status = str(r, "statut_public_prive");
		const said = /^public/i.test(status) ? true : /priv/i.test(status) ? false : null;
		const bySiren = publicBody(siret);
		if (said !== null && (bySiren === null || bySiren === said))
			t.add("operator:type", said ? "public" : "private", 0.9, "statut_public_prive");
		// An address fills gaps only, and only whole: a postcode and city on an object with no
		// street is half an address.
		if (at)
			for (const tag of [
				t.add("addr:housenumber", at.number, 0.8, "adresse_1"),
				t.add("addr:street", at.street, 0.8, "adresse_1"),
				t.add("addr:postcode", at.postcode, 0.85, "code_postal"),
				t.add("addr:city", at.city, 0.85, "nom_commune"),
			]) {
				fill(tag);
				if (tag) tag.group = "addr";
			}

		return {
			key,
			url,
			name,
			addr: [
				str(r, "adresse_1"),
				[str(r, "code_postal"), str(r, "nom_commune")].filter(Boolean).join(" "),
			]
				.filter(Boolean)
				.join(", "),
			lat: pos[0],
			lon: pos[1],
			closedBy: /^ferm/i.test(state)
				? {
						path: "etat",
						kind: "dataset row",
						parts: [
							{ text: "etat: ", mark: false },
							{ text: state, mark: true },
						],
					}
				: undefined,
			refs: { "ref:UAI": key, ...(siret.length === 14 ? { "ref:FR:SIRET": siret } : {}) } as Record<
				string,
				string
			>,
			tags: t.list,
			notes: [
				...(rows.length > 1
					? [
							`The directory lists this UAI at ${rows.length} sites; the details are ${str(r, "adresse_1")}'s, the main one`,
						]
					: []),
				...(precision && !EXACT.test(precision)
					? [`The directory places it only to the precision of: ${precision}`]
					: []),
			],
			geocode: at ? { q: at.query, farM: SCHOOL_FAR_M } : undefined,
			withheld,
		};
	},
};

export const PRESETS: Preset[] = [irve, education];

export const presetById = (id: string | null) => PRESETS.find((p) => p.id === id);

export const detectPreset = (columns: string[]) => PRESETS.find((p) => p.detect(columns));

/** The evidence `when` column: the day the run read the source. */
export const evidenceDate = (d = new Date()) => fmtDate(d);
