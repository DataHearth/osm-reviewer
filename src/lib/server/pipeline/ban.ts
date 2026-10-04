import { ban } from "$lib/server/config";
import { distance } from "./geo";
import { getJson } from "./http";
import type { Extraction, ProposedTag } from "./types";

/** Below this the base matched another street of a similar name. */
const MIN_SCORE = 0.7;
const TIMEOUT_MS = 10_000;

interface Feature {
	geometry: { coordinates: [number, number] };
	properties: {
		label: string;
		/** The street for a housenumber hit; for a street hit, its `name` is the street. */
		street?: string;
		name: string;
		postcode: string;
		city: string;
		score: number;
		type: string;
	};
}

const cache = new Map<string, Feature | null>();

async function lookup(q: string): Promise<Feature | null> {
	const known = cache.get(q);
	if (known !== undefined) return known;
	const url = `${ban.url}/search/?${new URLSearchParams({ q, limit: "1" })}`;
	const hit = (await getJson<{ features?: Feature[] }>(url, { timeoutMs: TIMEOUT_MS }))
		.features?.[0];
	const sure =
		hit && hit.properties.score >= MIN_SCORE && /^(housenumber|street)$/.test(hit.properties.type)
			? hit
			: null;
	cache.set(q, sure);
	return sure;
}

const metres = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);

/**
 * The address as the national address base spells it, with the source's own housenumber
 * (a range like 20-28 included). A directory writes a city's main code for schools all over
 * it (in Toulouse 31000 was wrong 31 times out of 49), CEDEX codes that route mail rather than
 * places, streets in capitals and half-names ("boulevard Kennedy"); with no confident match the
 * address is left out whole.
 */
function spelled(parts: ProposedTag[], hit: Feature): ProposedTag[] {
	const p = hit.properties;
	const from: Record<string, string> = {
		"addr:street": p.street ?? p.name,
		"addr:postcode": p.postcode,
		"addr:city": p.city,
	};
	const like = parts.find((t) => t.k === "addr:street") ?? parts[0];
	return [
		...parts.filter((t) => !(t.k in from)),
		...Object.entries(from).map(([k, v]) => ({
			...(parts.find((t) => t.k === k) ?? like),
			k,
			v,
			conf: 0.85,
			path: "BAN",
			kind: "derived",
			parts: [
				{ text: "Base Adresse Nationale: ", mark: false },
				{ text: p.label, mark: true },
			],
		})),
	];
}

/**
 * One lookup per record, for two things. The address parts it proposes take the base's
 * spelling, or are dropped. And a source point farther from its own housenumber than the
 * record allows moves there before matching: a directory geocoded on a CEDEX's sorting office,
 * or a station placed at its operator's head office, would otherwise match whatever stands at
 * the wrong spot, or nothing. A street-level hit says nothing about where on the street, so
 * it never moves a point.
 */
export async function placeAddress(x: Extraction): Promise<Extraction> {
	if (!x.geocode) return x;
	const hit = await lookup(x.geocode.q);
	const address = x.tags.filter((t) => t.group === "addr");
	const tags = [
		...x.tags.filter((t) => t.group !== "addr"),
		...(hit && address.length ? spelled(address, hit) : []),
	];
	if (hit?.properties.type !== "housenumber") return { ...x, tags };
	const [lon, lat] = hit.geometry.coordinates;
	const d = distance(x.lat, x.lon, lat, lon);
	if (d <= x.geocode.farM) return { ...x, tags };
	return {
		...x,
		lat,
		lon,
		tags,
		notes: [...(x.notes ?? []), `Moved ${metres(d)} to its address, ${hit.properties.label}`],
	};
}
