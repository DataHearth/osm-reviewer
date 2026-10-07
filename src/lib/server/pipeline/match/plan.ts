import type { OsmElement } from "../types";
import { notThePlace } from "./find";
import { groundsOf } from "./grounds";
import { kit, mainKeys, registry } from "./kinds";
import { ADDRESS_KEY, CONTACT, disputedOps, mainOf, type TagOp, updateOps } from "./ops";
import { heldWithOthers, organisations } from "./refs";
import {
	farFromAddress,
	type Located,
	type MatchedBy,
	matchedElsewhere,
	modWarnings,
	type Placed,
	splitParts,
} from "./warnings";

/** Where the place is reached, and the organisation's own ids, which a far object's may not be. */
const reachedAt = (o: TagOp) =>
	o.group === "addr" ||
	ADDRESS_KEY.test(o.k) ||
	CONTACT.includes(o.k) ||
	organisations().some((r) => r.key === o.k);

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
	const counted = kit(x, "counts")?.(x, el, { split, others: others.length > 0 }, ops);
	if (counted) {
		leave((o) => counted.drop.includes(o));
		notes.push(counted.note);
	}
	const far = farFromAddress(x, el);
	const before = ops.length;
	// The place there may be another than the record's, so the record's date is not its own.
	// Far off and mapped as no place at all, the object is a building that kept the id: what
	// the place is, its name and its level would land there as much as its address would.
	if (far)
		leave(
			mainKeys().some((k) => el.tags[k])
				? (o) => reachedAt(o) || o.k === "start_date"
				: (o) => reachedAt(o) || !o.k.startsWith("ref:"),
		);
	const farOut = far && ops.length < before ? far : undefined;
	const main = mainOf(x);
	const shellOf = registry().shell?.of;
	if (groundsOf(x, el, els)) leave((o) => o.k === shellOf || o.k === "name");
	// A place closed, being built or turned into something else is not reopened on the
	// source's word, nor dated by it.
	if (notThePlace(el, main)) leave((o) => o.k === main?.k || o.k === "start_date");
	// An object several records are matched to, or that carries ids of other places, opened once
	// for each of them.
	if (others.length || heldWithOthers(el, x.refs)) leave((o) => o.k === "start_date");
	// Where the source's date may be a re-commissioning, an object mapped long before it says
	// so; not knowing when it was first mapped, the date is not written.
	const within = x.tags.find((t) => t.k === "start_date")?.mappedWithin;
	if (within !== undefined) {
		const mapped = el.version === 1 ? el.timestamp : el.firstMapped;
		leave(
			(o) =>
				o.k === "start_date" &&
				!(mapped && Date.parse(o.v) - Date.parse(mapped.slice(0, 10)) <= within * 86_400_000),
		);
	}
	const placed = kit(x, "place")?.(x, el);
	if (placed) {
		leave(placed.leave);
		notes.push(...placed.notes);
	}
	// Several records on one object each propose their own phone or id for it; whichever a
	// reviewer accepted last would win.
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
