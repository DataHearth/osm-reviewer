import { tokens } from "../text";
import { bare } from "./school-name";

export const MAILBOX = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

/** A school's address at a webmail provider is as often a person's, which does not belong on the map. */
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
 * Whether a mailbox at a webmail provider names the school, its place or a role
 * ("gorge.de.loup@", "ecole.juive.de.lyon@", "latourrose@"): there the domain says nothing,
 * and a mailbox that names nothing ("fatemi60@", "esjb31@") may be someone's own.
 */
export function schoolMailbox(mail: string, name: string, place: string): boolean {
	const [local] = bare(mail).toLowerCase().split("@");
	const own = new Set([...tokens(name), ...tokens(place)]);
	const inside = [...ROLE_WORDS, ...own].filter((w) => w.length >= WORD_INSIDE);
	return local
		.split(/[^a-z]+/)
		.filter(Boolean)
		.some((p) => ROLE_WORDS.has(p) || own.has(p) || inside.some((w) => p.includes(w)));
}

/** Whether the directory's mailbox is one that reads as somebody's own and is left out. */
export const withheldMailbox = (mail: string, name: string, place: string) =>
	MAILBOX.test(mail) &&
	(WEBMAIL.test(mail) ? !schoolMailbox(mail, name, place) : personalMailbox(mail, name, place));
