import { fmtDate } from "$lib/format";
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
	/** `rows` are every row that shares the key; `url` is the record's own address. */
	extract(rows: Row[], url: string): Extraction | null;
	/** Records whose rows give the same site are one place, whatever their keys say. */
	site?(row: Row): string | null;
}

/**
 * Some operators declare every charge point of a car park as a station of its own, which
 * would make one candidate per point, all on the same spot. Records on one site become
 * one, under the smallest key, so an existing candidate keeps its id and the others are
 * swept as gone.
 */
export function mergeSites<R extends { key: string; rows: Row[] }>(
	records: R[],
	preset: Preset | null | undefined,
): R[] {
	const site = preset?.site;
	if (!site) return records;
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
	return out;
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
				{ text: value || v, mark: true },
			],
		};
		this.list.push(tag);
		return tag;
	}
}

const OPENING_HOURS = /^(24\/7|(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)[A-Za-z0-9:,;\-+ /]*)$/;

function openingHours(raw: string): string | null {
	const v = raw.trim();
	if (/^24\/7$/i.test(v) || /^Mo-Su 00:00-24:00$/.test(v)) return "24/7";
	return OPENING_HOURS.test(v) ? v : null;
}

const DC_SOCKETS = new Set(["socket:type2_combo", "socket:chademo"]);

const POWER_KW = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(1))} kW`;

const NOT_A_POINT = /^non concern/i;

/**
 * The consolidated file keeps every declaration a station has had, so a charge point can
 * come back once per declaration, the older ones carrying stale counts and operators.
 * Only the newest row of each point counts, and the newest comes first so the station's
 * single values are read from it.
 */
function newestPerPoint(rows: Row[]): Row[] {
	const seen = new Set<string>();
	return [...rows]
		.sort((a, b) => str(b, "date_maj").localeCompare(str(a, "date_maj")))
		.filter((r) => {
			const id = str(r, "id_pdc_itinerance");
			if (!id || NOT_A_POINT.test(id)) return true;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
}

/** IRVE "statique" v2.3, consolidated: one row per charge point, grouped into one station. */
const irve: Preset = {
	id: "irve",
	label: "IRVE charging stations",
	keyField: "id_station_itinerance",
	detect: (c) => c.includes("id_station_itinerance") && c.includes("id_pdc_itinerance"),
	key: (r) => str(r, "id_station_itinerance") || null,
	site(r) {
		const pos = irve.position(r);
		const operator = (str(r, "nom_operateur") || str(r, "nom_amenageur")).toLowerCase();
		return pos ? `${pos[0].toFixed(6)},${pos[1].toFixed(6)}|${operator}` : null;
	},
	position(r) {
		const flag = str(r, "consolidated_is_lon_lat_correct");
		if (flag && !truthy(flag)) return null;
		const c = coord(r.consolidated_latitude, r.consolidated_longitude);
		if (c) return c;
		const xy = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(str(r, "coordonneesXY"));
		return xy ? coord(xy[2], xy[1]) : null;
	},
	extract(declared, url) {
		const rows = newestPerPoint(declared);
		const first = rows[0];
		const pos = irve.position(first);
		const key = irve.key(first);
		if (!pos || !key) return null;
		const t = new Tags(first);

		const points = [
			...new Set(
				rows.map((r) => str(r, "id_pdc_itinerance")).filter((v) => v && !NOT_A_POINT.test(v)),
			),
		];
		const capacity = points.length || Number.parseInt(str(first, "nbre_pdc"), 10) || 0;

		t.add("amenity", "charging_station", 0.95, "id_station_itinerance");
		t.add(
			"operator",
			str(first, "nom_operateur") || str(first, "nom_amenageur"),
			0.85,
			"nom_operateur",
		);
		t.add("network", str(first, "nom_enseigne"), 0.8, "nom_enseigne");
		if (capacity)
			t.add(
				"capacity",
				String(capacity),
				0.85,
				"nbre_pdc",
				str(first, "nbre_pdc") || String(capacity),
			);
		t.add("ref:EU:EVSE", points.join(";"), 0.95, "id_pdc_itinerance", points.join(";"));

		const sockets: [string, string][] = [
			["socket:type2", "prise_type_2"],
			["socket:type2_combo", "prise_type_combo_ccs"],
			["socket:chademo", "prise_type_chademo"],
			["socket:typee", "prise_type_ef"],
		];
		// The schema gives one power per charge point and none per connector. That power is a
		// connector's only when the point has that connector alone, or when the connector is DC
		// on a DC unit: the type 2 cable on a 300 kW unit is AC, 22–43 kW. One point where the
		// power cannot be pinned on this type and the type gets no output, rather than a guess.
		const kinds = (r: Row) => sockets.filter(([, f]) => truthy(str(r, f))).length;
		for (const [k, field] of sockets) {
			const carrying = rows.filter((r) => truthy(str(r, field)));
			if (carrying.length === 0) continue;
			t.add(k, String(carrying.length), 0.9, field, "true");
			if (!DC_SOCKETS.has(k) && carrying.some((r) => kinds(r) > 1)) continue;
			const power = Math.max(0, ...carrying.map((r) => Number(str(r, "puissance_nominale")) || 0));
			if (power === 0) continue;
			const shared = carrying.some((r) => kinds(r) > 1);
			t.add(
				`${k}:output`,
				POWER_KW(power),
				shared ? 0.7 : 0.8,
				"puissance_nominale",
				String(power),
				"derived",
			);
		}

		const free = rows.every((r) => truthy(str(r, "gratuit")));
		const paid = rows.some(
			(r) =>
				truthy(str(r, "paiement_acte")) || truthy(str(r, "paiement_cb")) || str(r, "tarification"),
		);
		if (free) t.add("fee", "no", 0.8, "gratuit", "true", "derived");
		else if (paid)
			t.add("fee", "yes", 0.75, "paiement_acte", str(first, "paiement_acte") || "true", "derived");

		// "Accès réservé" covers a shop's customers, residents, employees and a network's
		// subscribers alike (customers, private, no standard value), so it proposes nothing.
		// "Accès libre" only fills a gap: it is too coarse to overrule a mapper's survey.
		const access = str(first, "condition_acces");
		const open = /libre/i.test(access)
			? t.add("access", "yes", 0.8, "condition_acces", access, "derived")
			: undefined;
		if (open) open.addOnly = true;

		const hours = openingHours(str(first, "horaires"));
		if (hours) t.add("opening_hours", hours, 0.7, "horaires");

		const refs: Record<string, string> = points.length ? { "ref:EU:EVSE": points.join(";") } : {};
		const commune = str(first, "consolidated_commune");
		const cp = str(first, "consolidated_code_postal");
		return {
			key,
			url,
			name: str(first, "nom_station", "nom_enseigne") || "Charging station",
			addr: [str(first, "adresse_station"), [cp, commune].filter(Boolean).join(" ")]
				.filter(Boolean)
				.join(", "),
			lat: pos[0],
			lon: pos[1],
			refs,
			tags: t.list,
		};
	},
};

function schoolKind(r: Row): "school" | "kindergarten" {
	const type = str(r, "type_etablissement");
	if (
		/^[ée]cole/i.test(type) &&
		truthy(str(r, "ecole_maternelle")) &&
		!truthy(str(r, "ecole_elementaire"))
	)
		return "kindergarten";
	return "school";
}

/**
 * Annuaire de l'éducation. Collèges and lycées are `amenity=school` here, as French OSM
 * maps them; `amenity=college` is higher education in OSM and would be wrong for them.
 */
const education: Preset = {
	id: "annuaire-education",
	label: "Annuaire de l'éducation",
	keyField: "identifiant_de_l_etablissement",
	detect: (c) => c.includes("identifiant_de_l_etablissement") && c.includes("nom_etablissement"),
	key: (r) => str(r, "identifiant_de_l_etablissement") || null,
	position: (r) => findCoords(r),
	extract(rows, url) {
		const r = rows[0];
		const pos = education.position(r);
		const key = education.key(r);
		if (!pos || !key) return null;
		const t = new Tags(r);
		const name = str(r, "nom_etablissement");
		const state = str(r, "etat", "etat_etablissement");
		const siret = str(r, "siren_siret", "numero_siren_siret").replace(/\s/g, "");

		t.add("amenity", schoolKind(r), 0.9, "type_etablissement");
		t.add("name", name, 0.9, "nom_etablissement");
		t.add("ref:UAI", key, 0.98, "identifiant_de_l_etablissement");
		if (/^\d{14}$/.test(siret))
			t.add(
				"ref:FR:SIRET",
				siret,
				0.95,
				"siren_siret",
				str(r, "siren_siret", "numero_siren_siret"),
			);
		const phone = phoneFR(str(r, "telephone"));
		if (phone) t.add("phone", phone, 0.85, "telephone", undefined, "normalised");
		const site = website(str(r, "web", "site_web"));
		if (site) t.add("website", site, 0.8, "web");
		const status = str(r, "statut_public_prive");
		if (/^public/i.test(status)) t.add("operator:type", "public", 0.9, "statut_public_prive");
		else if (/priv/i.test(status)) t.add("operator:type", "private", 0.9, "statut_public_prive");
		t.add("addr:postcode", str(r, "code_postal"), 0.85, "code_postal");
		t.add("addr:city", str(r, "nom_commune"), 0.85, "nom_commune");

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
		};
	},
};

export const PRESETS: Preset[] = [irve, education];

export const presetById = (id: string | null) => PRESETS.find((p) => p.id === id);

export const detectPreset = (columns: string[]) => PRESETS.find((p) => p.detect(columns));

/** The evidence `when` column: the day the run read the source. */
export const evidenceDate = (d = new Date()) => fmtDate(d);
