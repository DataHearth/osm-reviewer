import { openingHours as parsedHours } from "./llm";
import type { Row } from "./types";

/** First non-empty value among the field names a dataset has used for the same thing. */
export function str(row: Row, ...names: string[]): string {
	for (const n of names) {
		const v = row[n];
		if (v === null || v === undefined) continue;
		const s = String(v).trim();
		if (s) return s;
	}
	return "";
}

export const truthy = (v: string) => /^(true|1|oui|yes|vrai)$/i.test(v);

export function coord(lat: unknown, lon: unknown): [number, number] | null {
	const a = Number(lat);
	const o = Number(lon);
	if (lat === "" || lon === "" || lat == null || lon == null) return null;
	if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180)
		return null;
	if (a === 0 && o === 0) return null;
	return [a, o];
}

/** Latitude and longitude from the shapes Opendatasoft and CSV exports give a point. */
export function findCoords(row: Row): [number, number] | null {
	for (const [la, lo] of [
		["latitude", "longitude"],
		["lat", "lon"],
		["lat", "lng"],
	]) {
		const c = coord(row[la], row[lo]);
		if (c) return c;
	}
	for (const f of ["position", "geo_point_2d", "geom", "geopoint", "coordonnees", "geometry"]) {
		const v = row[f];
		if (v && typeof v === "object") {
			const o = v as Record<string, unknown>;
			const c = coord(o.lat ?? o.latitude, o.lon ?? o.lng ?? o.longitude);
			if (c) return c;
			const g = o.coordinates;
			if (Array.isArray(g)) {
				const c2 = coord(g[1], g[0]);
				if (c2) return c2;
			}
		}
		if (typeof v === "string") {
			const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(v);
			if (m) {
				const c = coord(m[1], m[2]);
				if (c) return c;
			}
		}
	}
	return null;
}

export function website(raw: string): string | null {
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	try {
		const u = new URL(withScheme);
		if (!u.hostname.includes(".")) return null;
		u.hash = "";
		return u.toString().replace(/\/$/, u.pathname === "/" && !u.search ? "" : "/");
	} catch {
		return null;
	}
}

/** Already written in OSM's day tokens: the parser reads plain English too, "Monday to Friday" as open all day. */
const OPENING_HOURS = /^(24\/7|(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?![a-z])[A-Za-z0-9:,;\-+ /]*)$/;

/**
 * Registries write "all day" as the last minute they count to, and some spell every day
 * out: `Mo 00:00-23:59, Tu 00:00-23:59, …`. The days are folded into ranges and checked by
 * OSM's own parser, which repairs `Mo-Fri:` and `Sat` and refuses what it cannot read.
 */
export function openingHours(raw: string): string | null {
	const v = raw
		.trim()
		.replace(/23:5\d\b/g, "24:00")
		.replace(/00:00-00:00/g, "00:00-24:00");
	if (/^24\/7$/i.test(v)) return "24/7";
	return OPENING_HOURS.test(v) ? parsedHours(v) : null;
}
