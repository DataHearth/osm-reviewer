import { renameRow } from "../mapping/compile";
import { evaluate } from "../mapping/evaluate";
import { programFor } from "../mapping/files";
import type { Preset } from "../preset";
import { findCoords, str } from "../row";
import type { ProposedTag, Row } from "../types";
import { addressBase } from "./ban";
import { functions } from "./functions";
import { MAILBOX } from "./mailbox";
import { SCHOOL_FAR_M, schoolAddress } from "./school-address";
import { alsoAtOtherSites } from "./school-sites";
import { fold, phoneFR } from "./text";

const SOURCE = "fr/annuaire-education";

/** The columns older exports spell otherwise, each read where the current one is empty. */
const ALIASES: Record<string, string> = {
	etat: "etat_etablissement",
	siren_siret: "numero_siren_siret",
	web: "site_web",
};

/** Positions the directory gives to the building; anything coarser is worth a look. */
const EXACT = /^(parfaite|num[ée]ro de rue)$/i;

const SEGPA = "390";

/** A lycée's vocational (SEP) and general-and-technological (SEGT) sections. */
const LYCEE_SECTIONS = ["334", "335"];

const sameLine = (a: Row, b: Row) =>
	fold(str(a, "adresse_1")) === fold(str(b, "adresse_1")) &&
	str(a, "code_postal") === str(b, "code_postal");

/**
 * A SEGPA or a lycée's section lives in its parent's buildings, with the parent's SIRET and
 * switchboard: it is not a place of its own on the map. The directory attaches most as
 * sections, a SEGPA sometimes as a geographic annex, and a SEGT too (Toulouse's Sainte-Marie
 * Saint-Sernin, at its lycée's address); a lycée's annex elsewhere is a site of its own.
 */
function housedSection(r: Row, rowsOf?: (key: string) => Row[] | undefined): boolean {
	if (/section/i.test(str(r, "type_rattachement_etablissement_mere"))) return true;
	const nature = str(r, "code_nature");
	if (nature === SEGPA) return true;
	const parent = str(r, "etablissement_mere");
	return (
		LYCEE_SECTIONS.includes(nature) &&
		!!parent &&
		(rowsOf?.(parent) ?? []).some((p) => sameLine(p, r))
	);
}

/** Two rows of a UAI at one address and point are the directory repeating itself, not two sites. */
const placeOf = (r: Row) =>
	[fold(str(r, "adresse_1")), str(r, "code_postal"), findCoords(r)?.join(",")].join("|");

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

interface Quote {
	field: string;
	shown?: string;
	kind?: string;
}

/**
 * The one column each tag quotes in the evidence panel, which is not always the one its rule
 * reads: a school's main tag quotes the directory's own label for its nature.
 */
const QUOTED: Record<string, (r: Row) => Quote> = {
	amenity: (r) => ({ field: "libelle_nature", shown: str(r, "libelle_nature"), kind: "derived" }),
	"social_facility:for": (r) => ({
		field: "libelle_nature",
		shown: str(r, "libelle_nature"),
		kind: "derived",
	}),
	"school:FR": (r) =>
		/^[ée]cole/i.test(str(r, "type_etablissement"))
			? {
					field: "ecole_maternelle",
					shown: `${str(r, "ecole_maternelle") || "0"}, ecole_elementaire: ${str(r, "ecole_elementaire") || "0"}`,
					kind: "derived",
				}
			: { field: "type_etablissement", kind: "derived" },
	name: () => ({ field: "nom_etablissement" }),
	"ref:UAI": () => ({ field: "identifiant_de_l_etablissement" }),
	"ref:FR:SIRET": (r) => ({
		field: "siren_siret",
		shown: str(r, "siren_siret", "numero_siren_siret"),
	}),
	phone: () => ({ field: "telephone", kind: "normalised" }),
	website: () => ({ field: "web" }),
	email: () => ({ field: "mail" }),
	start_date: () => ({ field: "date_ouverture" }),
	"operator:type": () => ({ field: "statut_public_prive" }),
	"addr:housenumber": () => ({ field: "adresse_1" }),
	"addr:street": () => ({ field: "adresse_1" }),
	"addr:postcode": () => ({ field: "code_postal" }),
	"addr:city": () => ({ field: "nom_commune" }),
};

function quoted(key: string, r: Row): Pick<ProposedTag, "path" | "kind" | "parts"> {
	const { field, shown, kind = "dataset row" } = QUOTED[key](r);
	return {
		path: field,
		kind,
		parts: [
			{ text: `${field}: `, mark: false },
			{ text: (shown ?? str(r, field)) || "—", mark: true },
		],
	};
}

/** What the source gave and no tag carries: a mobile number, a mailbox that reads as a person's. */
function withheld(r: Row, tags: ProposedTag[]): number {
	const has = (k: string) => tags.some((t) => t.k === k);
	const mail = str(r, "mail");
	return (
		(phoneFR(str(r, "telephone")) && !has("phone") ? 1 : 0) +
		(MAILBOX.test(mail) && !has("email") ? 1 : 0)
	);
}

const withAliases = (r: Row): Row =>
	Object.fromEntries(
		Object.entries(ALIASES).map(([column, old]) => [column, str(r, column, old)]),
	) as Row;

/** Annuaire de l'éducation. */
export const education: Preset = {
	id: "annuaire-education",
	label: "Annuaire de l'éducation",
	keyField: "identifiant_de_l_etablissement",
	detect: (c) => c.includes("identifiant_de_l_etablissement") && c.includes("nom_etablissement"),
	key: (r) => str(r, "identifiant_de_l_etablissement") || null,
	position: (r) => findCoords(r),
	address: addressBase,
	siteQuery: (r) => schoolAddress(r)?.query ?? null,
	extract(rows, url, gaps, rowsOf) {
		const r = mainSite(rows, gaps);
		const pos = education.position(r);
		const key = education.key(r);
		if (!pos || !key || housedSection(r, rowsOf)) return null;
		const program = programFor(SOURCE);
		const given = { ...r, ...withAliases(r) };
		const inputs = renameRow(
			program,
			Object.fromEntries([...program.rename.keys()].map((column) => [column, str(given, column)])),
		);
		const made = evaluate(program, [inputs], functions);
		if (!made) return null;

		const name = made.tags.find((t) => t.key === "name")?.value ?? "";
		const tags: ProposedTag[] = made.tags.map((t) => ({
			k: t.key,
			v: t.value,
			conf: t.conf,
			...quoted(t.key, r),
			...(t.addOnly ? { addOnly: true } : {}),
			...(t.group ? { group: t.group } : {}),
		}));
		alsoAtOtherSites(tags, rows, r);

		const siret = str(r, "siren_siret", "numero_siren_siret").replace(/\s/g, "");
		const at = schoolAddress(r);
		const places = new Set(rows.map(placeOf)).size;
		const precision = str(r, "precision_localisation");
		const state = str(r, "etat", "etat_etablissement");
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
			closedBy: made.closed
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
			tags,
			notes: [
				...(places > 1
					? [
							`The directory lists this UAI at ${places} sites; the details are ${str(r, "adresse_1")}'s, the main one`,
						]
					: []),
				...(precision && !EXACT.test(precision)
					? [`The directory places it only to the precision of: ${precision}`]
					: []),
			],
			geocode: at ? { q: at.query, farM: SCHOOL_FAR_M } : undefined,
			withheld: withheld(r, tags),
		};
	},
};
