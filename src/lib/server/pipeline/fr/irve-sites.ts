import type { SiteLink } from "../extractor";
import { str } from "../row";
import { normaliseName } from "../text";
import type { Row } from "../types";
import { operatorOf, pointOf, TAIL } from "./irve-declarations";

/**
 * How far apart two declarations of one site can be placed. A re-declared site's position is
 * sometimes retyped (Tisséo Balma-Gramont moved 200 m in 2024 on two transposed digits).
 */
export const LINK_M = 400;

/**
 * A site moved to another operator's file keeps its points' numbers under the new operator's
 * prefix (EV Cars' FREVCE9009501 is Allego's FRALLEGO9009501). Seven digits are no accident
 * that close; under one operator they are its own numbering, and the site can have moved as far
 * as any re-declaration.
 */
const TAIL_M = 100;

/**
 * One car park declared as a station and its points as stations of their own a few metres apart
 * under its name or address (Bouygues spreads B612's eleven points along a line, 8 m apart).
 */
const SAME_SITE_M = 60;

/** What names one thing in every declaration of it, so records on one site become one. */
export function link(r: Row, record: Row[]): SiteLink[] {
	const point = pointOf(r);
	const who = operatorOf(r);
	const tail = point ? TAIL.exec(point)?.[0] : undefined;
	const name = normaliseName(str(r, "nom_station"));
	const address = normaliseName(str(r, "adresse_station"));
	const lone =
		new Set(record.map(pointOf)).size === 1 &&
		record.every((x) => !(Number.parseInt(str(x, "nbre_pdc"), 10) > 1));
	const ids: SiteLink[] = [];
	if (point) ids.push({ id: point, withinM: LINK_M });
	if (tail)
		ids.push(
			{ id: `tail ${tail}`, withinM: TAIL_M },
			{ id: `tail ${who} ${tail}`, withinM: LINK_M },
		);
	if (name) ids.push({ id: `name ${who} ${name}`, withinM: SAME_SITE_M, lone });
	if (address) ids.push({ id: `address ${who} ${address}`, withinM: SAME_SITE_M, lone });
	return ids;
}
