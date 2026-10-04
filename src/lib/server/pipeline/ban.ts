import { ban } from "$lib/server/config";
import { distance, houseNumber, normaliseName, tokens } from "./geo";
import { getJson } from "./http";
import { findMatch } from "./match";
import type { Preset } from "./presets";
import type { Extraction, OsmElement, ProposedTag, Row } from "./types";

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
		housenumber?: string;
		postcode: string;
		city: string;
		/** The commune a merged one was before; the base tells its streets apart by it. */
		oldcity?: string;
		score: number;
		type: string;
	};
}

const cache = new Map<string, Feature | null>();

async function ask(q: string): Promise<Feature | null> {
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

const POSTCODE = /\b\d{5}\b\s*/;

/**
 * A directory writes a city's main postcode for schools all over it (Toulouse's 31000 and
 * 31500 for one in 31100), and the base then scores the right address under the floor: the
 * same line with the commune alone finds it at 0.98.
 */
async function lookup(q: string): Promise<Feature | null> {
	return (await ask(q)) ?? (POSTCODE.test(q) ? ask(q.replace(POSTCODE, "")) : null);
}

/** "Rue Ampère (Oullins)": a merged commune's street, told from its namesakes by the old commune. */
function streetOf(p: Feature["properties"]): string {
	const street = p.street ?? p.name;
	return p.oldcity ? street.replace(` (${p.oldcity})`, "") : street;
}

/** A street's words, singular: Toulouse's "Allées Jean Jaurès" is "Allée Jean Jaurès" to the registry. */
const words = (s: string) =>
	[...tokens(s)]
		.filter((w) => w.length > 1 && !/\d/.test(w) && !/^(bis|ter|quater)$/.test(w))
		.map((w) => w.replace(/s$/, ""));

/** At most one letter added, dropped or changed. */
function oneEdit(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return [
		a.slice(i + 1) === b.slice(i + 1),
		a.slice(i + 1) === b.slice(i),
		a.slice(i) === b.slice(i + 1),
	].some(Boolean);
}

/** Its letters in order, from the first, at most half as long: "dr" for "docteur", not "rue" for "route". */
const abbreviates = (short: string, long: string) =>
	short.length * 2 <= long.length &&
	short[0] === long[0] &&
	new RegExp(short.split("").join(".*")).test(long);

/** One word as the other, misspelt by a letter ("Tuilliers") or abbreviated; "port" is not "pont". */
const sameWord = (a: string, b: string) =>
	a === b ||
	(Math.min(a.length, b.length) >= 5 && oneEdit(a, b)) ||
	abbreviates(a, b) ||
	abbreviates(b, a);

/**
 * Whether the base's street is the one asked for: one's words all in the other's, so a
 * half-name ("boulevard Kennedy") or a dropped particle agrees, and "5 boulevard de
 * Matabiau" does not with the base's 5 Rue Matabiau.
 */
function sameStreet(p: Feature["properties"], q: string): boolean {
	const theirs = words(streetOf(p));
	const place = new Set(words(`${p.city} ${p.oldcity ?? ""}`));
	const ours = words(q).filter((w) => !place.has(w));
	const within = (xs: string[], ys: string[]) => xs.every((x) => ys.some((y) => sameWord(x, y)));
	return within(theirs, ours) || within(ours, theirs);
}

const metres = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);

/**
 * The address as the national address base spells it, with the source's own housenumber
 * (a range like 20-28 included) unless the base writes the same number. A directory writes a
 * city's main code for schools all over it (in Toulouse 31000 was wrong 31 times out of 49),
 * CEDEX codes that route mail rather than places, streets in capitals and half-names
 * ("boulevard Kennedy"); with no confident match the address is left out whole.
 */
function spelled(parts: ProposedTag[], hit: Feature): ProposedTag[] {
	const p = hit.properties;
	const from: Record<string, string> = {
		"addr:street": streetOf(p),
		"addr:postcode": p.postcode,
		"addr:city": p.city,
	};
	const number = parts.find((t) => t.k === "addr:housenumber")?.v;
	if (p.housenumber && number && houseNumber(number) === houseNumber(p.housenumber))
		from["addr:housenumber"] = p.housenumber;
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
 * spelling, or are dropped. And where the base places the housenumber, on the street the
 * source names, is kept for `settlePoints` to move the point to. A street-level hit says
 * nothing about where on the street, so it places nothing.
 */
export async function placeAddress(x: Extraction): Promise<Extraction> {
	if (!x.geocode) return x;
	const hit = await lookup(x.geocode.q);
	const address = x.tags.filter((t) => t.group === "addr");
	const tags = [
		...x.tags.filter((t) => t.group !== "addr"),
		...(hit && address.length ? spelled(address, hit) : []),
	];
	if (hit?.properties.type !== "housenumber" || !sameStreet(hit.properties, x.geocode.q))
		return { ...x, tags };
	const [lon, lat] = hit.geometry.coordinates;
	return { ...x, tags, atAddress: { lat, lon, label: hit.properties.label } };
}

/**
 * For a key the source lists at several sites, how far each row's own address lies from the
 * row's point (Infinity where the base cannot place it): the site the point stands at is
 * the main one. The main row's question is the one `placeAddress` then asks again, from cache.
 */
export async function addressGaps(
	rows: Row[],
	preset: Pick<Preset, "siteQuery" | "position">,
): Promise<Map<Row, number>> {
	const gaps = new Map<Row, number>();
	for (const r of rows) {
		const q = preset.siteQuery?.(r);
		const pos = preset.position(r);
		const hit = q && pos ? await lookup(q) : null;
		if (!pos || !hit) {
			gaps.set(r, Number.POSITIVE_INFINITY);
			continue;
		}
		const [lon, lat] = hit.geometry.coordinates;
		gaps.set(r, distance(pos[0], pos[1], lat, lon));
	}
	return gaps;
}

/** Points of one operator this far apart at one address are a campus's or a mall's car parks. */
const OWN_POINT_M = 10;

const operatorOf = (x: Extraction) =>
	normaliseName(x.tags.find((t) => t.k === "operator")?.v ?? "");

function sharesAddress(x: Extraction, o: Extraction): boolean {
	if (o === x || !x.geocode || !o.geocode || !operatorOf(x)) return false;
	return (
		normaliseName(o.geocode.q) === normaliseName(x.geocode.q) &&
		operatorOf(o) === operatorOf(x) &&
		distance(x.lat, x.lon, o.lat, o.lon) > OWN_POINT_M
	);
}

/**
 * A source point farther from its own housenumber than the record allows moves there: a
 * directory geocoded on a CEDEX's sorting office, or a station placed at its operator's head
 * office, would otherwise match whatever stands at the wrong spot, or nothing. Unless the
 * point is borne out where it stands: an object there matches it (and is not the same object
 * found from the address, standing nearer it), or other records of the operator give the
 * same address at points of their own, which makes it a campus's or a mall's address.
 */
export function settlePoints(
	xs: Extraction[],
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]>,
	shared: Set<string>,
): Extraction[] {
	return xs.map((x) => {
		const to = x.atAddress;
		if (!to || !x.geocode) return x;
		const d = distance(x.lat, x.lon, to.lat, to.lon);
		if (d <= x.geocode.farM) return x;
		const here = findMatch(x, els, refIndex, shared);
		if (here) {
			const there = findMatch({ ...x, lat: to.lat, lon: to.lon }, els, refIndex, shared);
			if (
				there !== here ||
				distance(to.lat, to.lon, here.lat, here.lon) >= distance(x.lat, x.lon, here.lat, here.lon)
			)
				return x;
		} else if (xs.some((o) => sharesAddress(x, o))) return x;
		return {
			...x,
			lat: to.lat,
			lon: to.lon,
			from: { lat: x.lat, lon: x.lon },
			notes: [...(x.notes ?? []), `Moved ${metres(d)} to its address, ${to.label}`],
		};
	});
}
