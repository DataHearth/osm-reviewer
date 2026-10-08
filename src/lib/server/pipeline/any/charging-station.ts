import type { Fit, Kit, KitFactory, Subject } from "../match/kit";
import { NAME_MATCH, nameScore } from "../match/names";
import type { TagOp } from "../match/ops";
import { DUPLICATE_RADIUS_M } from "../match/radii";
import { ids } from "../text";
import type { Extraction, OsmElement } from "../types";

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

/**
 * A mapper's pool id is often finer than the registry's (`PLYON13011` under `PLYON130`), so one
 * id under the other still agrees, `~` tails excepted.
 */
const relatedEvse = (a: string, b: string) =>
	a === b || (a[0] !== "~" && b[0] !== "~" && (a.startsWith(b) || b.startsWith(a)));

/** `FR*TLS*E31555*059*3*1`: a point's id, connector and all, as some mappers write a plain `ref`. */
const EVSE_SHAPED = /^[A-Z]{2}\*[A-Z0-9]{3}\*[EP][A-Z0-9*]+$/i;

/** The point ids in a plain `ref`, which some mappers write as a list of a borne's connectors. */
const evseRef = (e: OsmElement) =>
	(e.tags.ref ?? "")
		.split(";")
		.map((p) => p.trim())
		.filter((p) => EVSE_SHAPED.test(p))
		.join(";");

/** The EVSE ids an object carries, under its own key or as its plain `ref`. */
const evseOn = (e: OsmElement) => [e.tags["ref:EU:EVSE"], evseRef(e)].filter(Boolean).join(";");

/** The tag an object carries its EVSE id under, as the reviewer would look it up. */
const evseTag = (e: OsmElement) =>
	e.tags["ref:EU:EVSE"] ? `ref:EU:EVSE=${e.tags["ref:EU:EVSE"]}` : `ref=${e.tags.ref}`;

const EVSE_PARTS = /^[A-Z]{2}([A-Z0-9]{3})([EP])/;

/**
 * Whether `e` carries only station ids of the record's own network (`ELC` in
 * `FR*ELC*P12953885`), which the network has renumbered since. A point's id names a point of
 * some station, more likely a neighbour's than this one's.
 */
function renumberedPool(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = new Set(ids(refs["ref:EU:EVSE"] ?? "").map((id) => EVSE_PARTS.exec(id)?.[1]));
	const theirs = ids(evseOn(e)).map((id) => EVSE_PARTS.exec(id));
	return theirs.length > 0 && theirs.every((m) => m?.[2] === "P" && ours.has(m[1]));
}

/**
 * The record's points the object's ids name, when they name some of them and nothing else:
 * one borne of the station, `ref=FR*TLS*E31555*059*3*1` for its third point.
 */
function pointsOn(e: OsmElement, refs: Record<string, string>): { on: number; of: number } | null {
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
function otherBorne(a: OsmElement, b: OsmElement): boolean {
	const station = (e: OsmElement) =>
		evseRef(e) ? null : /^(.*\d)[A-Z]$/i.exec(e.tags.ref ?? "")?.[1];
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
		// A count that only fills a gap is too unsure to tell one object from another.
		if ("addOnly" in t && t.addOnly) continue;
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
	// An object listing its connectors and none of one the record counts is another unit, or
	// another kind of charger. A type 2 socket or cable, and an E/F or Schuko outlet, are each
	// the same connector to a mapper.
	const sockets = socketsOf(e);
	const lacking = (k: string) => !sockets.some((s) => connector(s) === connector(k));
	const firm = (t: (typeof listed)[number]) => !("addOnly" in t && t.addOnly);
	if (sockets.length && listed.some((t) => COUNT.test(t.k) && firm(t) && lacking(t.k)))
		against += 1;
	const [ours, theirs] = [current(listed.map((t) => t.k)), current(Object.keys(e.tags))];
	const types = !!ours && !!theirs && ours !== theirs;
	if (types) against += 1;
	return agree + against ? { agree, against, types } : null;
}

const COUNT = /^socket:(?!unknown)[^:]+$/;

const socketsOf = (e: OsmElement) => Object.keys(e.tags).filter((k) => COUNT.test(k));

const connector = (k: string) =>
	k.replace(/^socket:type2_cable$/, "socket:type2").replace(/^socket:schuko$/, "socket:typee");

/** Connectors only a car takes: an e-bike locker's or a scooter's charger has none of them. */
const CAR_SOCKET = /^socket:(type2|type2_cable|type2_combo|type1|type1_combo|chademo|tesla.*)$/;

/**
 * Whether `e` charges bicycles or scooters only, for a record that is a car station: one
 * mapped for them (`bicycle=yes`, `scooter=yes`) with no car connector or `motorcar=no`, or
 * one with domestic Schuko outlets alone (Carrefour Francheville's padlocked e-bike lockers).
 * A two-wheeler station's own record (`motorcycle=yes`) may still be matched to one.
 */
function forTwoWheels(x: Partial<Pick<Extraction, "tags" | "fit">>, e: OsmElement): boolean {
	const listed = [...(x.tags ?? []), ...(x.fit ?? [])];
	if (!listed.some((t) => CAR_SOCKET.test(t.k)) || listed.some((t) => t.k === "motorcycle"))
		return false;
	const sockets = socketsOf(e);
	const ridden = ["bicycle", "scooter"].some((k) => /^(yes|designated)$/.test(e.tags[k] ?? ""));
	if (ridden && e.tags.motorcar !== "yes")
		return e.tags.motorcar === "no" || !sockets.some((k) => CAR_SOCKET.test(k));
	return (
		sockets.length > 0 &&
		sockets.every((k) => k === "socket:schuko") &&
		!listed.some((t) => t.k === "socket:schuko")
	);
}

/**
 * Whether the object repeats the station's counts: its capacity, when it states one, is the
 * record's, some count agrees, and none the record is sure of differs, nor its kind of current.
 * A count that only fills a gap may agree; one that differs says nothing either way.
 */
function exactFit(x: Partial<Pick<Extraction, "tags" | "fit">>, e: OsmElement): boolean {
	const listed = [...(x.tags ?? []), ...(x.fit ?? [])];
	if (e.tags.capacity !== undefined && !listed.some((t) => t.k === "capacity")) return false;
	let agree = 0;
	for (const t of listed) {
		if (t.k !== "capacity" && !COUNT.test(t.k)) continue;
		const [a, b] = [Number.parseInt(t.v, 10), Number.parseInt(e.tags[t.k] ?? "", 10)];
		if (Number.isNaN(a) || Number.isNaN(b)) continue;
		if (a === b) agree += 1;
		else if (!("addOnly" in t && t.addOnly)) return false;
	}
	const [ours, theirs] = [current(listed.map((t) => t.k)), current(Object.keys(e.tags))];
	return agree > 0 && !(ours && theirs && ours !== theirs);
}

/** What a source counts for a whole site, which no single part of a split site carries. */
const SITE_COUNTS = /^(capacity|socket:.+)$/;

/** A connector's power is the same whichever record states it; how many there are is not. */
const isCount = (o: TagOp) => SITE_COUNTS.test(o.k) && (o.op === "del" || !o.k.endsWith(":output"));

const SPLIT_COUNTS_NOTE =
	"Capacity and sockets are left out: the source counts the whole site, not this one object";

const SHARED_COUNTS_NOTE =
	"Capacity and sockets are left out: several records were matched to this object, and each counts only its own";

/** Within this an object of the station's network with its connectors is the station, whatever its name or id says. */
const FIT_RADIUS_M = 25;

const fit = (x: Subject, e: OsmElement): Fit | null => {
	const f = stationFit(x, e);
	return f && { ...f, score: f.agree - f.against };
};

/** What a station's name says it is: "Borne de recharge Révéo" names no place. */
const STATION_WORDS = new Set([
	"borne",
	"bornes",
	"recharge",
	"station",
	"stations",
	"charging",
	"irve",
	"electrique",
	"vehicules",
]);

export const kit: KitFactory = (): Kit => ({
	words: STATION_WORDS,
	excludes: (x, e, matched) => forTwoWheels(x, e) || (!!matched && otherBorne(matched, e)),
	fit,
	// The network's own station a few metres off, with the record's connectors, is the
	// station even under a name the site has since lost or an id the network has since
	// renumbered. Farther off, what runs it or its name has to agree and the object repeat the
	// station's counts: IKEA Lyon's 24 bays sit 125 m from the registry's point.
	certain: (x, e, { agree, edge, renumbered, fits }) => {
		const network = renumbered ? renumberedPool(e, x.refs) : agree >= NAME_MATCH;
		return {
			known: edge <= FIT_RADIUS_M && network && !!fits && fits.agree > 0 && fits.against === 0,
			exact:
				edge <= DUPLICATE_RADIUS_M &&
				(!renumbered || renumberedPool(e, x.refs)) &&
				(agree >= NAME_MATCH || (nameScore(x, e, STATION_WORDS, true) ?? 0) >= NAME_MATCH) &&
				exactFit(x, e),
		};
	},
	counts: (x, el, { split, others }, ops) => {
		const borne = pointsOn(el, x.refs);
		const drop =
			split || borne ? ops.filter((o) => SITE_COUNTS.test(o.k)) : others ? ops.filter(isCount) : [];
		if (!drop.length) return null;
		return {
			drop,
			note: borne
				? `Capacity and sockets are left out: this object's ${evseTag(el)} names ${borne.on} of the station's ${borne.of} points, so the source's counts are not its own`
				: split
					? SPLIT_COUNTS_NOTE
					: SHARED_COUNTS_NOTE,
		};
	},
	refs: {
		"ref:EU:EVSE": {
			keys: evseKeysOf,
			holds: evseOn,
			related: relatedEvse,
			rival: (e) => ({
				inline: `carries ${evseTag(e)}, another station's`,
				line: `OSM carries the operator's other id ${evseTag(e)}`,
			}),
		},
	},
});
