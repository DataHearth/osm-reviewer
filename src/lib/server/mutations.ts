import { and, eq, sql } from "drizzle-orm";
import type { AreaDraft } from "$lib/schemas/area";
import type { SourceDraft } from "$lib/schemas/source";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import type { ConfigRow } from "$lib/types";

/** Every write below runs either directly or inside a transaction. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Writer = Db | Tx;

const KIND_LABEL: Record<SourceDraft["kind"], string> = {
	registry: "national registry dump",
	crawl: "operator website crawl",
	api: "government open-data API",
};

/** Facts only a run can establish; an edit keeps whatever the saved source has. */
const RUN_ESTABLISHED = new Set(["volume", "pagination", "next run"]);

const NEW_SOURCE_METRICS: [string, string, string, string | null][] = [
	["candidates", "—", "no runs yet", null],
	["accept rate", "—", "nothing reviewed", null],
	["unevidenced", "—", "nothing reviewed", null],
	["last run", "never", "first run queued", "warn"],
	["errors", "—", "no runs yet", null],
];

function configFor(d: SourceDraft): ConfigRow[] {
	const key4 = d.key.trim().slice(-4);
	const extractor: ConfigRow =
		d.extractor === "model"
			? ["extractor", "qwen2.5-3b-instruct q4 · prompt page-extract-v7", "code"]
			: ["extractor", "deterministic field map · no model", "code"];

	if (d.kind === "registry")
		return [
			["dataset", d.endpoint + (d.fileSize ? " · " + d.fileSize : ""), "code"],
			["volume", "unknown until first run"],
			["schedule", d.schedule],
			["next run", "queued now"],
			["matching", d.matching || "—"],
			extractor,
		];

	if (d.kind === "crawl")
		return [
			["seed rule", d.endpoint, "code"],
			["budget", d.budget || "—"],
			["robots.txt", "honoured"],
			["schedule", d.schedule],
			["next run", "queued now"],
			extractor,
		];

	return [
		["endpoint", d.endpoint, "code"],
		key4 ? ["api key", "••••••••••••" + key4] : ["api key", "not set", "warn"],
		["pagination", "detected on first run"],
		["schedule", d.schedule],
		["next run", "queued now"],
		extractor,
	];
}

function writeConfig(db: Writer, sourceId: string, rows: ConfigRow[]) {
	db.delete(t.sourceConfigRows).where(eq(t.sourceConfigRows.sourceId, sourceId)).run();
	db.insert(t.sourceConfigRows)
		.values(
			rows.map(([label, value, tone], position) => ({
				sourceId,
				position,
				label,
				value,
				tone: tone ?? null,
			})),
		)
		.run();
}

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
	const fresh = configFor(d);

	return db.transaction((tx) => {
		const id = d.editId ?? nextId(tx, "sources", "src");

		if (d.editId) {
			const kept = tx
				.select()
				.from(t.sourceConfigRows)
				.where(eq(t.sourceConfigRows.sourceId, d.editId))
				.all();
			const keep = (label: string) =>
				RUN_ESTABLISHED.has(label) || (label === "api key" && !d.key.trim());
			const merged = fresh.map((row): ConfigRow => {
				if (!keep(row[0])) return row;
				const prev = kept.find((x) => x.label === row[0]);
				return prev ? [prev.label, prev.value, prev.tone ?? undefined] : row;
			});
			tx.update(t.sources)
				.set({ name: d.name, kind: d.kind, kindLabel: KIND_LABEL[d.kind], floor: d.floor })
				.where(eq(t.sources.id, d.editId))
				.run();
			writeConfig(tx, d.editId, merged);
		} else {
			tx.insert(t.sources)
				.values({
					id,
					name: d.name,
					kind: d.kind,
					kindLabel: KIND_LABEL[d.kind],
					health: "ok",
					failing: false,
					enabled: true,
					floor: d.floor,
				})
				.run();
			writeConfig(tx, id, fresh);
			tx.insert(t.sourceMetricRows)
				.values(
					NEW_SOURCE_METRICS.map(([label, value, note, tone], position) => ({
						sourceId: id,
						position,
						label,
						value,
						note,
						tone: tone as "ok" | "warn" | "bad" | null,
					})),
				)
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
	const radiusPois = Math.round(sqkm * 130).toLocaleString("en-US");

	return db.transaction((tx) => {
		const id = d.editId ?? nextId(tx, "areas", "a");
		const shape =
			d.mode === "radius"
				? {
						def: "radius" as const,
						rel: null,
						centerLat: d.center[0],
						centerLon: d.center[1],
						km: null,
						radius: d.radius,
						sqkm,
						pois: radiusPois,
					}
				: {
						def: "relation" as const,
						rel: d.picked?.rel ?? null,
						centerLat: d.picked?.center[0] ?? d.center[0],
						centerLon: d.picked?.center[1] ?? d.center[1],
						km: d.picked?.km ?? null,
						radius: null,
						sqkm: d.picked?.sqkm ?? sqkm,
						pois: d.picked?.pois ?? radiusPois,
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
					pending: 0,
					accepted30: 0,
					status: "first run queued",
					lastRun: "never",
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
	db.update(t.areas)
		.set({ status: paused ? "paused" : "active" })
		.where(eq(t.areas.id, id))
		.run();
}

export function setAreaRadius(db: Db, id: string, radius: number) {
	const sqkm = (Math.PI * radius * radius) / 1e6;
	db.update(t.areas)
		.set({ radius, sqkm, pois: Math.round(sqkm * 130).toLocaleString("en-US") })
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
