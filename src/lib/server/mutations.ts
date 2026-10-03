import { and, eq, sql } from "drizzle-orm";
import type { AreaDraft } from "$lib/schemas/area";
import type { SourceDraft } from "$lib/schemas/source";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";

/** Every write below runs either directly or inside a transaction. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Writer = Db | Tx;

function syncAreaLinks(db: Writer, sourceId: string, wanted: Record<string, boolean>) {
	for (const [areaId, on] of Object.entries(wanted)) {
		if (on) {
			db.insert(t.areaSources).values({ areaId, sourceId }).onConflictDoNothing().run();
		} else {
			db.delete(t.areaSources)
				.where(and(eq(t.areaSources.areaId, areaId), eq(t.areaSources.sourceId, sourceId)))
				.run();
		}
	}
}

function nextId(db: Writer, table: "sources" | "areas", prefix: string): string {
	const rows =
		table === "sources"
			? db.select({ id: t.sources.id }).from(t.sources).all()
			: db.select({ id: t.areas.id }).from(t.areas).all();
	const taken = new Set(rows.map((r) => r.id));
	let n = rows.length + 1;
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
		const id = d.editId ?? nextId(tx, "sources", "src");

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
		syncAreaLinks(tx, id, d.areas);
		return id;
	});
}

export function applyAreaDraft(db: Db, d: AreaDraft): string {
	const sqkm = (Math.PI * d.radius * d.radius) / 1e6;

	return db.transaction((tx) => {
		const id = d.editId ?? nextId(tx, "areas", "a");
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
						displayName: d.picked?.name ?? null,
						bbox: null,
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
					level: d.mode === "relation" ? (prev?.level ?? 8) : null,
				})
				.where(eq(t.areas.id, d.editId))
				.run();
		} else {
			tx.insert(t.areas)
				.values({
					...shape,
					id,
					name: d.name || d.picked?.name || "New area",
					level: d.mode === "relation" ? 8 : null,
				})
				.run();
		}

		for (const [sourceId, on] of Object.entries(d.srcs)) {
			if (on) {
				tx.insert(t.areaSources).values({ areaId: id, sourceId }).onConflictDoNothing().run();
			} else {
				tx.delete(t.areaSources)
					.where(and(eq(t.areaSources.areaId, id), eq(t.areaSources.sourceId, sourceId)))
					.run();
			}
		}
		return id;
	});
}

export function setSourceEnabled(db: Db, id: string, enabled: boolean) {
	db.update(t.sources).set({ enabled }).where(eq(t.sources.id, id)).run();
}

export function setSourceFloor(db: Db, id: string, floor: number) {
	db.update(t.sources).set({ floor }).where(eq(t.sources.id, id)).run();
}

export function setLink(db: Db, sourceId: string, areaId: string, on: boolean) {
	syncAreaLinks(db, sourceId, { [areaId]: on });
}

export function setAreaPaused(db: Db, id: string, paused: boolean) {
	db.update(t.areas).set({ paused }).where(eq(t.areas.id, id)).run();
}

export function setAreaRadius(db: Db, id: string, radius: number) {
	const sqkm = (Math.PI * radius * radius) / 1e6;
	db.update(t.areas)
		.set({ radius, sqkm })
		.where(and(eq(t.areas.id, id), eq(t.areas.def, "radius")))
		.run();
}

export function removeArea(db: Db, id: string) {
	db.delete(t.areas).where(eq(t.areas.id, id)).run();
}

/**
 * Taking the upstream version as the new base is what resolving a conflict means:
 * `headVersion` back to null is the schema's own definition of "no conflict".
 * `conflictWho` stays, because the upload still has to know this object moved
 * once — that is what the 409 retry hangs off.
 */
export function rebase(db: Db, candidateId: string) {
	db.update(t.candidates)
		.set({
			baseVersion: sql`${t.candidates.headVersion}`,
			version: sql`${t.candidates.headVersion}`,
			headVersion: null,
		})
		.where(eq(t.candidates.id, candidateId))
		.run();
}
