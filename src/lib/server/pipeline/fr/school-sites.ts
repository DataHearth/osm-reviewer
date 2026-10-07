import type { SitesFunction } from "../mapping/record";
import { coord, website } from "../row";
import { fold, phoneFR } from "./text";

/** Two rows of a UAI at one address and point are the directory repeating itself, not two sites. */
const placeOf = (r: Record<string, string>) =>
	[fold(r.street), r.postcode, coord(r.lat, r.lon)?.join(",")].join("|");

/**
 * For a UAI over several sites, the phone and website the other rows give are values OSM may hold
 * as well. The website prefers https where another of the UAI's rows spells the same address that
 * way.
 */
export const alsoAtOtherSites: SitesFunction = (rows, main, tags) => {
	const tag = (k: string) => tags.find((t) => t.k === k);
	alsoAt(
		tag("phone"),
		rows.map((row) => phoneFR(row.phone)),
	);

	const sites = rows.map((row) => website(row.website));
	const siteOf = (i: number) => {
		const v = sites[i];
		const secure = v?.replace(/^http:/, "https:");
		return secure && sites.includes(secure) ? secure : v;
	};
	const site = tag("website");
	if (site) {
		site.v = siteOf(main) ?? site.v;
		alsoAt(
			site,
			rows.map((_, i) => siteOf(i)),
		);
	}

	const places = new Set(rows.map(placeOf)).size;
	return places > 1
		? [
				`The directory lists this UAI at ${places} sites; the details are ${rows[main].street}'s, the main one`,
			]
		: [];
};

function alsoAt(
	tag: { v: string; also?: string[] } | undefined,
	read: (string | null | undefined)[],
) {
	if (!tag) return;
	const also = [...new Set(read)].filter((v): v is string => !!v && v !== tag.v);
	if (also.length) tag.also = also;
}
