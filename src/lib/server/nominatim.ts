import { nominatim } from "$lib/server/config";
import type { Rel } from "$lib/types";
import { version } from "../../../package.json";

const MIN_GAP_MS = 1100;
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 100;
const TIMEOUT_MS = 8000;

interface Hit {
	osm_type?: string;
	osm_id?: number;
	category?: string;
	type?: string;
	name?: string;
	display_name?: string;
	lat?: string;
	lon?: string;
	boundingbox?: string[];
	extratags?: { admin_level?: string } | null;
}

const rounded = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

/** The bbox's area. It overstates the boundary's, so the picker labels it as the bbox. */
function bboxSqkm([s, w, n, e]: [number, number, number, number]) {
	const height = (n - s) * 111;
	const width = (e - w) * 111 * Math.cos((((s + n) / 2) * Math.PI) / 180);
	return { height, width, sqkm: Math.max(1, Math.round(height * width)) };
}

/** Keeps the administrative relations and drops everything else Nominatim matched. */
export function parseBoundaries(hits: unknown): Rel[] {
	if (!Array.isArray(hits)) return [];
	const out: Rel[] = [];
	for (const h of hits as Hit[]) {
		if (h.osm_type !== "relation" || h.category !== "boundary" || h.type !== "administrative")
			continue;
		const box = h.boundingbox?.map(Number);
		const lat = Number(h.lat);
		const lon = Number(h.lon);
		if (!h.osm_id || !box || box.length !== 4 || box.some(Number.isNaN)) continue;
		if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
		// Nominatim orders it south, north, west, east; Overpass wants south, west, north, east.
		const bbox: [number, number, number, number] = [box[0], box[2], box[1], box[3]];
		const { height, width, sqkm } = bboxSqkm(bbox);
		const level = Number(h.extratags?.admin_level);
		const displayName = h.display_name ?? h.name ?? String(h.osm_id);
		out.push({
			rel: String(h.osm_id),
			name: h.name || displayName.split(",")[0],
			displayName,
			level: Number.isFinite(level) && level > 0 ? level : null,
			center: [rounded(lat, 4), rounded(lon, 4)],
			bbox,
			km: rounded((height + width) / 4),
			sqkm,
		});
	}
	return out;
}

const cache = new Map<string, { at: number; rels: Rel[] }>();
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Calls are serialised and spaced out, which is the public instance's 1 request/s policy. */
function throttled<T>(job: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		const wait = lastCall + MIN_GAP_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastCall = Date.now();
		return job();
	});
	queue = run.catch(() => {});
	return run;
}

export class NominatimError extends Error {}

export async function searchBoundaries(q: string, fetcher: typeof fetch = fetch): Promise<Rel[]> {
	const key = q.trim().toLowerCase();
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.rels;

	const url = new URL(`${nominatim.url}/search`);
	url.search = new URLSearchParams({
		q,
		format: "jsonv2",
		limit: "20",
		extratags: "1",
		addressdetails: "0",
		"accept-language": "en",
	}).toString();

	const hits = await throttled(async () => {
		let res: Response;
		try {
			res = await fetcher(url, {
				headers: {
					"User-Agent": `osm-reviewer/${version} (+${process.env.ORIGIN ?? "http://localhost"})`,
				},
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new NominatimError("Nominatim did not answer.");
		}
		if (!res.ok) throw new NominatimError(`Nominatim answered ${res.status}.`);
		return res.json().catch(() => {
			throw new NominatimError("Nominatim sent something unreadable.");
		});
	});

	const rels = parseBoundaries(hits);
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(key, { at: Date.now(), rels });
	return rels;
}

export function clearBoundaryCache() {
	cache.clear();
}
