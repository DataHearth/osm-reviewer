import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";

export class RefusedError extends Error {}

function candidateFor(db: Db, id: string) {
	const c = db.select().from(t.candidates).where(eq(t.candidates.id, id)).all()[0];
	if (!c) throw new RefusedError("no such candidate.");
	const decided = db.select().from(t.decisions).where(eq(t.decisions.candidateId, id)).all()[0];
	if (decided) throw new RefusedError("already " + decided.kind + ".");
	return c;
}

/**
 * The same gate the review screen shows as `blockedReason`, enforced where it
 * counts: the client picks which tags to write, so the reasons a tag may not be
 * written are checked again against the rows themselves.
 */
export function accept(db: Db, userId: string, id: string, positions: number[]) {
	const c = candidateFor(db, id);
	if (c.headVersion !== null)
		throw new RefusedError(
			"accept blocked — version conflict unresolved. Rebase onto v" + c.headVersion + ".",
		);

	const rows = db
		.select()
		.from(t.tags)
		.where(eq(t.tags.candidateId, id))
		.orderBy(asc(t.tags.position))
		.all();
	if (rows.every((tag) => !hasEvidence(db, tag.id)))
		throw new RefusedError("accept blocked — candidate quarantined, no tag has evidence.");

	const wanted = new Set(positions);
	const picked = rows.filter((tag) => wanted.has(tag.position));
	if (picked.length !== wanted.size) throw new RefusedError("no such tag.");
	if (picked.some((tag) => tag.invalid))
		throw new RefusedError("accept blocked — opening_hours fails syntax validation.");
	if (picked.some((tag) => !hasEvidence(db, tag.id)))
		throw new RefusedError("accept blocked — an unevidenced tag cannot be written.");

	db.transaction((tx) => {
		tx.insert(t.decisions)
			.values({ candidateId: id, kind: "accepted", userId, decidedAt: new Date() })
			.run();
		tx.insert(t.decisionTags)
			.values(picked.map((tag) => ({ candidateId: id, tagId: tag.id })))
			.run();
	});
}

function hasEvidence(db: Db, tagId: number) {
	return db.select().from(t.evidence).where(eq(t.evidence.tagId, tagId)).all().length > 0;
}

export function reject(db: Db, userId: string, id: string) {
	candidateFor(db, id);
	db.insert(t.decisions)
		.values({ candidateId: id, kind: "rejected", userId, decidedAt: new Date() })
		.run();
}

/** Undo only reaches a decision the upload has not carried away. */
export function undo(db: Db, id: string) {
	const d = db.select().from(t.decisions).where(eq(t.decisions.candidateId, id)).all()[0];
	if (!d) throw new RefusedError("nothing to undo.");
	if (d.changesetId) throw new RefusedError("already uploaded — undo would not reach OSM.");
	db.delete(t.decisions).where(eq(t.decisions.candidateId, id)).run();
}

export interface UploadConflict {
	candidateId: string;
	osmId: string;
	changesetId: string;
	baseVersion: number;
	headVersion: number;
	staged: number;
}

function nextChangesetId(db: Db) {
	const [row] = db
		.select({
			max: sql<number>`coalesce(max(cast(${t.changesets.id} as integer)), 154000000)`.mapWith(
				Number,
			),
		})
		.from(t.changesets)
		.all();
	return String(row.max + 1);
}

/**
 * Uploads every staged candidate as one changeset. An object another mapper has
 * already moved fails the whole changeset the first time it is sent: OSM closes
 * it without writing, so nothing is staged away and the retry is what applies it.
 */
export function upload(
	db: Db,
	v: { comment: string; source: string; retry: boolean },
): { changesetId: string } | { conflict: UploadConflict } {
	const staged = db
		.select({
			candidateId: t.decisions.candidateId,
			osmId: t.candidates.osmId,
			conflictWho: t.candidates.conflictWho,
			baseVersion: t.candidates.baseVersion,
			version: t.candidates.version,
		})
		.from(t.decisions)
		.innerJoin(t.candidates, eq(t.candidates.id, t.decisions.candidateId))
		.where(and(eq(t.decisions.kind, "accepted"), isNull(t.decisions.changesetId)))
		.all();
	if (staged.length === 0) throw new RefusedError("nothing staged.");

	const id = nextChangesetId(db);
	const moved = staged.find((s) => s.conflictWho !== null);
	if (moved && !v.retry) {
		return {
			conflict: {
				candidateId: moved.candidateId,
				osmId: moved.osmId,
				changesetId: id,
				baseVersion: (moved.baseVersion ?? moved.version) - 1,
				headVersion: moved.version,
				staged: staged.length,
			},
		};
	}

	db.transaction((tx) => {
		tx.insert(t.changesets)
			.values({
				id,
				osmId: id,
				url: "https://www.openstreetmap.org/changeset/" + id,
				uploadedAt: new Date(),
				comment: v.comment,
				objects: staged.length + (staged.length === 1 ? " node" : " nodes"),
				result: "ok",
			})
			.run();
		tx.update(t.decisions)
			.set({ changesetId: id })
			.where(and(eq(t.decisions.kind, "accepted"), isNull(t.decisions.changesetId)))
			.run();
	});
	return { changesetId: id };
}
