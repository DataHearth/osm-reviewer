import { ban } from "$lib/server/config";
import { distance } from "./geo";
import { getJson } from "./http";
import type { Extraction } from "./types";

/** Below this the base matched another street of a similar name. */
const MIN_SCORE = 0.7;
/** Farther than this from its own address, the source's point or its address is wrong. */
const FAR_M = 1000;
const TIMEOUT_MS = 10_000;

interface Feature {
	geometry: { coordinates: [number, number] };
	properties: { label: string; postcode: string; score: number; type: string };
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

/**
 * The proposed address's postcode as the national address base gives it. A directory writes
 * a city's main code for schools all over it (in Toulouse 31000 was wrong 31 times out of
 * 49) and CEDEX codes that route mail, not places; with no confident match no postcode is
 * proposed. A source point far from its own address gets a line for the reviewer.
 */
export async function checkAddress(x: Extraction): Promise<Extraction> {
	const part = (k: string) => x.tags.find((t) => t.k === k);
	const street = part("addr:street");
	const city = part("addr:city");
	if (!street || !city) return x;
	const hit = await lookup([part("addr:housenumber")?.v, street.v, city.v].join(" ").trim());
	const tags = x.tags.filter((t) => t.k !== "addr:postcode");
	const notes = [...(x.notes ?? [])];
	if (hit) {
		tags.push({
			...street,
			k: "addr:postcode",
			v: hit.properties.postcode,
			conf: 0.85,
			path: "BAN",
			kind: "derived",
			parts: [
				{ text: "Base Adresse Nationale: ", mark: false },
				{ text: hit.properties.label, mark: true },
			],
		});
		const [lon, lat] = hit.geometry.coordinates;
		const d = distance(x.lat, x.lon, lat, lon);
		if (hit.properties.type === "housenumber" && d > FAR_M)
			notes.push(
				`The source places it ${(d / 1000).toFixed(1)} km from its own address, ${hit.properties.label}`,
			);
	}
	return { ...x, tags, notes };
}
