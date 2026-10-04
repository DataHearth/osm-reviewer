import { fmtDate } from "$lib/format";
import { normaliseName } from "./geo";
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

const OPENING_HOURS = /^(24\/7|(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)[A-Za-z0-9:,;\-+ /]*)$/;

function openingHours(raw: string): string | null {
	const v = raw.trim();
	if (/^24\/7$/i.test(v) || /^Mo-Su 00:00-(24:00|23:5\d)$/.test(v)) return "24/7";
	return OPENING_HOURS.test(v) ? v : null;
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

/** A registry's 22.08 is the 22 kW everyone writes; a real 7.4 or 3.7 keeps its decimal. */
export const POWER_KW = (n: number) => {
	const whole = Math.round(n);
	return `${Math.abs(n - whole) < 0.15 ? whole : Number(n.toFixed(1))} kW`;
};

/** A tariff column says the charge is paid only when it gives a price or where to find one. */
const isTariff = (v: string) => /\d|€|kwh|tarif|https?:/i.test(v) && !/inconnu|gratuit/i.test(v);

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
		// Registry names are legal entities and shouting brands ("TotalEnergies Marketing
		// France", "Reveo"), so they fill a gap but never replace what a mapper wrote.
		const operator = str(first, "nom_operateur") || str(first, "nom_amenageur");
		const network = str(first, "nom_enseigne");
		fill(t.add("operator", operator, 0.85, "nom_operateur"));
		if (normaliseName(network) !== normaliseName(operator))
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
				`${capacity} distinct`,
				"derived",
			);
		const stations = [...new Set(rows.map((r) => str(r, "id_station_itinerance")).filter(Boolean))];
		const pools = [...new Set(stations.map(poolId).filter((v) => v !== null))].join(";");
		if (pools.length <= OSM_MAX)
			t.add("ref:EU:EVSE", pools, 0.95, "id_station_itinerance", stations.join(";"));

		// A type 2 point with its cable attached is `socket:type2_cable`, not a socket.
		const cable = (r: Row) => truthy(str(r, "cable_t2_attache"));
		const sockets: [string, string, (r: Row) => boolean][] = [
			["socket:type2", "prise_type_2", (r) => !cable(r)],
			["socket:type2_cable", "prise_type_2", cable],
			["socket:type2_combo", "prise_type_combo_ccs", () => true],
			["socket:chademo", "prise_type_chademo", () => true],
			["socket:typee", "prise_type_ef", () => true],
		];
		const has = (r: Row, field: string) => truthy(str(r, field));
		const kinds = (r: Row) =>
			new Set(sockets.filter(([, f, only]) => has(r, f) && only(r)).map(([, f]) => f)).size;
		const absent: string[] = [];
		// The schema gives one power per charge point and none per connector. That power is a
		// connector's only when the point has that connector alone, or when it is the CCS of a
		// DC unit: the type 2 cable on a 300 kW unit is AC, 22–43 kW, and CHAdeMO beside CCS
		// tops out near 50–100 kW. One point where the power cannot be pinned on this type and
		// the type gets no output, rather than a guess.
		for (const [k, field, only] of sockets) {
			const carrying = rows.filter((r) => has(r, field) && only(r));
			if (carrying.length === 0) {
				if (!rows.some((r) => has(r, field))) absent.push(k);
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
			if (power === 0) continue;
			t.add(
				`${k}:output`,
				POWER_KW(power),
				shared ? 0.7 : 0.8,
				"puissance_nominale",
				String(power),
				"derived",
			);
		}
		if (!rows.some((r) => has(r, "prise_type_autre"))) absent.push(...OTHER_SOCKETS);
		const notes = rows.some((r) => has(r, "prise_type_autre"))
			? ["The registry lists connectors of another type on this station, which it does not name"]
			: [];

		const free = rows.every((r) => truthy(str(r, "gratuit")));
		const paidBy = ["paiement_acte", "paiement_cb"].find((f) =>
			rows.some((r) => truthy(str(r, f))),
		);
		const tariff = rows.map((r) => str(r, "tarification")).find(isTariff);
		if (free) t.add("fee", "no", 0.8, "gratuit", "true", "derived");
		else if (paidBy) t.add("fee", "yes", 0.75, paidBy, "true", "derived");
		else if (tariff) t.add("fee", "yes", 0.7, "tarification", tariff, "derived");

		// "Accès réservé" covers a shop's customers, residents, employees and a network's
		// subscribers alike (customers, private, no standard value), so it proposes nothing.
		// "Accès libre" only fills a gap: it is too coarse to overrule a mapper's survey.
		const access = str(first, "condition_acces");
		if (/libre/i.test(access))
			fill(t.add("access", "yes", 0.8, "condition_acces", access, "derived"));

		const hours = openingHours(str(first, "horaires"));
		if (hours) t.add("opening_hours", hours, 0.7, "horaires");

		const known = [...stations, ...points].join(";");
		const refs: Record<string, string> = known ? { "ref:EU:EVSE": known } : {};
		const commune = str(first, "consolidated_commune");
		const cp = str(first, "consolidated_code_postal");
		const street = str(first, "adresse_station");
		return {
			key,
			url,
			name: str(first, "nom_station", "nom_enseigne") || "Charging station",
			addr: [street, cp && street.includes(cp) ? "" : [cp, commune].filter(Boolean).join(" ")]
				.filter(Boolean)
				.join(", "),
			lat: pos[0],
			lon: pos[1],
			refs,
			tags: t.list,
			absent,
			notes,
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
 */
function schoolKind(r: Row): { amenity: string; level: string | null } | null {
	const type = str(r, "type_etablissement");
	const nature = str(r, "code_nature");
	if (nature === POST_BAC_ONLY) return { amenity: "college", level: null };
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
	"SESSAD",
	"CMPP",
	"IFSI",
]);

/**
 * The directory drops the accent off "École" and shouts surnames ("Rosa PARKS"); OSM France
 * writes neither.
 */
export function schoolName(raw: string): string {
	return raw
		.replace(/\s+/g, " ")
		.replace(/\bEcole(s?)\b/g, "École$1")
		.replace(/\p{Lu}{4,}/gu, (w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
}

const STREET =
	/^(rue|avenue|boulevard|chemin|place|allée|allées|impasse|route|quai|cours|square|voie|passage|esplanade|rond-point|montée|chaussée|parvis|promenade|sentier|faubourg|clos|cité|grande rue|petite rue)\b/i;

/**
 * `adresse_1` split into number and street, with the commune the address uses: Lyon, not
 * "Lyon 6e Arrondissement", and no CEDEX postcode, which routes mail, not places. Null when
 * the line is not a plain street address or is written in capitals.
 */
export function schoolAddress(r: Row) {
	const line = str(r, "adresse_1").replace(/\s+/g, " ");
	const m = /^(\d+(?: ?(?:bis|ter|quater|[a-z]))?) (.+)$/i.exec(line);
	const number = m ? m[1].replace(/ /g, "") : "";
	const street = m ? m[2] : line;
	if (!STREET.test(street) || /\p{Lu}{3,}/u.test(street)) return null;
	const mail = `${str(r, "adresse_2")} ${str(r, "adresse_3")}`;
	return {
		number,
		street: street[0].toUpperCase() + street.slice(1),
		postcode: /cedex|\bbp\b|\bcs ?\d/i.test(mail) ? "" : str(r, "code_postal"),
		city: str(r, "nom_commune")
			.replace(/\s+/g, " ")
			.replace(/ \d+(?:er|e|ème)? arrondissement$/i, ""),
	};
}

/** Annuaire de l'éducation. */
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
		const kind = schoolKind(r);
		if (!kind) return null;
		const t = new Tags(r);
		const name = schoolName(str(r, "nom_etablissement"));
		const state = str(r, "etat", "etat_etablissement");
		const siret = str(r, "siren_siret", "numero_siren_siret").replace(/\s/g, "");

		const nature = str(r, "libelle_nature");
		t.add("amenity", kind.amenity, 0.9, "libelle_nature", nature, "derived");
		if (kind.level) t.add("school:FR", kind.level, 0.9, "libelle_nature", nature, "derived");
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
		const phone = phoneFR(str(r, "telephone"));
		if (phone) t.add("phone", phone, 0.85, "telephone", undefined, "normalised");
		const site = website(str(r, "web", "site_web"));
		if (site) t.add("website", site, 0.8, "web");
		const status = str(r, "statut_public_prive");
		if (/^public/i.test(status)) t.add("operator:type", "public", 0.9, "statut_public_prive");
		else if (/priv/i.test(status)) t.add("operator:type", "private", 0.9, "statut_public_prive");
		// An address fills gaps only, and only whole: a postcode and city on an object with no
		// street is half an address, and the directory's street is sometimes in capitals.
		const at = schoolAddress(r);
		if (at) {
			fill(t.add("addr:housenumber", at.number, 0.8, "adresse_1"));
			fill(t.add("addr:street", at.street, 0.8, "adresse_1"));
			fill(t.add("addr:postcode", at.postcode, 0.85, "code_postal"));
			fill(t.add("addr:city", at.city, 0.85, "nom_commune"));
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
		};
	},
};

export const PRESETS: Preset[] = [irve, education];

export const presetById = (id: string | null) => PRESETS.find((p) => p.id === id);

export const detectPreset = (columns: string[]) => PRESETS.find((p) => p.detect(columns));

/** The evidence `when` column: the day the run read the source. */
export const evidenceDate = (d = new Date()) => fmtDate(d);
