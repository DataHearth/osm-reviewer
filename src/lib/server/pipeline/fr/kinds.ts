import type { Selector } from "../tagfilter";

/**
 * Kinds a mapper picks between for one place, so a record of one finds the others: a lycée's
 * STS is often mapped as the lycée's school, a private post-bac school as a university, and a
 * medico-social institute as a school. `amenity=kindergarten` is a crèche in France, another
 * place altogether.
 */
export const SCHOOLS = ["school", "college", "university"];

export const KIN: Record<string, Record<string, string[]>> = {
	amenity: {
		school: SCHOOLS,
		college: SCHOOLS,
		university: SCHOOLS,
		social_facility: ["social_facility", "school"],
	},
};

/** Whom an institute takes in. A care home, a shelter or a health service is another place. */
const INSTITUTE_FOR = ["disabled", "child", "juvenile", "blind", "deaf", "intellectual_disability"];

/** Whether a social facility is one an institute of the directory could be mapped as. */
export function institute(tags: Record<string, string>): boolean {
	const whom = (tags["social_facility:for"] ?? "").split(";").map((w) => w.trim());
	return (
		tags.social_facility !== "healthcare" &&
		(!whom.some(Boolean) || whom.some((w) => INSTITUTE_FOR.includes(w)))
	);
}

/** An institute mapped as the health centre it shares an address with, a maternelle as a kindergarten. */
export const LOOKALIKE_KINDS: Record<string, Selector[]> = {
	"amenity=school": [{ k: "amenity", v: ["kindergarten"] }],
	"amenity=social_facility": [
		{ k: "healthcare", v: ["centre"] },
		{ k: "amenity", v: ["clinic"] },
	],
};
