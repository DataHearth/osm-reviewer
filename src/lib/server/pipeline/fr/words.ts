export const STOP = new Set([
	"le",
	"la",
	"les",
	"l",
	"de",
	"du",
	"des",
	"d",
	"et",
	"the",
	"of",
	"au",
	"aux",
]);

/** What a company tacks onto its name in one register and not another: "Power Dot France" is Powerdot. */
export const LEGAL_TAIL =
	/( (france|fr|sas|sasu|sa|sarl|eurl|snc|cpo|gmbh|bv|ltd|group|groupe|partner network|network))+$/;

/** A company's trade name as mappers write it, under the name a registry gives it. */
export const TRADING_AS: Record<string, string> = { alize: "bouygues" };

/** Words that say what an object is or its status, not which one it is. */
export const GENERIC = new Set([
	"borne",
	"bornes",
	"recharge",
	"station",
	"stations",
	"charging",
	"irve",
	"electrique",
	"vehicules",
	"prive",
	"privee",
	"public",
	"publique",
]);

/** How French files write "true". */
export const TRUE_WORDS = ["oui", "vrai"];

/** Columns French datasets keep a record's id, its name and its point in. */
export const ID_FIELDS = ["identifiant", "uai"];
export const NAME_FIELDS = ["nom"];
export const POINT_FIELDS = ["coordonnees"];

const UNITS = ["un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"];
const TEENS = ["dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];

/**
 * The days of a month as a street's date is spelt out, folded ("dix sept", "vingt et un"):
 * the address base writes "Rue du Onze Novembre 1918" where mappers write "Rue du 11 Novembre
 * 1918". A lone "un" is left out: it is an article as often as a number.
 */
const DAYS: [string, number][] = [
	["premier", 1],
	["1er", 1],
	...UNITS.slice(1).map((w, i): [string, number] => [w, i + 2]),
	...TEENS.map((w, i): [string, number] => [w, i + 10]),
	...UNITS.slice(6).map((w, i): [string, number] => [`dix ${w}`, i + 17]),
	["vingt", 20],
	["vingt et un", 21],
	...UNITS.slice(1).map((w, i): [string, number] => [`vingt ${w}`, i + 22]),
	["trente", 30],
	["trente et un", 31],
];

const DAY_WORDS = new RegExp(
	`(?<![a-z0-9])(${DAYS.map(([w]) => w)
		.sort((a, b) => b.length - a.length)
		.join("|")})(?![a-z0-9])`,
	"g",
);

const DAY_OF = new Map(DAYS);

/** A folded street name with its spelt-out days in digits. */
export const streetDigits = (folded: string) =>
	folded.replace(DAY_WORDS, (w) => String(DAY_OF.get(w)));

/** Link texts and paths that lead to a French site's practical details. */
export const LINK_HINTS = ["horaire", "pratique", "acc[eè]s", "a-propos", "qui-sommes"];
