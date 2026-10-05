import { distance } from "../geo";
import type { Findable } from "../match/find";
import { NAME_MATCH, nameScore } from "../match/names";
import { keyOn, mainOf } from "../match/ops";
import { MATCH_RADIUS_M, SPLIT_RADIUS_M } from "../match/radii";
import type { RefScheme } from "../match/refs";
import { sameValue } from "../match/values";
import { sameKind, schoolBuilding } from "../tagfilter";
import { ids, normaliseName } from "../text";
import type { Extraction, OsmElement } from "../types";
import { LEVEL, SIRET, sameLevel, UAI } from "./tags";

const UAI_KEYS = [UAI, "ref:FR:UAI"];

/** The `ce.<UAI>@ac-…` mailbox an académie gives every school names its establishment too. */
const mailUai = (e: OsmElement) =>
	/^ce\.(\d{7}[a-z])@ac-/i.exec(e.tags["contact:email"] ?? e.tags.email ?? "")?.[1].toUpperCase();

const uai: RefScheme = {
	aliases: UAI_KEYS,
	also: mailUai,
	// Fetched whatever else they carry: a school ground tagged only `building=school` still has its UAI.
	selectors: UAI_KEYS.map((k) => ({ k, v: null })),
	site: true,
};

/** The identifiers French sources carry, and how OSM holds them. */
export const schemes: Record<string, RefScheme> = {
	[UAI]: uai,
	[SIRET]: { aliases: [SIRET, "siret"] },
};

/** Whether `e` is another establishment: it carries a UAI, and none of them is the record's. */
export function otherPlace(e: OsmElement, refs: Record<string, string>): boolean {
	if (!refs[UAI]) return false;
	const ours = new Set(ids(refs[UAI]));
	const theirs = UAI_KEYS.flatMap((k) => (e.tags[k] ? ids(e.tags[k]) : []));
	const mail = mailUai(e);
	if (mail) theirs.push(mail);
	return theirs.length > 0 && !theirs.some((x) => ours.has(x));
}

/** How many of the record's values the object already holds. */
export function held(x: Partial<Pick<Extraction, "tags">>, e: OsmElement): number {
	return (x.tags ?? []).filter((p) => {
		const had = e.tags[keyOn(p.k, e.tags)];
		return had !== undefined && sameValue(p.k, p.v, had);
	}).length;
}

/**
 * The school among several objects carrying its UAI side by side, as a bare node beside the
 * grounds often does: the one named for it, then the way or relation, or whichever holds more
 * of what the record says.
 */
export function bestHit(x: Findable, hits: { e: OsmElement; d: number }[]): OsmElement | null {
	const pool = hits.some((h) => !schoolBuilding(h.e.tags))
		? hits.filter((h) => !schoolBuilding(h.e.tags))
		: hits;
	if (!pool.length) return null;
	if (!x.refs[UAI]) return pool[0].e;
	const named = (e: OsmElement) => (e.tags.name && (nameScore(x, e) ?? 0) >= NAME_MATCH ? 1 : 0);
	const rank = (e: OsmElement) => held(x, e) + (e.type === "node" ? 0 : 1);
	const near = pool.filter((h) => h.d <= pool[0].d + MATCH_RADIUS_M);
	return near.sort((a, b) => named(b.e) - named(a.e) || rank(b.e) - rank(a.e) || a.d - b.d)[0].e;
}

/**
 * The object mapped as the school that a school building stands in or beside: one of its kind
 * next to it, or one named like the record a little farther, since only centres are known and
 * a building inside large grounds stands well off theirs.
 */
export function groundsOf(x: Findable, building: OsmElement, els: OsmElement[]): OsmElement | null {
	const main = mainOf(x);
	if (!main || !schoolBuilding(building.tags)) return null;
	return (
		els
			.filter((e) => e !== building && sameKind(main.k, main.v, e.tags))
			.map((e) => ({ e, d: distance(building.lat, building.lon, e.lat, e.lon) }))
			.filter(
				({ e, d }) =>
					d <= SPLIT_RADIUS_M || (d <= MATCH_RADIUS_M && (nameScore(x, e) ?? 0) >= NAME_MATCH),
			)
			.sort((a, b) => a.d - b.d)[0]?.e ?? null
	);
}

/** Whether the grounds a matched school building stands in are this school's, not a neighbour's. */
export function ownGrounds(x: Findable, grounds: OsmElement): boolean {
	const level = x.tags?.find((t) => t.k === LEVEL)?.v;
	const theirs = grounds.tags[LEVEL];
	return (
		!otherPlace(grounds, x.refs) &&
		(!grounds.tags.name || (nameScore(x, grounds) ?? 0) >= NAME_MATCH) &&
		(!level || !theirs || sameLevel(level, theirs))
	);
}

/** Whether `e` carries, besides the record's own UAI, another establishment's. */
export function sharedByOthers(e: OsmElement, refs: Record<string, string>): boolean {
	const ours = new Set(ids(refs[UAI] ?? ""));
	return ours.size > 0 && UAI_KEYS.some((k) => ids(e.tags[k] ?? "").some((id) => !ours.has(id)));
}

/** A school's level in its name: an école of any kind, a collège, a lycée. */
const LEVEL_WORDS: Record<string, string> = {
	ecole: "primaire",
	maternelle: "primaire",
	elementaire: "primaire",
	primaire: "primaire",
	college: "collège",
	lycee: "lycée",
};

/**
 * One object for several establishments: a cité scolaire, a "groupe scolaire", an
 * "Établissement (École, Collège, Lycée)". Whichever of them a record is, its opening is not
 * the object's.
 */
export function campus(tags: Record<string, string>): boolean {
	const level = tags[LEVEL] ?? "";
	if (level === "secondaire" || level.includes(";")) return true;
	const name = normaliseName(tags.name ?? "");
	if (/\b(groupe|cite) scolaire\b/.test(name)) return true;
	return new Set(name.split(" ").flatMap((w) => LEVEL_WORDS[w] ?? [])).size > 1;
}

/** A maternelle is often mapped as the kindergarten it looks like, under its own name. */
export const maternelleAs = (x: Pick<Extraction, "name" | "tags">, e: OsmElement) =>
	e.tags.amenity !== "kindergarten" ||
	(/maternelle/.test(x.tags.findLast((t) => t.k === LEVEL)?.v ?? "") &&
		(nameScore(x, e) ?? 0) >= NAME_MATCH);

/** A post-bac school's `amenity=college` on an object that reads as a lycée would unsay the lycée. */
export function lyceeMadeCollege(
	ops: { op: string; k: string; v: string }[],
	current: Record<string, string>,
): string[] {
	const lycee = /lycée/i.test(current[LEVEL] ?? "")
		? `${LEVEL}=${current[LEVEL]}`
		: /^lycée/i.test(current.name ?? "")
			? `name=${current.name}`
			: null;
	return lycee && ops.some((o) => o.op === "mod" && o.k === "amenity" && o.v === "college")
		? [
				`The object reads as a lycée (${lycee}), which amenity=college would no longer say: check whether the post-bac school is mapped apart from it`,
			]
		: [];
}
