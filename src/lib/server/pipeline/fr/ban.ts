import { ban } from "$lib/server/config";
import { getJson } from "../http";
import type { AddressBase } from "../preset";
import { houseNumber, tokens } from "../text";
import type { Extraction, ProposedTag } from "../types";
import { spacedNumber } from "./text";

/** Below this the base matched another street of a similar name. */
const MIN_SCORE = 0.7;

/**
 * A half-named street costs the base's score what it costs: "25 rue Rebatel" finds 25 Rue
 * Docteur Rebatel at 0.68, "12 rue Hénon" 12 Rue Jacques-Louis Hénon at 0.56. Down to this, a
 * hit on the source's own housenumber of a street holding all its words is that address;
 * "82 rue Hénon Lyon", at 0.499, is not taken.
 */
const NUMBER_AND_STREET_SCORE = 0.5;
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
	const sure = hit && /^(housenumber|street)$/.test(hit.properties.type) && confident(hit, q);
	cache.set(q, sure ? hit : null);
	return sure ? hit : null;
}

/** The housenumber a question starts with: "12", "12bis", "6a". */
const ASKED_NUMBER = /^\s*(\d+(?:\s*(?:bis|ter|quater|[a-z]))?)(?![a-z])/i;

function confident(hit: Feature, q: string): boolean {
	const p = hit.properties;
	if (p.score >= MIN_SCORE) return true;
	const asked = ASKED_NUMBER.exec(q)?.[1];
	return (
		p.score >= NUMBER_AND_STREET_SCORE &&
		p.type === "housenumber" &&
		!!asked &&
		!!p.housenumber &&
		houseNumber(asked) === houseNumber(p.housenumber) &&
		sameStreet(p, q, true)
	);
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

/** As `words` leaves them: singular, unaccented. */
const STREET_TYPES = new Set(
	"rue avenue boulevard chemin cheminement place port allee impasse route quai cour square voie passage esplanade rond point montee chaussee parvi promenade sentier faubourg clo cite".split(
		" ",
	),
);

/**
 * Whether the base's street is the one asked for: one's words all in the other's, so a
 * half-name ("boulevard Kennedy") or a dropped particle agrees, and "5 boulevard de
 * Matabiau" does not with the base's 5 Rue Matabiau.
 */
function sameStreet(p: Feature["properties"], q: string, anyType = false): boolean {
	const named = (ws: string[]) => (anyType ? ws.filter((w) => !STREET_TYPES.has(w)) : ws);
	const theirs = named(words(streetOf(p)));
	const place = new Set(words(`${p.city} ${p.oldcity ?? ""}`));
	const ours = named(words(q).filter((w) => !place.has(w)));
	const within = (xs: string[], ys: string[]) => xs.every((x) => ys.some((y) => sameWord(x, y)));
	return within(theirs, ours) || within(ours, theirs);
}

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
		from["addr:housenumber"] = spacedNumber(p.housenumber);
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
 * nothing about where on the street, so it moves nothing, though it says roughly where the
 * place is.
 */
async function placeAddress(x: Extraction): Promise<Extraction> {
	if (!x.geocode) return x;
	const hit = await lookup(x.geocode.q);
	const address = x.tags.filter((t) => t.group === "addr");
	const tags = [
		...x.tags.filter((t) => t.group !== "addr"),
		// The base corrects a street's type ("rue Félix Faure" is an Avenue), but a street of
		// another name is another address: "rue des 36 ponts" is not its Rue des Potiers.
		...(hit && address.length && sameStreet(hit.properties, x.geocode.q, true)
			? spelled(address, hit)
			: []),
	];
	if (!hit || !sameStreet(hit.properties, x.geocode.q)) return { ...x, tags };
	const [lon, lat] = hit.geometry.coordinates;
	const at = { lat, lon, label: hit.properties.label };
	return hit.properties.type === "housenumber"
		? { ...x, tags, atAddress: at }
		: { ...x, tags, onStreet: at };
}

async function locate(q: string): Promise<[number, number] | null> {
	const hit = await lookup(q);
	if (!hit) return null;
	const [lon, lat] = hit.geometry.coordinates;
	return [lat, lon];
}

/** The Base Adresse Nationale. */
export const addressBase: AddressBase = { place: placeAddress, locate };
