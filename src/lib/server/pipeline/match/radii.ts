/** Beyond this a name match is a different shop on the same street. */
export const MATCH_RADIUS_M = 50;

/**
 * An object of the same kind this close to a "new" POI is most likely it, mapped without the
 * name or identifier that would have matched it. IRVE points and directory addresses sit
 * up to ~125 m from where mappers put the object.
 */
export const DUPLICATE_RADIUS_M = 150;

/**
 * The farthest any rule reaches from a record to an object. What has to cover it, the
 * latitude cut in matching and the margin of the Overpass fetch, is derived from here.
 */
export const REACH_M = Math.max(MATCH_RADIUS_M, DUPLICATE_RADIUS_M);

/** Degrees of latitude over a distance (a degree is 111.2 km): a cheap cut before the haversine. */
export const latDegrees = (m: number) => m / 110_000;

/** Objects of one kind this close to a match are one site mapped as several objects. */
export const SPLIT_RADIUS_M = 25;

/** Farther than this, a place with the same operator or address is still likely the record's. */
export const SAME_OPERATOR_RADIUS_M = 300;
