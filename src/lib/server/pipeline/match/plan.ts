import { campus, groundsOf, housedInLycee, sharedByOthers } from "../fr/school";
import { LEVEL, SIRET } from "../fr/tags";
import type { OsmElement } from "../types";
import { evseTag, pointsOn } from "./charging";
import { notThePlace } from "./find";
import { CONTACT, disputedOps, MAIN, mainOf, type TagOp, updateOps } from "./ops";
import {
	farFromAddress,
	type Located,
	type MatchedBy,
	matchedElsewhere,
	modWarnings,
	offStreet,
	type Placed,
	splitParts,
} from "./warnings";

/** What a source counts for a whole site, which no single part of a split site carries. */
const SITE_COUNTS = /^(capacity|socket:.+)$/;

/** A connector's power is the same whichever record states it; how many there are is not. */
const isCount = (o: TagOp) => SITE_COUNTS.test(o.k) && (o.op === "del" || !o.k.endsWith(":output"));

const SPLIT_COUNTS_NOTE =
	"Capacity and sockets are left out: the source counts the whole site, not this one object";

const SHARED_COUNTS_NOTE =
	"Capacity and sockets are left out: several records were matched to this object, and each counts only its own";

/** Where the place is reached, and the organisation's SIRET, which a far object's may not be. */
const reachedAt = (o: TagOp) =>
	o.group === "addr" || /^(addr|contact):/.test(o.k) || CONTACT.includes(o.k) || o.k === SIRET;

export interface Plan {
	ops: TagOp[];
	notes: string[];
	/** How far the object lies from the record, when that left some of its operations out. */
	far?: number;
}

/**
 * What a matched record writes to its object, and what the reviewer is told was left out:
 * the site's counts on one part of it, values another record on the object disputes, and
 * where it is reached when the object lies far from the record's address.
 */
export function planUpdate(
	x: Placed & Located,
	el: OsmElement,
	els: OsmElement[],
	refIndex: Map<string, OsmElement[]> = new Map(),
	shared: Set<string> = new Set(),
	matchedBy: MatchedBy = new Map(),
): Plan {
	let ops = updateOps(x.tags, el.tags);
	const notes: string[] = [];
	const others = matchedElsewhere(el, x, matchedBy);
	const leave = (out: (o: TagOp) => boolean) => {
		ops = ops.filter((o) => !out(o));
	};
	const split = splitParts(x, el, els, refIndex, shared, matchedBy).length > 0;
	const borne = pointsOn(el, x.refs);
	const counts =
		split || borne
			? ops.filter((o) => SITE_COUNTS.test(o.k))
			: others.length
				? ops.filter(isCount)
				: [];
	if (counts.length) {
		leave((o) => counts.includes(o));
		notes.push(
			borne
				? `Capacity and sockets are left out: this object's ${evseTag(el)} names ${borne.on} of the station's ${borne.of} points, so the source's counts are not its own`
				: split
					? SPLIT_COUNTS_NOTE
					: SHARED_COUNTS_NOTE,
		);
	}
	const far = farFromAddress(x, el);
	const before = ops.length;
	// The place there may be another than the record's, so the record's date is not its own.
	// Far off and mapped as no place at all, the object is a building that kept the id: what
	// the place is, its name and its level would land there as much as its address would.
	if (far)
		leave(
			MAIN.some((k) => el.tags[k])
				? (o) => reachedAt(o) || o.k === "start_date"
				: (o) => reachedAt(o) || !o.k.startsWith("ref:"),
		);
	const farOut = far && ops.length < before ? far : undefined;
	if (offStreet(x, el)) leave((o) => o.group === "addr");
	const main = mainOf(x);
	if (groundsOf(x, el, els)) leave((o) => o.k === "amenity" || o.k === "name");
	// A place closed, being built or turned into something else is not reopened on the
	// source's word, nor dated by it.
	if (notThePlace(el, main)) leave((o) => o.k === main?.k || o.k === "start_date");
	// A group's object (a primaire and its collège, a cité scolaire) opened once for each of them.
	if (others.length || sharedByOthers(el, x.refs) || campus(el.tags))
		leave((o) => o.k === "start_date");
	// Nor does one of its establishments give it a single level.
	if (campus(el.tags)) leave((o) => o.k === LEVEL);
	const housed = housedInLycee(x, el.tags);
	if (housed) {
		leave((o) => o.k === "amenity");
		notes.push(housed);
	}
	// Several establishments on one object (a cité scolaire) each propose their own phone,
	// SIRET or UAI for it; whichever a reviewer accepted last would win.
	const disputed = disputedOps(ops, others, el.tags);
	if (disputed.length) {
		leave((o) => disputed.includes(o));
		notes.push(
			`Left out, since another record on this object says otherwise: ${[...new Set(disputed.map((o) => o.k))].join(", ")}`,
		);
	}
	notes.push(...modWarnings(ops, el.tags));
	return { ops, notes, ...(farOut ? { far: farOut } : {}) };
}
