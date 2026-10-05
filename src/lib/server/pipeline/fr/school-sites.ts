import { str, website } from "../row";
import type { ProposedTag, Row } from "../types";
import { phoneFR } from "./text";

/**
 * The code of the `fr.annuaire-education/sites` step: for a UAI over several sites, the phone and
 * website the other rows give are values OSM may hold as well. The website prefers https where
 * another of the UAI's rows spells the same address that way.
 */
export function alsoAtOtherSites(tags: ProposedTag[], rows: Row[], main: Row): void {
	const tag = (k: string) => tags.find((t) => t.k === k);
	alsoAt(tag("phone"), rows, (row) => phoneFR(str(row, "telephone")));

	const sites = rows.map((row) => website(str(row, "web", "site_web")));
	const siteOf = (row: Row) => {
		const v = sites[rows.indexOf(row)];
		const secure = v?.replace(/^http:/, "https:");
		return secure && sites.includes(secure) ? secure : v;
	};
	const site = tag("website");
	if (site) {
		site.v = siteOf(main) ?? site.v;
		alsoAt(site, rows, siteOf);
	}
}

function alsoAt(tag: ProposedTag | undefined, rows: Row[], read: (row: Row) => string | null) {
	if (!tag) return;
	const also = [...new Set(rows.map(read))].filter((v): v is string => !!v && v !== tag.v);
	if (also.length) tag.also = also;
}
