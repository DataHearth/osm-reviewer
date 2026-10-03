import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { type OsmElement, osmRef } from "./types";

/**
 * A queued candidate was computed against one version of its OSM object. If the object is
 * newer now, the candidate is in conflict (`headVersion` set) and shows both sides: what
 * the object says today for the keys the candidate touches, and what the candidate would
 * write. Returns how many were newly flagged.
 */
export function refreshConflicts(db: Db, areaId: string, elements: OsmElement[]): number {
	if (elements.length === 0) return 0;
	const byRef = new Map(elements.map((e) => [osmRef(e), e]));

	const queued = db
		.select({
			id: t.candidates.id,
			osmId: t.candidates.osmId,
			version: t.candidates.version,
			baseVersion: t.candidates.baseVersion,
			headVersion: t.candidates.headVersion,
		})
		.from(t.candidates)
		.leftJoin(t.decisions, eq(t.decisions.candidateId, t.candidates.id))
		.where(
			and(
				eq(t.candidates.areaId, areaId),
				isNotNull(t.candidates.osmId),
				isNull(t.decisions.candidateId),
			),
		)
		.all();

	let flagged = 0;
	for (const c of queued) {
		const el = byRef.get(c.osmId as string);
		if (!el || el.version <= (c.baseVersion ?? c.version) || c.headVersion === el.version) continue;

		db.transaction((tx) => {
			const ours = tx.select().from(t.tags).where(eq(t.tags.candidateId, c.id)).all();
			tx.update(t.candidates)
				.set({ headVersion: el.version, conflictWho: el.user ?? "another mapper" })
				.where(eq(t.candidates.id, c.id))
				.run();
			tx.delete(t.candidateConflictTags).where(eq(t.candidateConflictTags.candidateId, c.id)).run();

			const theirs = ours
				.filter((o) => el.tags[o.k] !== undefined)
				.map((o, position) => ({
					candidateId: c.id,
					side: "theirs" as const,
					position,
					k: o.k,
					v: el.tags[o.k],
				}));
			const mine = ours
				.filter((o) => o.op !== "del")
				.map((o, position) => ({
					candidateId: c.id,
					side: "ours" as const,
					position,
					k: o.k,
					v: o.v,
				}));
			const numbered = [...theirs, ...mine];
			if (numbered.length) tx.insert(t.candidateConflictTags).values(numbered).run();
		});
		flagged += 1;
	}
	return flagged;
}
