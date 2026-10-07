/** Beyond this a name match is a different shop on the same street. */
export const MATCH_RADIUS_M = 50;

/** Degrees of latitude a bit over the farthest match: a cheap cut before the haversine. */
export const LAT_PREFILTER = 0.0014;

/**
 * An object of the same kind this close to a "new" POI is most likely it, mapped without the
 * name or identifier that would have matched it. IRVE points and directory addresses sit
 * up to ~125 m from where mappers put the object.
 */
export const DUPLICATE_RADIUS_M = 150;

/** Objects of one kind this close to a match are one site mapped as several objects. */
export const SPLIT_RADIUS_M = 25;

/** Farther than this, a place with the same operator or address is still likely the record's. */
export const SAME_OPERATOR_RADIUS_M = 300;
