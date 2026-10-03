import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { osm } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { CREATED_BY } from "$lib/server/instance";
import { notify } from "$lib/server/notify";
import {
	closeChangeset,
	createChangeset,
	fetchElements,
	OsmError,
	uploadChange,
} from "$lib/server/osm/api";
import { type Change, type OsmElement, osmChange, type TagOp } from "$lib/server/osm/osmchange";

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

interface StagedRow {
	candidateId: string;
	osmId: string | null;
	type: "new" | "update" | "closure";
	lat: number;
	lon: number;
	sourceId: string;
	base: number;
	ops: TagOp[];
}

function stagedRows(db: Db): StagedRow[] {
	const rows = db
		.select({
			candidateId: t.decisions.candidateId,
			osmId: t.candidates.osmId,
			type: t.candidates.type,
			lat: t.candidates.lat,
			lon: t.candidates.lon,
			sourceId: t.candidates.sourceId,
			baseVersion: t.candidates.baseVersion,
			version: t.candidates.version,
		})
		.from(t.decisions)
		.innerJoin(t.candidates, eq(t.candidates.id, t.decisions.candidateId))
		.where(and(eq(t.decisions.kind, "accepted"), isNull(t.decisions.changesetId)))
		.orderBy(asc(t.decisions.decidedAt))
		.all();
	const picked = db
		.select({ candidateId: t.decisionTags.candidateId, op: t.tags.op, k: t.tags.k, v: t.tags.v })
		.from(t.decisionTags)
		.innerJoin(t.tags, eq(t.tags.id, t.decisionTags.tagId))
		.where(
			inArray(
				t.decisionTags.candidateId,
				rows.map((r) => r.candidateId),
			),
		)
		.orderBy(asc(t.tags.position))
		.all();
	return rows.map(({ baseVersion, version, ...r }) => ({
		...r,
		base: baseVersion ?? version,
		ops: picked.filter((p) => p.candidateId === r.candidateId),
	}));
}

/** Records that OSM moved an object after the candidate was computed; this is what the composer's rebase resolves. */
function markConflict(db: Db, row: StagedRow, head: OsmElement) {
	const touched = new Set(row.ops.map((o) => o.k));
	db.transaction((tx) => {
		tx.update(t.candidates)
			.set({ headVersion: head.version, conflictWho: head.user ?? "another mapper" })
			.where(eq(t.candidates.id, row.candidateId))
			.run();
		tx.delete(t.candidateConflictTags)
			.where(eq(t.candidateConflictTags.candidateId, row.candidateId))
			.run();
		const theirs = Object.entries(head.tags).filter(([k]) => touched.has(k));
		const ours = row.ops.filter((o) => o.op !== "del");
		const rows = [
			...theirs.map(([k, v], position) => ({
				candidateId: row.candidateId,
				side: "theirs" as const,
				position,
				k,
				v,
			})),
			...ours.map((o, position) => ({
				candidateId: row.candidateId,
				side: "ours" as const,
				position,
				k: o.k,
				v: o.v,
			})),
		];
		if (rows.length) tx.insert(t.candidateConflictTags).values(rows).run();
	});
}

export interface UploadConflict {
	candidateId: string;
	osmId: string;
	changesetId: string;
	baseVersion: number;
	headVersion: number;
	staged: number;
}

const conflictOf = (
	row: StagedRow,
	head: OsmElement,
	changesetId: string,
	staged: number,
): { conflict: UploadConflict } => ({
	conflict: {
		candidateId: row.candidateId,
		osmId: row.osmId ?? row.candidateId,
		changesetId,
		baseVersion: row.base,
		headVersion: head.version,
		staged,
	},
});

const TAG_MAX = 255;
const clip = (s: string) => (s.length > TAG_MAX ? s.slice(0, TAG_MAX - 1) + "…" : s);

/** `#a;#b`, the form OSM's `hashtags` tag takes, from however the setting was typed. */
const hashtagTag = (raw: string) =>
	raw
		.split(/[\s;,]+/)
		.filter(Boolean)
		.map((h) => (h.startsWith("#") ? h : "#" + h))
		.join(";");

function sourceTag(db: Db, typed: string, rows: StagedRow[]) {
	const used = db
		.select({ name: t.sources.name, licence: t.sources.licence })
		.from(t.sources)
		.where(
			inArray(
				t.sources.id,
				rows.map((r) => r.sourceId),
			),
		)
		.all();
	const named = used.map((s) => (s.licence ? `${s.name} (${s.licence})` : s.name));
	return clip([typed, ...named].filter(Boolean).join("; "));
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function objectsLabel(changes: Change[]) {
	const count = { node: 0, way: 0, relation: 0 };
	for (const c of changes) count[c.kind === "create" ? "node" : c.element.type]++;
	return Object.entries(count)
		.filter(([, n]) => n > 0)
		.map(([k, n]) => plural(n, k))
		.join(", ");
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function failChangeset(
	db: Db,
	userId: string,
	v: { comment: string; objects: string; result: string; error: string },
) {
	db.insert(t.changesets)
		.values({
			id: "fail-" + randomUUID(),
			osmId: null,
			url: "",
			uploadedAt: new Date(),
			comment: v.comment,
			objects: v.objects,
			result: v.result,
			error: v.error,
			uploadedBy: userId,
		})
		.run();
}

/**
 * Uploads every staged candidate, in changesets of the account's `osmPerChangeset`.
 * Each object is fetched first: one whose version moved past the candidate's base
 * is marked in conflict and nothing is sent, which is what the composer's rebase
 * resolves. OSM's own version check on upload is the second line for an edit that
 * lands between that fetch and the POST. A batch that fails stays staged.
 */
export async function upload(
	db: Db,
	userId: string,
	v: { comment: string; source: string },
): Promise<{ changesetId: string } | { conflict: UploadConflict }> {
	const account = db
		.select()
		.from(t.userSettings)
		.where(eq(t.userSettings.userId, userId))
		.all()[0];
	if (!account?.osmToken || !account.osmConnected)
		throw new RefusedError("no OSM account connected — connect one in settings.");
	const token = account.osmToken;

	const staged = stagedRows(db);
	if (staged.length === 0) throw new RefusedError("nothing staged.");

	let current: Map<string, OsmElement>;
	try {
		current = await fetchElements(
			token,
			staged.flatMap((r) => (r.osmId ? [r.osmId] : [])),
		);
	} catch (e) {
		throw new RefusedError("could not read the objects from OSM — " + errorText(e));
	}
	for (const row of staged) {
		if (!row.osmId) continue;
		const head = current.get(row.osmId);
		if (!head)
			throw new RefusedError(`${row.osmId} no longer exists on OSM — reject its candidate.`);
		if (head.version > row.base) {
			markConflict(db, row, head);
			return conflictOf(row, head, "—", staged.length);
		}
	}

	const size = Math.max(1, account.osmPerChangeset);
	let placeholder = 0;
	let last = "";
	for (let i = 0; i < staged.length; i += size) {
		const batch = staged.slice(i, i + size);
		const changes: Change[] = batch.map((row) => {
			const head = row.osmId ? current.get(row.osmId) : undefined;
			return head
				? { kind: "modify", element: head, ops: row.ops, closure: row.type === "closure" }
				: { kind: "create", placeholder: --placeholder, lat: row.lat, lon: row.lon, ops: row.ops };
		});
		const objects = objectsLabel(changes);
		const tags: Record<string, string> = {
			comment: clip(v.comment),
			source: sourceTag(db, v.source, batch),
			...(account.osmHashtag ? { hashtags: clip(hashtagTag(account.osmHashtag)) } : {}),
		};

		let id: string | null = null;
		try {
			id = await createChangeset(token, tags);
			await uploadChange(token, id, osmChange(changes, id, CREATED_BY));
		} catch (e) {
			const moved = e instanceof OsmError && e.status === 409 && /mismatch/i.test(e.message);
			if (moved) {
				const reread = await fetchElements(
					token,
					batch.flatMap((r) => (r.osmId ? [r.osmId] : [])),
				).catch(() => new Map<string, OsmElement>());
				for (const row of batch) {
					const head = row.osmId ? reread.get(row.osmId) : undefined;
					if (head && head.version > row.base) {
						markConflict(db, row, head);
						return conflictOf(row, head, id ?? "—", staged.length);
					}
				}
			}
			const text = errorText(e);
			failChangeset(db, userId, {
				comment: v.comment,
				objects,
				result: e instanceof OsmError && e.status ? String(e.status) : "network",
				error: text,
			});
			await notify(db, "uploadFailed", `Upload of ${objects} failed: ${text}`);
			throw new RefusedError(
				"upload failed — " +
					text +
					(last ? " Earlier batches were uploaded." : " Nothing was written."),
			);
		} finally {
			if (id) await closeChangeset(token, id);
		}

		const done = id;
		db.transaction((tx) => {
			tx.insert(t.changesets)
				.values({
					id: done,
					osmId: done,
					url: `${osm.url}/changeset/${done}`,
					uploadedAt: new Date(),
					comment: v.comment,
					objects,
					result: "ok",
					uploadedBy: userId,
				})
				.run();
			tx.update(t.decisions)
				.set({ changesetId: done })
				.where(
					inArray(
						t.decisions.candidateId,
						batch.map((r) => r.candidateId),
					),
				)
				.run();
		});
		last = done;
	}
	return { changesetId: last };
}
