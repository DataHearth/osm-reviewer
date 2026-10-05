import { STOP } from "./fr/words";

export function normaliseName(s: string): string {
	return (
		s
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			// Ligatures do not decompose under NFD: "Sœur" would lose its letter instead.
			.replace(/œ/g, "oe")
			.replace(/æ/g, "ae")
			.replace(/[^a-z0-9]+/g, " ")
			.trim()
	);
}

export const tokens = (s: string) =>
	new Set(
		normaliseName(s)
			.split(" ")
			.filter((w) => w && !STOP.has(w)),
	);

/**
 * Dice coefficient over word tokens, which survives "Pharmacie du Capitole" vs "Pharmacie Capitole".
 * Words in `ignore` count on neither side.
 */
export function nameSimilarity(a: string, b: string, ignore: Set<string> = new Set()): number {
	const ta = new Set([...tokens(a)].filter((w) => !ignore.has(w)));
	const tb = new Set([...tokens(b)].filter((w) => !ignore.has(w)));
	if (ta.size === 0 || tb.size === 0) return 0;
	let shared = 0;
	for (const w of ta) if (tb.has(w)) shared += 1;
	return (2 * shared) / (ta.size + tb.size);
}

/** A housenumber as OSM writes it from a directory's: "07" is 7, "158 BIS" is 158bis. */
export const houseNumber = (s: string) =>
	s
		.replace(/\s+/g, "")
		.toLowerCase()
		.replace(/(^|-)0+(?=\d)/g, "$1");

/**
 * An identifier keeps its meaning without its separators: mappers write `FR*TLS*P31555019`
 * where a registry writes `FRTLSP31555019`, and case varies.
 */
export const ids = (v: string) =>
	v
		.split(";")
		.map((x) => x.replace(/[\s*]/g, "").toUpperCase())
		.filter(Boolean);

export const values = (v: string) =>
	v
		.split(";")
		.map((x) => x.trim().replace(/\s+/g, ""))
		.filter(Boolean);
