import { fill, type Preset, Tags } from "../preset";
import { findCoords, str, truthy, website } from "../row";
import { houseNumber, tokens } from "../text";
import type { ProposedTag, Row } from "../types";
import { addressBase } from "./ban";
import { bare, schoolName } from "./school-name";
import { addressQuery, expandStreet, mobileFR, phoneFR, spacedNumber } from "./text";

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

/** No lieu-dit or hameau: an address there is `addr:place` in OSM, which this does not write. */
const STREET =
	/^(rue|ruelle|avenue|boulevard|cheminement|chemin|place|port|allée|allées|impasse|route|quai|cours|cour|square|voie|passage|esplanade|rond-point|carrefour|montée|chaussée|parvis|promenade|sentier|traverse|venelle|faubourg|clos|cité|résidence|lotissement|domaine|villa|mail|parc|grande? rue|petite rue)(?![\p{L}\d])/iu;

/**
 * How far the directory's point may sit from its own housenumber before the address is taken
 * over the point. A school's grounds can stretch a few hundred metres from its gate.
 */
const SCHOOL_FAR_M = 1000;

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
	// A CEDEX code the lines do not flag (69321) only costs the address base its first try,
	// which the retry with the commune alone recovers.
	const postcode = /cedex|\bbp\b|\bcs ?\d/i.test(mail) ? "" : str(r, "code_postal");
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
export const education: Preset = {
	id: "annuaire-education",
	label: "Annuaire de l'éducation",
	keyField: "identifiant_de_l_etablissement",
	detect: (c) => c.includes("identifiant_de_l_etablissement") && c.includes("nom_etablissement"),
	key: (r) => str(r, "identifiant_de_l_etablissement") || null,
	position: (r) => findCoords(r),
	address: addressBase,
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
		if (phone && mobileFR(phone)) withheld += 1;
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
