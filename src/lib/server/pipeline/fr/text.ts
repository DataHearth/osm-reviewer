export function phoneFR(raw: string): string | null {
	let d = raw.replace(/\(0\)/, "").replace(/[\s.\-()]/g, "");
	if (d.startsWith("+33")) d = `0${d.slice(3)}`;
	else if (d.startsWith("0033")) d = `0${d.slice(4)}`;
	if (!/^0[1-9]\d{8}$/.test(d)) return null;
	return `+33 ${d[1]} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
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
 * Whether a postcode is a place's rather than a CEDEX mail route, which the address lines do
 * not always say (69321, 31506). La Poste gives places codes ending in 0, except the
 * arrondissements of Paris, Lyon and Marseille and the overseas departments.
 */
export const placePostcode = (cp: string) =>
	/^\d{4}0$|^750\d\d$|^6900\d$|^130\d\d$|^9[78]\d{3}$/.test(cp);
