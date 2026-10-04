export interface AreaShape {
	def: "relation" | "radius";
	bbox: [number, number, number, number] | null;
	centerLat: number;
	centerLon: number;
	km: number | null;
	radius: number | null;
}

const M_PER_DEG = 111_320;

export function distance(aLat: number, aLon: number, bLat: number, bLon: number): number {
	const rad = Math.PI / 180;
	const dLat = (bLat - aLat) * rad;
	const dLon = (bLon - aLon) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The circle a radius area is, or the one a relation area falls back to when it has no box yet. */
function circle(a: AreaShape): number | null {
	if (a.def === "radius") return a.radius;
	return a.bbox ? null : a.km ? a.km * 1000 : null;
}

/** `[south, west, north, east]`, the order Overpass and Opendatasoft's `in_bbox` take. */
export function areaBox(a: AreaShape): [number, number, number, number] {
	const r = circle(a);
	if (r) {
		const dLat = r / M_PER_DEG;
		const dLon = r / (M_PER_DEG * Math.cos((a.centerLat * Math.PI) / 180));
		return [a.centerLat - dLat, a.centerLon - dLon, a.centerLat + dLat, a.centerLon + dLon];
	}
	if (a.bbox) return a.bbox;
	return [a.centerLat, a.centerLon, a.centerLat, a.centerLon];
}

export function hasShape(a: AreaShape): boolean {
	return circle(a) !== null || a.bbox !== null;
}

/**
 * A relation area is its bounding box while a source is read, so records in a neighbouring
 * commune's corner of the box are let in. Exact membership would need the boundary geometry,
 * and a registry dump can only be cut by something cheap while it streams. Matching fetches
 * OSM over the same box (`matchScope`), so those records still find what is mapped there.
 */
export function inArea(a: AreaShape, lat: number, lon: number): boolean {
	const r = circle(a);
	if (r) return distance(a.centerLat, a.centerLon, lat, lon) <= r;
	const [s, w, n, e] = areaBox(a);
	return lat >= s && lat <= n && lon >= w && lon <= e;
}

export function normaliseName(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

const STOP = new Set([
	"le",
	"la",
	"les",
	"l",
	"de",
	"du",
	"des",
	"d",
	"et",
	"the",
	"of",
	"au",
	"aux",
]);

export const tokens = (s: string) =>
	new Set(
		normaliseName(s)
			.split(" ")
			.filter((w) => w && !STOP.has(w)),
	);

/** Dice coefficient over word tokens, which survives "Pharmacie du Capitole" vs "Pharmacie Capitole". */
export function nameSimilarity(a: string, b: string): number {
	const ta = tokens(a);
	const tb = tokens(b);
	if (ta.size === 0 || tb.size === 0) return 0;
	let shared = 0;
	for (const w of ta) if (tb.has(w)) shared += 1;
	return (2 * shared) / (ta.size + tb.size);
}
