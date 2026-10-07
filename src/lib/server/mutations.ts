import { and, eq } from "drizzle-orm";
import type { AreaDraft } from "$lib/schemas/area";
import type { SourceDraft } from "$lib/schemas/source";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { fetchElements } from "$lib/server/osm/api";
import type { OsmElement } from "$lib/server/osm/osmchange";
import { unchangedTags } from "$lib/server/pipeline/match/ops";
import { RefusedError } from "$lib/server/review";
import { renameRefusal } from "$lib/server/source-display";

/** Every write below runs either directly or inside a transaction. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Writer = Db | Tx;

function setLink(db: Writer, areaId: string, sourceId: string, on: boolean) {
	if (on) db.insert(t.areaSources).values({ areaId, sourceId }).onConflictDoNothing().run();
	else
		db.delete(t.areaSources)
			.where(and(eq(t.areaSources.areaId, areaId), eq(t.areaSources.sourceId, sourceId)))
			.run();
}

function nextId(db: Writer, table: typeof t.sources | typeof t.areas, prefix: string): string {
	const taken = new Set(
		db
			.select({ id: table.id })
			.from(table)
			.all()
			.map((r) => r.id),
	);
	let n = taken.size + 1;
	while (taken.has(prefix + n)) n += 1;
	return prefix + n;
}

export function applySourceDraft(db: Db, d: SourceDraft): string {
	const allow = d.allow.map((x) => x.trim()).filter(Boolean);
	const fields = {
		name: d.name,
		kind: d.kind,
		floor: d.floor,
		endpoint: d.endpoint,
		schedule: d.schedule,
		matching: d.matching.trim(),
		budget: d.budget.trim(),
		extractor: d.extractor,
		preset: d.extractor === "model" ? null : d.preset,
	};
	const key = d.key.trim();

	return db.transaction((tx) => {
		const id = d.editId ?? nextId(tx, t.sources, "src");

		if (d.editId) {
			// A blank key keeps the saved one: the form never receives it back.
			tx.update(t.sources)
				.set(key ? { ...fields, apiKey: key } : fields)
				.where(eq(t.sources.id, d.editId))
				.run();
		} else {
			tx.insert(t.sources)
				.values({
					...fields,
					id,
					apiKey: key || null,
					health: "ok",
					failing: false,
					enabled: true,
					runRequestedAt: new Date(),
				})
				.run();
		}

		tx.delete(t.sourceAllowedTags).where(eq(t.sourceAllowedTags.sourceId, id)).run();
		if (allow.length > 0) {
			tx.insert(t.sourceAllowedTags)
				.values(allow.map((pattern, position) => ({ sourceId: id, position, pattern })))
				.run();
		}
		for (const [areaId, on] of Object.entries(d.areas)) setLink(tx, areaId, id, on);
		return id;
	});
}

export function applyAreaDraft(db: Db, d: AreaDraft): string {
	const sqkm = (Math.PI * d.radius * d.radius) / 1e6;

	return db.transaction((tx) => {
		const id = d.editId ?? nextId(tx, t.areas, "a");
		const shape =
			d.mode === "radius"
				? {
						def: "radius" as const,
						rel: null,
						displayName: null,
						bbox: null,
						centerLat: d.center[0],
						centerLon: d.center[1],
						km: null,
						radius: d.radius,
						sqkm,
					}
				: {
						def: "relation" as const,
						rel: d.picked?.rel ?? null,
						displayName: d.picked?.displayName ?? null,
						bbox: d.picked?.bbox ?? null,
						centerLat: d.picked?.center[0] ?? d.center[0],
						centerLon: d.picked?.center[1] ?? d.center[1],
						km: d.picked?.km ?? null,
						radius: null,
						sqkm: d.picked?.sqkm ?? sqkm,
					};

		if (d.editId) {
			const prev = tx.select().from(t.areas).where(eq(t.areas.id, d.editId)).all()[0];
			tx.update(t.areas)
				.set({
					...shape,
					name: d.name || prev?.name || "New area",
					level: d.mode === "relation" ? (d.picked?.level ?? prev?.level ?? null) : null,
				})
				.where(eq(t.areas.id, d.editId))
				.run();
		} else {
			tx.insert(t.areas)
				.values({
					...shape,
					id,
					name: d.name || d.picked?.name || "New area",
					level: d.mode === "relation" ? (d.picked?.level ?? null) : null,
				})
				.run();
		}

		for (const [sourceId, on] of Object.entries(d.srcs)) setLink(tx, id, sourceId, on);
		return id;
	});
}

/**
 * "Rename again": the source's next run asks the model for its column renaming where the
 * shipped one does not cover the columns, and keeps asking until one passes its checks.
 * Answers why not when no run could honour it, and sets nothing then.
 */
export function requestRename(db: Db, id: string, modelConfigured: boolean): string | null {
	const source = db.select().from(t.sources).where(eq(t.sources.id, id)).get();
	if (!source) return "This source does not exist.";
	const refusal = renameRefusal(source, modelConfigured);
	if (refusal) return refusal.reason;
	db.update(t.sources).set({ renameRequestedAt: new Date() }).where(eq(t.sources.id, id)).run();
	return null;
}

export function setSourceEnabled(db: Db, id: string, enabled: boolean) {
	db.update(t.sources).set({ enabled }).where(eq(t.sources.id, id)).run();
}

export function setAreaPaused(db: Db, id: string, paused: boolean) {
	db.update(t.areas).set({ paused }).where(eq(t.areas.id, id)).run();
}

export function removeArea(db: Db, id: string) {
	db.delete(t.areas).where(eq(t.areas.id, id)).run();
}

type Write = { op: "add" | "mod" | "del"; k: string; v: string; was: string | null };

/** A write as it stands against the object's tags today, or nothing where they already say it. */
function against<T extends Write>(rows: T[], tags: Record<string, string>): T[] {
	return rows.flatMap((r) => {
		const cur = tags[r.k];
		if (r.op === "del") return cur === undefined ? [] : [{ ...r, v: cur }];
		if (cur === r.v) return [];
		return [
			{ ...r, op: cur === undefined ? ("add" as const) : ("mod" as const), was: cur ?? null },
		];
	});
}

const readHead = async (ref: string) => (await fetchElements("", [ref])).get(ref);

/**
 * Resolving a conflict reads every proposed write again against the object as it is now:
 * what the other mapper already wrote is dropped, an add over a value they set becomes a
 * mod that shows it, and the rest of the object's tags are today's. A staged decision is
 * read again the same way. A candidate left with nothing to write is gone, as it would
 * never have been queued.
 */
export async function rebase(db: Db, candidateId: string, read = readHead) {
	const conflicted = () => {
		const c = db.select().from(t.candidates).where(eq(t.candidates.id, candidateId)).all()[0];
		if (!c || c.headVersion === null || !c.osmId)
			throw new RefusedError("no version conflict to rebase.");
		return { ...c, osmId: c.osmId };
	};
	const { osmId } = conflicted();
	let head: OsmElement | undefined;
	try {
		head = await read(osmId);
	} catch (e) {
		throw new RefusedError(
			`could not read ${osmId} from OSM — ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (!head) throw new RefusedError(`${osmId} no longer exists on OSM — reject its candidate.`);
	const { tags, version } = head;

	db.transaction((tx) => {
		conflicted();
		const proposed = tx.select().from(t.tags).where(eq(t.tags.candidateId, candidateId)).all();
		const kept = against(proposed, tags);
		const keptKeys = new Set(kept.map((p) => p.k));
		const decision = tx
			.select()
			.from(t.decisions)
			.where(and(eq(t.decisions.candidateId, candidateId), t.STAGED))
			.all()[0];
		const decided = decision
			? tx.select().from(t.decisionTags).where(eq(t.decisionTags.candidateId, candidateId)).all()
			: [];
		const stillDecided = against(decided, tags);

		if (decision && !stillDecided.length)
			tx.delete(t.decisions).where(eq(t.decisions.candidateId, candidateId)).run();
		if (!kept.length && !stillDecided.length) {
			tx.delete(t.candidates).where(eq(t.candidates.id, candidateId)).run();
			return;
		}

		for (const p of proposed) {
			const now = kept.find((x) => x.id === p.id);
			if (!now) tx.delete(t.tags).where(eq(t.tags.id, p.id)).run();
			else
				tx.update(t.tags)
					.set({
						op: now.op,
						v: now.v,
						was: now.was,
						// A move whose other half the mapper already made is a plain write now.
						pair: now.pair && keptKeys.has(now.pair) ? now.pair : null,
					})
					.where(eq(t.tags.id, p.id))
					.run();
		}
		for (const d of decided) {
			const where = and(eq(t.decisionTags.candidateId, candidateId), eq(t.decisionTags.k, d.k));
			const now = stillDecided.find((x) => x.k === d.k);
			if (!now) tx.delete(t.decisionTags).where(where).run();
			else tx.update(t.decisionTags).set({ op: now.op, v: now.v, was: now.was }).where(where).run();
		}
		tx.delete(t.candidateConflictTags)
			.where(eq(t.candidateConflictTags.candidateId, candidateId))
			.run();
		tx.update(t.candidates)
			.set({
				baseVersion: version,
				version,
				headVersion: null,
				conflictWho: null,
				unchangedTags: unchangedTags(tags, keptKeys),
			})
			.where(eq(t.candidates.id, candidateId))
			.run();
	});
}
