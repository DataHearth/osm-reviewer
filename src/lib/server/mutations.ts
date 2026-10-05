import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { AreaDraft } from "$lib/schemas/area";
import type { SourceDraft } from "$lib/schemas/source";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { RefusedError } from "$lib/server/review";

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

export function setSourceEnabled(db: Db, id: string, enabled: boolean) {
	db.update(t.sources).set({ enabled }).where(eq(t.sources.id, id)).run();
}

export function setAreaPaused(db: Db, id: string, paused: boolean) {
	db.update(t.areas).set({ paused }).where(eq(t.areas.id, id)).run();
}

export function removeArea(db: Db, id: string) {
	db.delete(t.areas).where(eq(t.areas.id, id)).run();
}

/**
 * Taking the upstream version as the new base is what resolving a conflict means:
 * `headVersion` back to null is the schema's own definition of "no conflict".
 */
export function rebase(db: Db, candidateId: string) {
	const rebased = db
		.update(t.candidates)
		.set({
			baseVersion: sql`${t.candidates.headVersion}`,
			version: sql`${t.candidates.headVersion}`,
			headVersion: null,
		})
		.where(and(eq(t.candidates.id, candidateId), isNotNull(t.candidates.headVersion)))
		.run();
	if (!rebased.changes) throw new RefusedError("no version conflict to rebase.");
}
