import { ids } from "../text";
import type { Extraction, OsmElement } from "../types";
import type { RefScheme } from "./refs";

/**
 * An EVSE id the way stations are told apart. The `E`/`P` type letter goes, since mappers write
 * a point's id as a pool (`FR*GLY*PLYON2221` for `FRGLYELYON2221`). The part after the operator
 * code also stands alone when it names the station by itself, since a network that changed
 * hands keeps its pool ids under the new operator's code (`FR*E13*PDARTYLIMONEST69760*1` for
 * `FRSSDPDARTYLIMONEST697601`). An all-digit part names nothing: Toulouse's networks all number
 * their stations `<INSEE code><sequence>`, so `FRTLSP31555002` and `FR*PKG*P31555002` are two
 * operators' stations kilometres apart.
 */
function evseKeys(id: string): string[] {
	const m = /^([A-Z]{2}[A-Z0-9]{3})[EP](.+)$/.exec(id);
	if (!m) return [id];
	return m[2].length >= 8 && /[A-Z]/.test(m[2]) ? [m[1] + m[2], `~${m[2]}`] : [m[1] + m[2]];
}

/** Some files write a point as its station's id and a `P<connector>` (`FRALLEGO002084P1`). */
const CONNECTOR = /(?<=\d)P\d{1,2}$/;

const evseKeysOf = (v: string) => [
	...new Set(
		ids(v)
			.flatMap((id) => [id, id.replace(CONNECTOR, "")])
			.flatMap(evseKeys),
	),
];

export const evse: RefScheme = {
	keys: evseKeysOf,
	// A station mapped without its `amenity` still carries its pool id; charge points carry
	// theirs too, and would be matched as stations.
	selectors: [{ k: "ref:EU:EVSE", v: null, not: { k: "man_made", v: ["charge_point"] } }],
	site: true,
};

/**
 * Whether `e` carries EVSE ids none of which is this station's. A mapper's pool id is often
 * finer than the registry's (`PLYON13011` under `PLYON130`), so one id under the other still
 * agrees. It only rules out a name or distance match, and a neighbour as part of the site: the
 * duplicate banner must still see such an object.
 */
export function otherStation(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = evseKeysOf(refs["ref:EU:EVSE"] ?? "");
	const theirs = evseKeysOf(evseOn(e));
	if (!ours.length || !theirs.length) return false;
	const related = (a: string, b: string) =>
		a === b || (a[0] !== "~" && b[0] !== "~" && (a.startsWith(b) || b.startsWith(a)));
	return !theirs.some((t) => ours.some((o) => related(t, o)));
}

/** `FR*TLS*E31555*059*3*1`: a point's id, connector and all, as some mappers write a plain `ref`. */
const EVSE_SHAPED = /^[A-Z]{2}\*[A-Z0-9]{3}\*[EP][A-Z0-9*]+$/i;

/** The EVSE ids an object carries, under its own key or as its plain `ref`. */
const evseOn = (e: OsmElement) =>
	[e.tags["ref:EU:EVSE"], EVSE_SHAPED.test(e.tags.ref ?? "") ? e.tags.ref : undefined]
		.filter(Boolean)
		.join(";");

/** The tag an object carries its EVSE id under, as the reviewer would look it up. */
export const evseTag = (e: OsmElement) =>
	e.tags["ref:EU:EVSE"] ? `ref:EU:EVSE=${e.tags["ref:EU:EVSE"]}` : `ref=${e.tags.ref}`;

const EVSE_PARTS = /^[A-Z]{2}([A-Z0-9]{3})([EP])/;

/**
 * Whether `e` carries only station ids of the record's own network (`ELC` in
 * `FR*ELC*P12953885`), which the network has renumbered since. A point's id names a point of
 * some station, more likely a neighbour's than this one's.
 */
export function renumberedPool(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = new Set(ids(refs["ref:EU:EVSE"] ?? "").map((id) => EVSE_PARTS.exec(id)?.[1]));
	const theirs = ids(evseOn(e)).map((id) => EVSE_PARTS.exec(id));
	return theirs.length > 0 && theirs.every((m) => m?.[2] === "P" && ours.has(m[1]));
}

/**
 * The record's points the object's ids name, when they name some of them and nothing else:
 * one borne of the station, `ref=FR*TLS*E31555*059*3*1` for its third point.
 */
export function pointsOn(
	e: OsmElement,
	refs: Record<string, string>,
): { on: number; of: number } | null {
	const points = ids(refs["ref:EU:EVSE"] ?? "").filter((id) => /^[A-Z]{2}[A-Z0-9]{3}E/.test(id));
	const theirs = ids(evseOn(e));
	if (!theirs.length || !theirs.every((t) => points.some((p) => t.startsWith(p)))) return null;
	const on = points.filter((p) => theirs.some((t) => t.startsWith(p))).length;
	// A mapper who names one point but counts them all has mapped the whole station.
	if (Number.parseInt(e.tags.capacity ?? "", 10) === points.length) return null;
	return on < points.length ? { on, of: points.length } : null;
}

/**
 * One station's bornes named after it, `BRN06A` and `BRN06B`, beside another's, `BRN07A`: two
 * plain refs that read as a station and a borne letter name one station only if the stations agree.
 */
export function otherBorne(a: OsmElement, b: OsmElement): boolean {
	const station = (e: OsmElement) =>
		EVSE_SHAPED.test(e.tags.ref ?? "") ? null : /^(.*\d)[A-Z]$/i.exec(e.tags.ref ?? "")?.[1];
	const [sa, sb] = [station(a), station(b)];
	return !!sa && !!sb && sa.toUpperCase() !== sb.toUpperCase();
}

/** Upper bounds, in kW, of the power classes a connector's output falls in. */
const POWER_CLASSES = [8, 22, 60];

/** A mapper's output in kW unless it names its unit: "7400 W" and "7,4 kW" are one class. */
const powerClass = (v: string) => {
	const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kva|kw|w)?(?![a-z])/i.exec(v);
	if (!m) return null;
	const kw = Number(m[1].replace(",", ".")) / (m[2]?.toLowerCase() === "w" ? 1000 : 1);
	return POWER_CLASSES.filter((top) => kw > top).length;
};

const DC = /^(type2_combo|type1_combo|chademo|tesla_supercharger.*)$/;

/** Whether a station's connectors are all direct current, all alternating, or both. */
export function current(keys: string[]): "ac" | "dc" | null {
	const types = new Set(
		keys.flatMap((k) => /^socket:(?!unknown)([^:]+)(:output)?$/.exec(k)?.[1] ?? []),
	);
	const dc = [...types].filter((t) => DC.test(t)).length;
	return !types.size || (dc && dc < types.size) ? null : dc ? "dc" : "ac";
}

/**
 * How well an object fits the station a record describes, from what both state: a capacity,
 * a connector count or a power class they share agrees or not, and so does a connector the
 * source rules out. `types` is a fast DC unit for an AC station, or the other way round,
 * which is another station of the site rather than a stale count on this one.
 */
export function stationFit(
	x: Partial<Pick<Extraction, "tags" | "absent" | "fit">>,
	e: OsmElement,
): { agree: number; against: number; types: boolean } | null {
	let agree = 0;
	let against = (x.absent ?? []).filter((k) => e.tags[k] !== undefined).length;
	const listed = [...(x.tags ?? []), ...(x.fit ?? [])];
	for (const t of listed) {
		if (!/^(capacity|socket:(?!unknown)[^:]+(:output)?)$/.test(t.k)) continue;
		const had = e.tags[t.k];
		if (had === undefined) continue;
		const [a, b] = t.k.endsWith(":output")
			? [powerClass(t.v), powerClass(had)]
			: [Number.parseInt(t.v, 10), Number.parseInt(had, 10)];
		// `socket:type2=yes` counts nothing.
		if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b)) continue;
		if (a === b) agree += 1;
		else against += 1;
	}
	const [ours, theirs] = [current(listed.map((t) => t.k)), current(Object.keys(e.tags))];
	const types = !!ours && !!theirs && ours !== theirs;
	if (types) against += 1;
	return agree + against ? { agree, against, types } : null;
}

export const fitScore = (f: ReturnType<typeof stationFit>) => (f ? f.agree - f.against : 0);
