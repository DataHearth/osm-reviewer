import { compactNumber, normaliseName } from "../text";

/** National prefixes of the overseas departments and Saint-Pierre-et-Miquelon, to their country code. */
const OVERSEAS: Record<string, string> = {
	"0262": "262",
	"0263": "262",
	"0269": "262",
	"0692": "262",
	"0693": "262",
	"0639": "262",
	"0590": "590",
	"0690": "590",
	"0691": "590",
	"0594": "594",
	"0694": "594",
	"0596": "596",
	"0696": "596",
	"0697": "596",
	"0508": "508",
};

const pairs = (d: string) => d.match(/\d\d/g)?.join(" ") ?? "";

/**
 * A French number as FR:Key:phone writes it: `+33 5 61 23 45 67`; an 08 number, which cannot
 * be dialled from abroad, `08 06 14 15 00`; an overseas one under its own code with its whole
 * national number, `+262 262 12 34 56`, except Saint-Pierre-et-Miquelon's six digits, `+508 41 23 45`.
 */
export function phoneFR(raw: string): string | null {
	let d = raw.replace(/\(0\)/, "").replace(/[\s.\-()]/g, "");
	const intl = /^(?:\+|00)(33|262|590|594|596|508)(\d+)$/.exec(d);
	if (intl) d = `0${intl[1] === "508" ? "508" : ""}${intl[2]}`;
	if (!/^0[1-9]\d{8}$/.test(d)) return null;
	const code = OVERSEAS[d.slice(0, 4)];
	if (intl && intl[1] !== "33" && intl[1] !== code) return null;
	if (code === "508") return `+508 ${pairs(d.slice(4))}`;
	if (code) return `+${code} ${d.slice(1, 4)} ${pairs(d.slice(4))}`;
	if (d[1] === "8") return pairs(d);
	return `+33 ${d[1]} ${pairs(d.slice(2))}`;
}

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
 * What to ask the address base for a line: with its postcode and commune, unless the line
 * already carries them. Naming the commune twice costs the match a third of its score.
 */
export function addressQuery(line: string, postcode: string, city: string): string {
	const q = expandStreet(line);
	return postcode && q.includes(postcode) ? q : [q, postcode, city].filter(Boolean).join(" ");
}

/**
 * A housenumber as Lyon's and Toulouse's mappers write it: "74 bis", not the address base's
 * "74bis", and a letter suffix in capitals, "6A", as FR:Adresses does.
 */
export const spacedNumber = (s: string) =>
	compactNumber(s)
		.replace(
			/(\d)(bis|ter|quater|quinquies)$/i,
			(_, n: string, w: string) => `${n} ${w.toLowerCase()}`,
		)
		.replace(/(\d)([a-z])(?=$|-)/g, (_, n: string, l: string) => n + l.toUpperCase());

/** `+33 5 61…` and `05 61…` are the same line, and so are `+262 262…` and `0262…`. */
export const digits = (s: string) =>
	s
		.replace(/\D/g, "")
		.replace(/^(?:00)?(?:33|262|590|594|596)(?=\d{9}$)/, "0")
		.replace(/^(?:00)?508(?=\d{6}$)/, "0508");

/** A mobile line, metropolitan (06, 07) or overseas (0692, 0690…). */
export const mobileFR = (phone: string) => /^0[67]/.test(digits(phone));

export const fold = (s: string) => normaliseName(s.replace(/&/g, " et "));

/** What follows the postcode in an address line. */
export const communeOf = (addr: string) => /.*\d{5}\s*(\D.*)$/.exec(addr)?.[1] ?? "";

/** How the model is told to write a phone number. */
export const PHONE_FORMAT =
	"phone numbers as +33 5 61 23 45 67, except 08 numbers as 08 06 14 15 00 and overseas numbers under their own code as +262 262 12 34 56";
