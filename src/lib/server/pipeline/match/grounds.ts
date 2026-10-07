import { distance } from "../geo";
import { sameKind, shell } from "../tagfilter";
import type { OsmElement } from "../types";
import type { Findable } from "./find";
import { NAME_MATCH, nameScore } from "./names";
import { mainOf } from "./ops";
import { MATCH_RADIUS_M, SPLIT_RADIUS_M } from "./radii";

/**
 * The object mapped as the place that a shell stands in or beside: one of its kind next to
 * it, or one named like the record a little farther, since only centres are known and a
 * building inside large grounds stands well off theirs.
 */
export function groundsOf(x: Findable, building: OsmElement, els: OsmElement[]): OsmElement | null {
	const main = mainOf(x);
	if (!main || !shell(building.tags)) return null;
	return (
		els
			.filter((e) => e !== building && sameKind(main.k, main.v, e.tags))
			.map((e) => ({ e, d: distance(building.lat, building.lon, e.lat, e.lon) }))
			.filter(
				({ e, d }) =>
					d <= SPLIT_RADIUS_M || (d <= MATCH_RADIUS_M && (nameScore(x, e) ?? 0) >= NAME_MATCH),
			)
			.sort((a, b) => a.d - b.d)[0]?.e ?? null
	);
}
