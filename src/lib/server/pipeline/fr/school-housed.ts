import type { SkipFunction } from "../mapping/record";
import { fold } from "./text";

const SEGPA = "390";

/** A lycée's vocational (SEP) and general-and-technological (SEGT) sections. */
const LYCEE_SECTIONS = ["334", "335"];

/**
 * A SEGPA or a lycée's section lives in its parent's buildings, with the parent's SIRET and
 * switchboard: it is not a place of its own on the map. The directory attaches most as
 * sections, a SEGPA sometimes as a geographic annex, and a SEGT too (Toulouse's Sainte-Marie
 * Saint-Sernin, at its lycée's address); a lycée's annex elsewhere is a site of its own.
 */
export const housedSection: SkipFunction = (r, rowsOf) => {
	if (/section/i.test(r.attachment_type)) return true;
	if (r.nature_code === SEGPA) return true;
	return (
		LYCEE_SECTIONS.includes(r.nature_code) &&
		!!r.parent_id &&
		(rowsOf(r.parent_id) ?? []).some(
			(p) => fold(p.street) === fold(r.street) && p.postcode === r.postcode,
		)
	);
};
