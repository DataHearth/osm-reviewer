/** The establishment's number in the Éducation nationale's register. */
export const UAI = "ref:UAI";
/** The organisation's, which several establishments can share. */
export const SIRET = "ref:FR:SIRET";
/** What a banner calls it. */
export const SIRET_NAME = "SIRET";
/** A school's level, as OSM France writes it (FR:Key:school:FR). */
export const LEVEL = "school:FR";

/** An ENT, a school's pupil-and-parent login portal, which never replaces its public site. */
export const LOGIN_PORTAL = /(^|\.)ent\./;

/**
 * The level a `school:FR` value sits in: a lycée professionnel is a lycée, a lycée secondary.
 * Not a maternelle a primaire: whether a school has its maternelle classes, the directory knows.
 */
export const parentLevel = (v: string): string | null =>
	/^lycée\s/.test(v) ? "lycée" : v === "lycée" || v === "collège" ? "secondaire" : null;

export function levels(v: string): string[] {
	const out: string[] = [];
	for (let at: string | null = v; at; at = parentLevel(at)) out.push(at);
	return out;
}

export const schoolLevels = (v: string) =>
	v
		.split(";")
		.map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
		.filter(Boolean);

/**
 * A mapper's level that is finer than the directory's, or that takes it in, already says it:
 * "lycée professionnel" is a lycée, "secondaire" covers a collège.
 */
export const sameLevel = (a: string, b: string) =>
	schoolLevels(a).every((x) =>
		schoolLevels(b).some((y) => levels(x).includes(y) || levels(y).includes(x)),
	);

export const siretOf = (tags: Record<string, string>) =>
	(tags[SIRET] ?? tags.siret ?? "").replace(/\s/g, "") || null;

/** How a value of one of these keys agrees with another, where plain equality is too strict. */
export const SAME_VALUE: Record<string, (a: string, b: string) => boolean> = { [LEVEL]: sameLevel };
