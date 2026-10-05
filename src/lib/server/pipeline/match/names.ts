import { communeOf } from "../fr/text";
import { GENERIC, LEGAL_TAIL, TRADING_AS } from "../fr/words";
import { nameSimilarity, normaliseName, tokens } from "../text";
import type { Extraction, OsmElement } from "../types";

export const NAME_MATCH = 0.5;

/** What a mapper's name scores when every word of it is in the record's. */
export const WHOLE_NAME = 0.8;

/**
 * Who runs or owns a place, which an OSM object with no name often still says. A city's
 * network is as often named by its owner as by its operator (Toulibeo, run by Bouygues).
 */
const WHO = ["operator", "network", "brand", "owner"];

export const whoOf = (x: Partial<Pick<Extraction, "tags">>) =>
	(x.tags ?? []).filter((t) => WHO.includes(t.k)).map((t) => t.v);

export const whoOn = (tags: Record<string, string>) => WHO.map((k) => tags[k]).filter(Boolean);

const company = (s: string) => {
	const c = normaliseName(s).replace(LEGAL_TAIL, "").replace(/ /g, "");
	return TRADING_AS[c] ?? c;
};

/** Shorter than this, one company name inside another is a coincidence. */
const COMPANY_MIN = 4;

function companySimilarity(a: string, b: string): number {
	const [ca, cb] = [company(a), company(b)];
	if (ca && ca === cb) return 1;
	const [short, long] = ca.length < cb.length ? [ca, cb] : [cb, ca];
	if (short.length >= COMPANY_MIN && long.includes(short)) return 1;
	return nameSimilarity(a, b);
}

/** How well two sides' operators, networks or owners agree; null when either side says nothing. */
export function companiesAgree(ours: string[], theirs: string[]): number | null {
	if (!ours.length || !theirs.length) return null;
	return Math.max(...ours.flatMap((a) => theirs.map((b) => companySimilarity(a, b))));
}

export const whoSimilarity = (x: Partial<Pick<Extraction, "tags">>, e: OsmElement) =>
	companiesAgree(whoOf(x), whoOn(e.tags));

export const whoAgrees = (x: Partial<Pick<Extraction, "tags">>, e: OsmElement) =>
	(whoSimilarity(x, e) ?? 0) >= NAME_MATCH;

type Named = Pick<Extraction, "name"> & Partial<Pick<Extraction, "tags" | "addr">>;

/**
 * The commune's words, which name half the places in it: "INSEEC MSc Toulouse" is not
 * "INSEEC Toulouse" for sharing "Toulouse".
 */
function communeWords(x: Named, e: OsmElement): Set<string> {
	const commune = communeOf(x.addr ?? "");
	const city = x.tags?.find((t) => t.k === "addr:city")?.v ?? "";
	const theirs = e.tags["addr:city"] ?? e.tags["contact:city"] ?? "";
	return new Set([commune, city, theirs].flatMap((s) => [...tokens(s)]));
}

/**
 * How well an OSM name names the record, or null when it names nothing: a generic label
 * ("Recharge", "Borne de recharge Révéo") or the operator's own name ("Allego"), which leave
 * the operator to decide. A mapper's short name all inside the record's long one ("La Fourmi"
 * in "École élémentaire privée La Fourmi") counts as a strong match.
 */
export function nameScore(x: Named, e: OsmElement): number | null {
	const commune = communeWords(x, e);
	const words = (s: string) => [...tokens(s)].filter((w) => !GENERIC.has(w) && !commune.has(w));
	const theirs = words(e.tags.name ?? "");
	const ours = new Set(words(x.name));
	const inOurs = theirs.every((w) => ours.has(w));
	// An operator named after its one place ("Association La Fourmi") does not make the
	// place's name a brand.
	const who = new Set([...whoOf(x), ...WHO.map((k) => e.tags[k] ?? "")].flatMap(words));
	if (!theirs.length || (!inOurs && theirs.every((w) => who.has(w)))) return null;
	const dice = nameSimilarity(x.name, e.tags.name, commune);
	return inOurs ? Math.max(dice, WHOLE_NAME) : dice;
}
