import { distance } from "../geo";
import { addressOf, label, type MatchedBy, matchedElsewhere, tagsOf } from "../match/describe";
import type { Hit, Kit, KitFactory, Lib, Subject } from "../match/kit";
import { NAME_MATCH, nameScore, WHOLE_NAME } from "../match/names";
import {
	DUPLICATE_RADIUS_M,
	MATCH_RADIUS_M,
	SAME_OPERATOR_RADIUS_M,
	SPLIT_RADIUS_M,
} from "../match/radii";
import { ids, nameSimilarity, normaliseName, tokens } from "../text";
import { type OsmElement, osmRef } from "../types";
import { fold } from "./text";
import { STATUS } from "./words";

const UAI = "ref:UAI";
const SIRET = "ref:FR:SIRET";
/** A school's level, as OSM France writes it (FR:Key:school:FR). */
const LEVEL = "school:FR";
const SCHOOLS = ["school", "college", "university"];

/** The `ce.<UAI>@ac-…` mailbox an académie gives every school, which names its establishment too. */
const ACADEMIE_MAIL = /^ce\.(\d{7}[a-z])@ac-/i;

/** An ENT, a school's pupil-and-parent login portal, which never replaces its public site. */
const LOGIN_PORTAL = /(^|\.)ent\./;

/** The coarser value an `operator:type` refines: a non-profit school is a private one. */
const OPERATOR_TYPE: Record<string, string> = {
	private_non_profit: "private",
	private_for_profit: "private",
	religious: "private",
	community: "private",
	government: "public",
	municipal: "public",
};

/** Whom an institute takes in. A care home, a shelter or a health service is another place. */
const INSTITUTE_FOR = ["disabled", "child", "juvenile", "blind", "deaf", "intellectual_disability"];

/** Whether a social facility is one an institute of the directory could be mapped as. */
function institute(tags: Record<string, string>): boolean {
	const whom = (tags["social_facility:for"] ?? "").split(";").map((w) => w.trim());
	return (
		tags.social_facility !== "healthcare" &&
		(!whom.some(Boolean) || whom.some((w) => INSTITUTE_FOR.includes(w)))
	);
}

/**
 * The level a `school:FR` value sits in: a lycée professionnel is a lycée, a lycée secondary.
 * Not a maternelle a primaire: whether a school has its maternelle classes, the directory knows.
 */
const parentLevel = (v: string): string | null =>
	/^lycée\s/.test(v) ? "lycée" : v === "lycée" || v === "collège" ? "secondaire" : null;

function levels(v: string): string[] {
	const out: string[] = [];
	for (let at: string | null = v; at; at = parentLevel(at)) out.push(at);
	return out;
}

const schoolLevels = (v: string) =>
	v
		.split(";")
		.map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
		.filter(Boolean);

/**
 * A mapper's level that is finer than the directory's, or that takes it in, already says it:
 * "lycée professionnel" is a lycée, "secondaire" covers a collège.
 */
const sameLevel = (a: string, b: string) =>
	schoolLevels(a).every((x) =>
		schoolLevels(b).some((y) => levels(x).includes(y) || levels(y).includes(x)),
	);

const siretOf = (tags: Record<string, string>) =>
	(tags[SIRET] ?? tags.siret ?? "").replace(/\s/g, "") || null;

const mailUai = (e: Pick<OsmElement, "tags">) =>
	ACADEMIE_MAIL.exec(e.tags["contact:email"] ?? e.tags.email ?? "")?.[1].toUpperCase();

const contactOf = (tags: Record<string, string>) =>
	[
		...["phone", "contact:phone"].map((k) => tags[k]?.replace(/\D/g, "").slice(-9)),
		...["email", "contact:email"].map((k) => tags[k]?.toLowerCase()),
	].filter((v): v is string => !!v);

/**
 * How far from the centre of a campus's grounds another establishment still stands in or
 * beside them. Only centres are known: Oullins' Notre-Dame du Bon Conseil école stands 50 m
 * from the centre of the "École et collège" grounds it is part of.
 */
const CAMPUS_REACH_M = 100;

/**
 * How near a "new" school an object of its kind carrying a UAI the directory no longer lists
 * is named: Lyon's Olympe de Gouges maternelle stands 13 m from the record it may have become.
 */
const UNLISTED_REACH_M = 50;

/** A school's level in its name: an école of any kind, a collège, a lycée. */
const LEVEL_WORDS: Record<string, string> = {
	ecole: "primaire",
	maternelle: "primaire",
	elementaire: "primaire",
	primaire: "primaire",
	college: "collège",
	lycee: "lycée",
};

/**
 * One object for several establishments: a cité scolaire, a "groupe scolaire", an
 * "Établissement (École, Collège, Lycée)". Whichever of them a record is, its opening is not
 * the object's.
 */
function campus(tags: Record<string, string>): boolean {
	const level = tags[LEVEL] ?? "";
	if (level === "secondaire" || level.includes(";")) return true;
	const name = normaliseName(tags.name ?? "");
	if (/\b(groupe|cite) scolaire\b/.test(name)) return true;
	return new Set(name.split(" ").flatMap((w) => LEVEL_WORDS[w] ?? [])).size > 1;
}

/** Words of a school's name that say which kind of school it is, finer than `LEVEL_WORDS`. */
const KIND_WORDS = new Set([
	...Object.keys(LEVEL_WORDS),
	"professionnel",
	"technologique",
	"polyvalent",
	"general",
	"agricole",
	"superieur",
	"groupe",
	"scolaire",
	"cite",
]);

/** The kind words of a name: "École maternelle X" and "École élémentaire X" are two schools. */
const kindWords = (name: string) =>
	[...tokens(name)]
		.filter((w) => KIND_WORDS.has(w))
		.sort()
		.join(" ");

/** What is left of a school's name without its kind and status: "Geneviève de Gaulle Anthonioz". */
const properName = (name: string) =>
	[...tokens(name)]
		.filter((w) => !KIND_WORDS.has(w) && !STATUS.has(w))
		.sort()
		.join(" ");

/** A maternelle is often mapped as the kindergarten it looks like, under its own name. */
const maternelleAs = (x: Subject, e: OsmElement) =>
	e.tags.amenity !== "kindergarten" ||
	(/maternelle/.test(x.tags?.findLast((t) => t.k === LEVEL)?.v ?? "") &&
		(nameScore(x, e) ?? 0) >= NAME_MATCH);

/**
 * A post-bac school whose object reads as a lycée, by its level or its name, is the lycée's
 * STS or CPGE, housed in it: the object stays a school, since `amenity=college` would unsay
 * the lycée a mapper wrote.
 */
function housedInLycee(x: Subject, current: Record<string, string>): string | null {
	if (!x.tags?.some((t) => t.k === "amenity" && t.v === "college")) return null;
	const lycee = /lycée/i.test(current[LEVEL] ?? "")
		? `${LEVEL}=${current[LEVEL]}`
		: /^lycee\b/.test(normaliseName(current.name ?? ""))
			? `name=${current.name}`
			: null;
	if (!lycee) return null;
	return `A post-bac section, “${x.name}”, is housed in this lycée (${lycee}): its amenity is left alone, so the object stays a school`;
}

export const kit: KitFactory = (lib: Lib): Kit => {
	const otherPlace = (e: OsmElement, x: Subject) => lib.rulesOut(e, x.refs, "hard");

	/** How many of the record's values the object already holds. */
	const held = (x: Subject, e: OsmElement): number =>
		(x.tags ?? []).filter((p) => {
			const had = e.tags[lib.keyOn(p.k, e.tags)];
			return had !== undefined && lib.sameValue(p.k, p.v, had);
		}).length;

	/**
	 * An object carrying another establishment's id is never the match, but one at the record's
	 * address, reached by its phone or email, or run under its SIRET may be this place under a
	 * stale id, or its sister school on one site: the reviewer has to see it. What the run's
	 * records matched to that object say counts as the object's own.
	 */
	const siblingOf = (
		x: Subject & { lat: number; lon: number },
		els: OsmElement[],
		matchedBy: MatchedBy,
	): string | null => {
		const ours = tagsOf({ tags: x.tags ?? [] });
		const at = addressOf(ours);
		const contact = new Set(contactOf(ours));
		const siret = siretOf(ours);
		const reason = (tags: Record<string, string>) =>
			at && addressOf(tags) === at
				? "the same address"
				: contactOf(tags).some((c) => contact.has(c))
					? "the same phone or email"
					: siret && siretOf(tags) === siret
						? "the same SIRET"
						: null;
		const hit = els
			.filter((e) => otherPlace(e, x))
			.map((e) => {
				const views = [e.tags, ...matchedElsewhere(e, x, matchedBy).map(tagsOf)];
				const why = views.map(reason).find(Boolean) ?? null;
				return { e, d: distance(x.lat, x.lon, e.lat, e.lon), why };
			})
			.filter((h) => h.why && h.d <= SAME_OPERATOR_RADIUS_M)
			.sort((a, b) => a.d - b.d)[0];
		if (!hit) return null;
		const id = hit.e.tags[UAI] ? ` (${UAI}=${hit.e.tags[UAI]})` : "";
		return `Another establishment${id} with ${hit.why} is mapped at ${label(hit.e, hit.d)}: check this is not it`;
	};

	/**
	 * Objects of the record's kind beside it whose UAI the source's whole read does not list:
	 * the place before a new UAI, or one closed since. Never the match, since the id is not the
	 * record's; the reviewer decides.
	 */
	const unlisted = (
		x: Subject,
		points: { lat: number; lon: number }[],
		els: OsmElement[],
		listed?: Set<string>,
	): string[] => {
		const main = lib.mainOf(x);
		if (!listed || !main || !x.refs[UAI]) return [];
		return els
			.filter((e) => lib.sameKind(main.k, main.v, e.tags))
			.map((e) => ({
				e,
				uais: lib.idsOn(UAI, e),
				d: Math.min(...points.map((p) => distance(p.lat, p.lon, e.lat, e.lon))),
			}))
			.filter(
				({ uais, d }) =>
					d <= UNLISTED_REACH_M && uais.length > 0 && !uais.some((id) => listed.has(id)),
			)
			.sort((a, b) => a.d - b.d)
			.map(
				({ e, uais, d }) =>
					`${osmRef(e)}${e.tags.name ? ` “${e.tags.name}”` : ""} ${Math.round(d)} m away carries UAI ${uais.join(", ")}, which the directory no longer lists`,
			);
	};

	const ownGrounds: NonNullable<Kit["ownGrounds"]> = (x, grounds, els) => {
		const level = x.tags?.find((t) => t.k === LEVEL)?.v;
		const theirs = grounds.tags[LEVEL];
		const shared =
			campus(grounds.tags) &&
			els.some(
				(e) =>
					e !== grounds &&
					otherPlace(e, x) &&
					distance(grounds.lat, grounds.lon, e.lat, e.lon) <= CAMPUS_REACH_M,
			);
		return (
			!shared &&
			!otherPlace(grounds, x) &&
			(!grounds.tags.name || (nameScore(x, grounds) ?? 0) >= NAME_MATCH) &&
			(!level || !theirs || sameLevel(level, theirs))
		);
	};

	return {
		/**
		 * The school among several objects carrying its UAI side by side, as a bare node beside
		 * the grounds often does: the one named for it, then the way or relation, or whichever
		 * holds more of what the record says.
		 */
		pick: (x, hits: Hit[]) => {
			if (!x.refs[UAI]) return hits[0].e;
			const named = (e: OsmElement) =>
				e.tags.name && (nameScore(x, e) ?? 0) >= NAME_MATCH ? 1 : 0;
			const rank = (e: OsmElement) => held(x, e) + (e.type === "node" ? 0 : 1);
			const near = hits.filter((h) => h.d <= hits[0].d + MATCH_RADIUS_M);
			return near.sort((a, b) => named(b.e) - named(a.e) || rank(b.e) - rank(a.e) || a.d - b.d)[0]
				.e;
		},
		ownGrounds,
		place: (x, el) => {
			const shared = campus(el.tags);
			const housed = housedInLycee(x, el.tags);
			if (!shared && !housed) return null;
			return {
				leave: (o) =>
					(shared && (o.k === "start_date" || o.k === LEVEL)) || (!!housed && o.k === "amenity"),
				notes: housed ? [housed] : [],
			};
		},
		/**
		 * An object of the record's kind under the matched one's own name a little off it, too far
		 * to be part of its site: the place may be mapped twice. So is one carrying no id under
		 * that name spelt a little otherwise ("privé" for "privée", "Baptiste" for
		 * "Jean-Baptiste"), but a name of another kind of school is a sister school ("École
		 * maternelle Jean Mermoz" beside the élémentaire). A groupe scolaire around the school
		 * holds it rather than repeats it, unless it stands at the record's own address or holds
		 * no other establishment.
		 */
		namesake: (x, el, e, { els, matchedBy }) => {
			const ours = el.tags.name ?? x.name;
			const at = addressOf(tagsOf({ tags: x.tags ?? [] }));
			const holdsOthers = () =>
				els.some(
					(o) =>
						otherPlace(o, x) &&
						properName(o.tags.name ?? "") === properName(e.tags.name ?? "") &&
						distance(o.lat, o.lon, e.lat, e.lon) <= DUPLICATE_RADIUS_M,
				) ||
				[...matchedBy.values()]
					.flat()
					.some((o) => o.key !== x.key && properName(o.name) === properName(e.tags.name ?? ""));
			if (campus(e.tags))
				return (
					!!properName(e.tags.name ?? "") &&
					properName(e.tags.name ?? "") === properName(ours) &&
					((!!at && addressOf(e.tags) === at) || !holdsOthers())
				);
			if (!el.tags.name) return (nameScore(x, e) ?? 0) >= WHOLE_NAME;
			return (
				fold(e.tags.name ?? "") === fold(el.tags.name) ||
				(!lib.idsOn(UAI, e).length &&
					nameSimilarity(e.tags.name ?? "", el.tags.name) >= WHOLE_NAME &&
					kindWords(e.tags.name ?? "") === kindWords(el.tags.name))
			);
		},
		matchedBanners: (x, el, { grounds, split }) => {
			const amenity = x.tags?.find((t) => t.k === "amenity" && SCHOOLS.includes(t.v));
			const before: string[] = [];
			const noun = amenity
				? "school"
				: x.tags?.some((t) => t.k === "amenity" && t.v === "social_facility")
					? "institute"
					: null;
			if (noun && grounds)
				before.push(
					`OSM maps this ${noun} as building=${el.tags.building} beside ${label(grounds, distance(el.lat, el.lon, grounds.lat, grounds.lon))}, mapped as amenity=${grounds.tags.amenity}: amenity and name are left out, so the ${noun} is not mapped twice`,
				);
			else if (amenity && lib.shell(el.tags))
				before.push(
					`OSM maps this school only as building=${el.tags.building}: amenity=${amenity.v} is added to the building`,
				);
			// A school's UAI on an object well off this one is another site of it, or a stale
			// copy: not a part of this site.
			const ours = new Set(ids(x.refs[UAI] ?? ""));
			const apart = split.filter(
				(k) => k.d > SPLIT_RADIUS_M && lib.idsOn(UAI, k.e).some((id) => ours.has(id)),
			);
			return {
				before,
				here: split.filter((k) => !apart.includes(k)),
				after: apart.map((k) => `Another object carrying this UAI is ${label(k.e, k.d)}`),
			};
		},
		newBanners: (x, { points, els, matchedBy, listed }) => ({
			sibling: siblingOf(x, els, matchedBy),
			unlisted: unlisted(x, points, els, listed),
		}),
		accepts: { "amenity=social_facility": institute },
		lookalikes: { "amenity=school": maternelleAs },
		same: {
			[LEVEL]: sameLevel,
			"operator:type": (a, b) => OPERATOR_TYPE[b] === a,
			"website.host": (a) => LOGIN_PORTAL.test(a),
		},
		refs: { [UAI]: { also: mailUai } },
	};
};
