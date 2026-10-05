/** Initialisms a directory name keeps in capitals on purpose. */
const ACRONYMS = new Set([
	"EREA",
	"SEGPA",
	"ULIS",
	"LEGTA",
	"LEPA",
	"ITEP",
	"DITEP",
	"IME",
	"IMPRO",
	"IEM",
	"IES",
	"SESSAD",
	"SEPAD",
	"CAMSP",
	"CMPP",
	"IFSI",
	"ISSEC",
	"EPNAK",
	"IESCA",
	"ICS",
	"ASEI",
	"OVE",
	"ISO",
]);

/** Small words a name written all in capitals has in capitals too. */
const PARTICLES = new Set(["DE", "DES", "DU", "LA", "LE", "LES", "ET", "AU", "AUX", "EN", "SUR"]);

/** Words the directory, or a name quieted from capitals, writes without their accents. */
const ACCENTED = [
	"École",
	"Écoles",
	"Établissement",
	"Établissements",
	"Éducation",
	"Éducatif",
	"Éducative",
	"Éducatifs",
	"Éducatives",
	"Évaluation",
	"Étude",
	"Études",
	"Élémentaire",
	"Épée",
	"Médico",
	"Pédagogique",
	"Thérapeutique",
	"Spécialisé",
	"Spécialisée",
	"Supérieur",
	"Supérieure",
	"Privé",
	"Privée",
	"Visée",
	"Collège",
	"Lycée",
	"Métiers",
	"Éclat",
];

/** Names, which keep their capital even where the directory dropped it ("La boetie"). */
const ACCENTED_NAMES = ["Élise", "Émile", "Étienne", "Édouard", "Boétie"];

export const bare = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");

const spellings = (w: string, lower: string): [string, string][] => [
	[bare(w), w],
	[bare(w).toLowerCase(), lower],
];

const UNACCENTED = new Map([
	...ACCENTED.flatMap((w) => spellings(w, w.toLowerCase())),
	// A name written with its accent but no capital ("la boétie") gets its capital all the same.
	...ACCENTED_NAMES.flatMap((w): [string, string][] => [...spellings(w, w), [w.toLowerCase(), w]]),
]);

const UNACCENTED_WORD = new RegExp(
	`(?<![\\p{L}\\d])(${[...UNACCENTED.keys()].join("|")})(?![\\p{L}\\d])`,
	"gu",
);

const capitals = (word: string) => /\p{Lu}{2}/u.test(word) && !/\p{Ll}/u.test(word);

/** Short or vowelless capitals are an organisation's letters ("ORT", "CHU"); longer ones are words. */
const initialism = (w: string) => ACRONYMS.has(w) || w.length <= 4 || !/[AEIOUY]/.test(w);

/**
 * The directory drops the accent off "École" and shouts surnames ("Rosa PARKS"), sometimes
 * a brand ("CAMAS ACADEMY") or the whole name; OSM France writes neither. A single word in
 * capitals anywhere else is left as written: it is an initialism as often as a brand
 * ("IPESS", "CESDDA", "ADONIS"), and only the school can say which.
 *
 * "hors contrat" goes: it is the private school's legal status (no contract with the state),
 * which the directory writes into the name on 29 of its 111 such schools in Toulouse and Lyon.
 * OSM has no key for it, and of 773 school names already mapped there 1 keeps it; mappers who
 * named these schools wrote "École primaire privée Les Sarments", not "…privée hors contrat…".
 */
export function schoolName(raw: string): string {
	const shouting = raw === raw.toUpperCase();
	const quiet = (w: string) => w[0] + w.slice(1).toLowerCase();
	let out = raw
		.replace(/\s+/g, " ")
		.replace(/ hors[- ]contrat\b/i, "")
		.replace(/\p{Lu}{2,}/gu, (w, at: number, all: string) => {
			if (ACRONYMS.has(w)) return w;
			if (shouting) return PARTICLES.has(w) ? w.toLowerCase() : quiet(w);
			const start = all.lastIndexOf(" ", at) + 1;
			const end = all.indexOf(" ", at) < 0 ? all.length : all.indexOf(" ", at);
			const before = all.slice(0, start).trimEnd().split(" ").pop() ?? "";
			const after = all.slice(end).trimStart().split(" ")[0];
			if (capitals(before) || capitals(after)) {
				if (PARTICLES.has(w)) return w.toLowerCase();
				return initialism(w) ? w : quiet(w);
			}
			// In a name written in mixed case, capitals after a first name or a particle are a
			// surname ("Rosa PARKS", "Pierre de FERMAT"); anywhere else an initialism ("ESTM").
			return SURNAME_AFTER.test(before) ? quiet(w) : w;
		})
		.replace(UNACCENTED_WORD, (w) => UNACCENTED.get(w) ?? w)
		.replace(STUTTER, (w, first: string, second: string) =>
			first.toLowerCase() === second && !"aelo".includes(second) ? first : w,
		)
		// French writes the particle small inside a name ("Geneviève de Gaulle"), only the
		// directory capitalises it there ("Institut De Fourvière").
		.replace(/(?<=\S )(De|Du|Des)(?= \p{Lu})/gu, (w) => w.toLowerCase());
	if (shouting) out = out.replace(/ A (?=\p{L})/gu, " à ");
	return out[0].toUpperCase() + out.slice(1);
}

/**
 * A capital typed twice ("Iinstitut"). No French word starts that way, but names can
 * ("Aaron", "Eeckhout", "Lloyd", "Oosterhof"), so a doubled A, E, L or O stays.
 */
const STUTTER = /(?<![\p{L}\d])(\p{Lu})(\p{Ll})(?=\p{Ll})/gu;

const SURNAME_AFTER = /^(\p{Lu}\p{Ll}+([-'’]\p{Lu}\p{Ll}+)*|de|du|des|d'|la|le)$/u;
