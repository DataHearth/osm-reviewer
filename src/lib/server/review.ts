import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { batches, OSM_MAX, sourceLabel, sourceTag } from "$lib/changeset";
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
	if (decided) throw new RefusedError(`already ${decided.kind}.`);
	return c;
}

export interface Proposal {
	id: number;
	position: number;
	op: "add" | "mod" | "del";
	k: string;
	v: string;
	was: string | null;
	ev: boolean;
	invalid: boolean;
	group: string | null;
	pair: string | null;
}

/** What the review screen posts: proposals taken as they are, by position, and the reviewer's own writes. */
export interface Picks {
	tags: number[];
	/** `key=value`, split on the first `=`. */
	set: string[];
	del: string[];
}

export interface DecisionOp {
	tagId: number | null;
	op: "add" | "mod" | "del";
	k: string;
	v: string;
	was: string | null;
}

/**
 * The ops an accept writes. A reviewer's write says only what the key should end up as;
 * whether that is an add or a mod, and what it replaces, is read off the object's tags as
 * they were matched, so a client cannot post an op that disagrees with the object.
 */
export function decisionOps(
	proposals: Proposal[],
	unchanged: { k: string; v: string }[],
	picks: Picks,
): DecisionOp[] {
	const current = new Map(unchanged.map((x) => [x.k, x.v]));
	for (const p of proposals) {
		if (p.op === "del") current.set(p.k, p.v);
		else if (p.op === "mod" && p.was !== null) current.set(p.k, p.was);
	}
	const fromProposal = (k: string) => proposals.find((p) => p.k === k)?.id ?? null;

	const out: DecisionOp[] = [];
	const push = (o: DecisionOp) => {
		if (out.some((x) => x.k === o.k)) throw new RefusedError(`${o.k} is written twice.`);
		out.push(o);
	};

	for (const position of new Set(picks.tags)) {
		const p = proposals.find((x) => x.position === position);
		if (!p) throw new RefusedError("no such tag.");
		if (p.invalid) throw new RefusedError(`accept blocked — ${p.k} fails validation.`);
		if (!p.ev) throw new RefusedError("accept blocked — an unevidenced tag cannot be written.");
		push({ tagId: p.id, op: p.op, k: p.k, v: p.v, was: p.was });
	}
	for (const s of picks.set) {
		const i = s.indexOf("=");
		const k = s.slice(0, i).trim();
		const v = s.slice(i + 1).trim();
		if (i < 0 || !k) throw new RefusedError("a tag needs a key.");
		if (!v) throw new RefusedError(`${k} needs a value — delete it instead.`);
		if (k.length > OSM_MAX || v.length > OSM_MAX)
			throw new RefusedError(`${k} is longer than OSM's ${OSM_MAX} characters.`);
		const cur = current.get(k);
		if (cur === v) throw new RefusedError(`${k} is already ${v}.`);
		push({ tagId: fromProposal(k), op: cur === undefined ? "add" : "mod", k, v, was: cur ?? null });
	}
	for (const k of picks.del) {
		const cur = current.get(k);
		if (cur === undefined) throw new RefusedError(`${k} is not on the object.`);
		push({ tagId: fromProposal(k), op: "del", k, v: cur, was: null });
	}
	if (!out.length) throw new RefusedError("nothing selected — no tags would be written.");
	refuseParts(proposals, new Map(out.map((o) => [o.k, o.op])));
	return out;
}

const groupName = (g: string) => (g === "addr" ? "the address" : `the ${g} group`);

/**
 * A move written half is a lost or doubled value, and half an address is a wrong one. A
 * proposal counts as taken whether it was picked as is, typed over, or deleted by hand.
 */
function refuseParts(proposals: Proposal[], written: Map<string, DecisionOp["op"]>) {
	for (const p of proposals) {
		if (!p.pair) continue;
		const [from, to] = p.op === "del" ? [p.k, p.pair] : [p.pair, p.k];
		if (written.has(p.k) !== written.has(p.pair))
			throw new RefusedError(`${from} moves to ${to} — accept both or neither.`);
		if (written.has(from) && written.get(from) !== "del")
			throw new RefusedError(`${from} moves to ${to} — it can only be removed, not rewritten.`);
	}
	for (const g of new Set(proposals.flatMap((p) => (p.group ? [p.group] : [])))) {
		const members = proposals.filter((p) => p.group === g);
		const taken = members.find((p) => written.has(p.k));
		const left = members.filter((p) => !written.has(p.k));
		if (taken && left.length)
			throw new RefusedError(
				`${taken.k} is part of ${groupName(g)} — accept all of it or none (left out: ${left.map((p) => p.k).join(", ")}).`,
			);
	}
}

/**
 * The same gate the review screen shows as `blockedReason`, enforced where it
 * counts: the client picks which tags to write, so the reasons a tag may not be
 * written are checked again against the rows themselves.
 */
export function accept(db: Db, userId: string, id: string, picks: Picks) {
	const c = candidateFor(db, id);
	if (c.headVersion !== null)
		throw new RefusedError(
			`accept blocked — version conflict unresolved. Rebase onto v${c.headVersion}.`,
		);

	const tags = db
		.select()
		.from(t.tags)
		.where(eq(t.tags.candidateId, id))
		.orderBy(asc(t.tags.position))
		.all();
	const evidenced = new Set(
		db
			.select({ tagId: t.evidence.tagId })
			.from(t.evidence)
			.where(
				inArray(
					t.evidence.tagId,
					tags.map((tag) => tag.id),
				),
			)
			.all()
			.map((e) => e.tagId),
	);
	const proposals = tags.map((tag) => ({ ...tag, ev: evidenced.has(tag.id) }));
	if (proposals.every((p) => !p.ev))
		throw new RefusedError("accept blocked — candidate quarantined, no tag has evidence.");

	const ops = decisionOps(proposals, c.unchangedTags, picks);
	db.transaction((tx) => {
		tx.insert(t.decisions)
			.values({ candidateId: id, kind: "accepted", userId, decidedAt: new Date() })
			.run();
		tx.insert(t.decisionTags)
			.values(ops.map((o, position) => ({ candidateId: id, position, ...o })))
			.run();
	});
}

export function reject(db: Db, userId: string, id: string) {
	candidateFor(db, id);
	db.insert(t.decisions)
		.values({ candidateId: id, kind: "rejected", userId, decidedAt: new Date() })
		.run();
}

/**
 * Two uploads reading the same staged rows would each send them, and every new POI
 * would be created twice. The app is one process on one database, so a flag suffices.
 */
let uploading = false;

/** Undo only reaches a decision the upload has not carried away. */
export function undo(db: Db, id: string) {
	if (uploading) throw new RefusedError("an upload is running — undo once it has finished.");
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
	source: string;
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
			baseVersion: t.candidates.baseVersion,
			version: t.candidates.version,
			sourceName: t.sources.name,
			licence: t.sources.licence,
		})
		.from(t.decisions)
		.innerJoin(t.candidates, eq(t.candidates.id, t.decisions.candidateId))
		.innerJoin(t.sources, eq(t.sources.id, t.candidates.sourceId))
		.where(t.STAGED)
		.orderBy(asc(t.decisions.decidedAt), asc(t.decisions.candidateId))
		.all();
	const picked = db
		.select({
			candidateId: t.decisionTags.candidateId,
			op: t.decisionTags.op,
			k: t.decisionTags.k,
			v: t.decisionTags.v,
		})
		.from(t.decisionTags)
		.where(
			inArray(
				t.decisionTags.candidateId,
				rows.map((r) => r.candidateId),
			),
		)
		.orderBy(asc(t.decisionTags.position))
		.all();
	return rows.map(({ baseVersion, version, sourceName, licence, ...r }) => ({
		...r,
		source: sourceLabel(sourceName, licence),
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

function clip(s: string) {
	const points = [...s];
	return points.length > OSM_MAX ? `${points.slice(0, OSM_MAX - 1).join("")}…` : s;
}

/** `#a;#b`, the form OSM's `hashtags` tag takes, from however the setting was typed. */
const hashtagTag = (raw: string) =>
	raw
		.split(/[\s;,]+/)
		.filter(Boolean)
		.map((h) => (h.startsWith("#") ? h : `#${h}`))
		.join(";");

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
			id: `fail-${randomUUID()}`,
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
	v: { comment: string },
): Promise<{ changesetId: string } | { conflict: UploadConflict }> {
	if (uploading) throw new RefusedError("an upload is already running — wait for it to finish.");
	uploading = true;
	try {
		return await uploadStaged(db, userId, v);
	} finally {
		uploading = false;
	}
}

async function uploadStaged(
	db: Db,
	userId: string,
	v: { comment: string },
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
		throw new RefusedError(`could not read the objects from OSM — ${errorText(e)}`);
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

	let placeholder = 0;
	let last = "";
	for (const batch of batches(staged, account.osmPerChangeset)) {
		const changes: Change[] = batch.map((row) => {
			const head = row.osmId ? current.get(row.osmId) : undefined;
			return head
				? { kind: "modify", element: head, ops: row.ops, closure: row.type === "closure" }
				: { kind: "create", placeholder: --placeholder, lat: row.lat, lon: row.lon, ops: row.ops };
		});
		const objects = objectsLabel(changes);
		const tags: Record<string, string> = {
			comment: clip(v.comment),
			source: clip(sourceTag(batch)),
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
					and(
						t.STAGED,
						inArray(
							t.decisions.candidateId,
							batch.map((r) => r.candidateId),
						),
					),
				)
				.run();
		});
		last = done;
	}
	return { changesetId: last };
}
