import type { Extraction, ProposedTag } from "../types";
import { digits, sameUrl, sameValue } from "./values";

export type Main = { k: string; v: string };

export const mainOf = (x: Partial<Pick<Extraction, "tags">>): Main | undefined =>
	x.tags?.find((t) => MAIN.includes(t.k));

/** Lifecycle prefixes a mapper puts on a place's main tag once it is no longer that place. */
export const RETIRED = ["disused", "abandoned", "was"];

export interface TagOp extends ProposedTag {
	op: "add" | "mod" | "del";
	was: string | null;
	/** The key of the other half of a move, which is only right taken together with this one. */
	pair?: string;
}

export const CONTACT = ["phone", "website", "email", "fax", "mobile"];

/** A detail the object may already carry under another key: a station's phone is usually its operator's line. */
const PHONES = ["phone", "contact:phone", "mobile", "contact:mobile"];

const SAME_AS: Record<string, string[]> = { phone: PHONES, "operator:phone": PHONES };

/** What the object already says that rules a proposed value out: a station surveyed as badge-only. */
const RULED_OUT: Record<string, (current: Record<string, string>) => boolean> = {
	"authentication:none": (c) =>
		c["payment:membership_card"] === "yes" ||
		Object.entries(c).some(
			([k, v]) => k.startsWith("authentication:") && k !== "authentication:none" && v === "yes",
		),
};

/**
 * The key this object keeps `k` under: mappers write contact details as `contact:phone`
 * as often as `phone`, and an object already using the `contact:` scheme gets the new
 * detail in the same scheme rather than a second copy beside it.
 */
export function keyOn(k: string, current: Record<string, string>): string {
	if (current[k] !== undefined || !CONTACT.includes(k)) return k;
	const scheme = `contact:${k}`;
	if (current[scheme] !== undefined) return scheme;
	return CONTACT.some((c) => current[`contact:${c}`] !== undefined) ? scheme : k;
}

const ADDRESS_HELD = /^contact:(housenumber|street|postcode|city)$/;

/**
 * An address proposed whole, or not at all when any part differs from the object's. One the
 * object holds as `contact:housenumber`… (how the 2016–2018 Éducation nationale imports wrote
 * it) is its address all the same, and moves to `addr:*`, where OSM keeps one, rather than
 * gaining a second copy beside it.
 */
function addressOps(parts: ProposedTag[], current: Record<string, string>): TagOp[] {
	if (!parts.length) return [];
	const held = (k: string) => current[k] ?? current[k.replace(/^addr:/, "contact:")];
	if (parts.some((p) => held(p.k) !== undefined && !sameValue(p.k, p.v, held(p.k)))) return [];
	const ops: TagOp[] = [];
	for (const from of Object.keys(current).filter((k) => ADDRESS_HELD.test(k))) {
		const to = from.replace(/^contact:/, "addr:");
		if (current[to] !== undefined) continue;
		const v = current[from];
		const ev = parts.find((p) => p.k === to) ?? {
			...parts[0],
			path: from,
			kind: "OSM",
			parts: [
				{ text: `${from}: `, mark: false },
				{ text: v, mark: true },
			],
		};
		ops.push({ ...ev, k: to, v, op: "add", was: null, pair: from });
		ops.push({ ...ev, k: from, v, op: "del", was: null, pair: to });
	}
	for (const p of parts) if (held(p.k) === undefined) ops.push({ ...p, op: "add", was: null });
	return ops;
}

/** A count of connectors of no stated type, which typed counts replace rather than add to. */
const UNTYPED = ["socket:unknown", "socket:unknown:output"];

/** A registry's bare `24/7` is what it writes when nobody filled the hours in, not a survey. */
const addOnly = (p: ProposedTag) => p.addOnly || (p.k === "opening_hours" && p.v.trim() === "24/7");

/** Tag operations that turn the element's tags into what the source says; nothing for what already agrees. */
export function updateOps(proposed: ProposedTag[], current: Record<string, string>): TagOp[] {
	const ops: TagOp[] = addressOps(
		proposed.filter((p) => p.group === "addr"),
		current,
	);
	for (const p of proposed) {
		if (p.group === "addr" || RULED_OUT[p.k]?.(current)) continue;
		// A main tag beside its own `disused:` twin would reopen the place on the source's word.
		if (MAIN.includes(p.k) && RETIRED.some((r) => current[`${r}:${p.k}`] !== undefined)) continue;
		const k = keyOn(p.k, current);
		const elsewhere = SAME_AS[p.k]?.filter((o) => o !== k);
		if (elsewhere?.some((o) => current[o] && digits(current[o]) === digits(p.v))) continue;
		const had = current[k];
		if (had === undefined) ops.push({ ...p, k, op: "add", was: null });
		else if (!addOnly(p) && ![p.v, ...(p.also ?? [])].some((v) => sameValue(p.k, v, had)))
			ops.push({ ...p, k, op: "mod", was: had });
	}
	const typed = ops.find((o) => /^socket:(?!unknown)[^:]+$/.test(o.k));
	if (typed)
		for (const k of UNTYPED)
			if (current[k] !== undefined) ops.push({ ...typed, k, v: current[k], op: "del", was: null });
	const amenity = ops.find((o) => o.k === "amenity")?.v ?? current.amenity;
	return amenity === "social_facility" ? ops : ops.filter((o) => o.k !== "social_facility:for");
}

export function newOps(proposed: ProposedTag[]): TagOp[] {
	return proposed.map((p) => ({ ...p, op: "add" as const, was: null }));
}

export const MAIN = ["amenity", "shop", "office", "tourism", "leisure", "craft", "healthcare"];

/** A closed place keeps its mapping as `disused:`, and loses the details that no longer apply. */
export function closureOps(
	by: NonNullable<Extraction["closedBy"]>,
	current: Record<string, string>,
	conf: number,
): TagOp[] {
	const key = MAIN.find((k) => current[k]);
	if (!key) return [];
	const ev = { conf, path: by.path, parts: by.parts, kind: by.kind };
	const ops: TagOp[] = [
		{ ...ev, op: "mod", k: `disused:${key}`, v: current[key], was: `${key}=${current[key]}` },
	];
	for (const k of ["opening_hours", "phone"])
		if (current[k]) ops.push({ ...ev, op: "del", k, v: current[k], was: null });
	return ops;
}

const agreeBetween = (k: string, a: string, b: string) =>
	k.replace(/^contact:/, "") === "website" ? sameUrl(a, b) : sameValue(k, a, b);

/**
 * The operations among `ops` another record matched to the same object contradicts, compared
 * under the key the object would get each value under. A move or an address goes whole.
 */
export function disputedOps(
	ops: TagOp[],
	others: Pick<Extraction, "tags">[],
	current: Record<string, string>,
): TagOp[] {
	const direct = ops.filter(
		(o) =>
			o.op !== "del" &&
			others.some((other) =>
				other.tags.some((t) => keyOn(t.k, current) === o.k && !agreeBetween(t.k, t.v, o.v)),
			),
	);
	const groups = new Set(direct.map((o) => o.group).filter(Boolean));
	const keys = new Set(direct.map((o) => o.k));
	return ops.filter(
		(o) =>
			direct.includes(o) ||
			(o.group !== undefined && groups.has(o.group)) ||
			(o.pair !== undefined && keys.has(o.pair)),
	);
}

/**
 * What tells a reviewer this is the right object comes first: what kind of object it is, and
 * the identifiers and level it already carries. The address, which rarely settles it, comes last.
 */
const CONTEXT_KEYS = [
	...MAIN,
	"name",
	"ref:UAI",
	"ref:EU:EVSE",
	"ref:FR:SIRET",
	"school:FR",
	"operator",
	"brand",
	"opening_hours",
	"phone",
	"contact:phone",
	"email",
	"contact:email",
	"website",
	"contact:website",
];

const contextRank = (k: string) => {
	const at = CONTEXT_KEYS.indexOf(k);
	if (at >= 0) return at;
	return k.startsWith("addr:") || ADDRESS_HELD.test(k) ? CONTEXT_KEYS.length : -1;
};

/**
 * The element's tags the candidate leaves alone, all of them. A closure's `disused:amenity`
 * replaces the bare `amenity`, which is therefore not left alone either.
 */
export function unchangedTags(current: Record<string, string>, touched: Set<string>) {
	return Object.entries(current)
		.filter(([k]) => !touched.has(k) && !touched.has(`disused:${k}`))
		.map(([k, v]) => ({ k, v }));
}

/** The few of them a reviewer looks at for context. */
export function contextTags(unchanged: { k: string; v: string }[]) {
	return unchanged
		.filter((x) => contextRank(x.k) >= 0)
		.sort((a, b) => contextRank(a.k) - contextRank(b.k))
		.slice(0, 6);
}
