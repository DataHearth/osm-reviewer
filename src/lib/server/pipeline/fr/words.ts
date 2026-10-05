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

/** Link texts and paths that lead to a French site's practical details. */
export const LINK_HINTS = ["horaire", "pratique", "acc[eè]s", "a-propos", "qui-sommes"];
