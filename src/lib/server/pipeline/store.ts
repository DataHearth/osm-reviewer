import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or } from "drizzle-orm";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import type { TagOp } from "./match";
import { evidenceDate } from "./presets";

export interface CandidateWrite {
	sourceId: string;
	areaId: string;
	key: string;
	hash: string;
	type: "new" | "update" | "closure";
	osmId: string | null;
	/** The OSM version the tags were computed against; 0 without an `osmId`. */
	version: number;
	name: string;
	addr: string;
	lat: number;
	lon: number;
	conf: number;
	url: string;
	licence: string;
	ops: TagOp[];
	nearby: string[];
	unchanged: { k: string; v: string }[];
	seenAt: Date;
}

const newId = () => "c" + randomBytes(5).toString("hex");

export type Existing = {
	id: string;
	areaId: string;
	osmId: string | null;
	contentHash: string | null;
	decided: boolean;
};

export function existingCandidates(db: Db, sourceId: string): Map<string, Existing> {
	const rows = db
		.select({
			key: t.candidates.sourceRecordKey,
			id: t.candidates.id,
			areaId: t.candidates.areaId,
			osmId: t.candidates.osmId,
			contentHash: t.candidates.contentHash,
			decision: t.decisions.candidateId,
		})
		.from(t.candidates)
		.leftJoin(t.decisions, eq(t.decisions.candidateId, t.candidates.id))
		.where(eq(t.candidates.sourceId, sourceId))
		.all();
	return new Map(
		rows.map((r) => [
			r.key,
			{
				id: r.id,
				areaId: r.areaId,
				osmId: r.osmId,
				contentHash: r.contentHash,
				decided: r.decision !== null,
			},
		]),
	);
}

/**
 * Writes one candidate with its tags and evidence. A candidate a reviewer has decided on,
 * or one another area already holds, is left exactly as it is: the unique key is the
 * source's record, so one record cannot be queued twice.
 */
export function saveCandidate(db: Db, w: CandidateWrite, existing: Existing | undefined): boolean {
	if (existing && (existing.decided || existing.areaId !== w.areaId)) return false;

	db.transaction((tx) => {
		const row = {
			sourceId: w.sourceId,
			areaId: w.areaId,
			sourceRecordKey: w.key,
			contentHash: w.hash,
			seenAt: w.seenAt,
			osmId: w.osmId,
			type: w.type,
			name: w.name,
			addr: w.addr,
			lat: w.lat,
			lon: w.lon,
			conf: w.conf,
			version: w.version,
			fetchedAt: w.seenAt,
			baseVersion: w.osmId ? w.version : null,
			headVersion: null,
			conflictWho: null,
			unchangedTags: w.unchanged,
		};
		let id: string;
		if (existing) {
			id = existing.id;
			tx.update(t.candidates).set(row).where(eq(t.candidates.id, id)).run();
			tx.delete(t.tags).where(eq(t.tags.candidateId, id)).run();
			tx.delete(t.candidateNearby).where(eq(t.candidateNearby.candidateId, id)).run();
			tx.delete(t.candidateConflictTags).where(eq(t.candidateConflictTags.candidateId, id)).run();
		} else {
			id = newId();
			tx.insert(t.candidates)
				.values({ ...row, id })
				.run();
		}

		const when = evidenceDate(w.seenAt);
		w.ops.forEach((op, position) => {
			const tag = tx
				.insert(t.tags)
				.values({
					candidateId: id,
					position,
					op: op.op,
					k: op.k,
					v: op.v,
					was: op.was,
					conf: op.conf,
				})
				.returning({ id: t.tags.id })
				.get();
			const ev = tx
				.insert(t.evidence)
				.values({
					tagId: tag.id,
					path: op.path,
					url: w.url,
					when,
					kind: w.licence ? `${op.kind} · ${w.licence}` : op.kind,
					conf: op.conf,
				})
				.returning({ id: t.evidence.id })
				.get();
			tx.insert(t.evidenceParts)
				.values(
					op.parts.map((p, i) => ({ evidenceId: ev.id, position: i, text: p.text, mark: p.mark })),
				)
				.run();
		});
		if (w.nearby.length)
			tx.insert(t.candidateNearby)
				.values(w.nearby.map((label, position) => ({ candidateId: id, position, label })))
				.run();
	});
	return true;
}

const CHUNK = 500;

export function touchSeen(db: Db, sourceId: string, areaId: string, keys: string[], at: Date) {
	for (let i = 0; i < keys.length; i += CHUNK)
		db.update(t.candidates)
			.set({ seenAt: at })
			.where(
				and(
					eq(t.candidates.sourceId, sourceId),
					eq(t.candidates.areaId, areaId),
					inArray(t.candidates.sourceRecordKey, keys.slice(i, i + CHUNK)),
				),
			)
			.run();
}

/**
 * Drops the candidates this source made for the area that the run no longer saw, unless a
 * reviewer has decided them. Candidates without a `contentHash` were not made by a run
 * (fixtures, hand entry) and are never swept.
 */
export function sweepVanished(db: Db, sourceId: string, areaId: string, runStart: Date): number {
	return db
		.delete(t.candidates)
		.where(
			and(
				eq(t.candidates.sourceId, sourceId),
				eq(t.candidates.areaId, areaId),
				isNotNull(t.candidates.contentHash),
				or(isNull(t.candidates.seenAt), lt(t.candidates.seenAt, runStart)),
				notInArray(t.candidates.id, db.select({ id: t.decisions.candidateId }).from(t.decisions)),
			),
		)
		.run().changes;
}
