import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "$lib/server/db/client";
import { runMigrations } from "$lib/server/db/migrate";
import * as t from "$lib/server/db/schema";
import { shippedExtractor } from "./extractor";
import { renamingFor } from "./mapping/files";
import { pickDue, requestRuns, runSource } from "./runner";

const DATASET = "https://www.data.gouv.fr/api/1/datasets/irve-test/";
const FILE = "https://static.data.gouv.fr/irve-20260901.csv";

const HEADER =
	"id_station_itinerance,id_pdc_itinerance,nom_station,nom_operateur,adresse_station,consolidated_longitude,consolidated_latitude,consolidated_is_lon_lat_correct,nbre_pdc,puissance_nominale,prise_type_2,gratuit,horaires";
const row = (station: string, pdc: string, lon: number, lat: number, extra = "") =>
	`${station},${pdc},Station ${station},Operateur,1 rue ${station},${lon},${lat},true,1,22,true,true,24/7${extra}`;

let csv = "";
let osm: { elements: unknown[] } = { elements: [] };
let fileStatus = 200;
let addresses: Record<string, unknown> = {};
const calls: string[] = [];

function fakeFetch(input: string | URL | Request) {
	const url = String(input);
	calls.push(url);
	if (url === DATASET)
		return Response.json({
			license: "lov2",
			resources: [
				{ format: "parquet", url: "https://static.data.gouv.fr/x.parquet" },
				{ format: "csv", url: FILE, title: "consolidation", last_modified: "2026-09-01" },
			],
		});
	if (url === FILE)
		return new Response(fileStatus === 200 ? csv : "boom", {
			status: fileStatus,
			statusText: "Err",
		});
	if (url.includes("overpass")) return Response.json(osm);
	if (url.includes("api-adresse")) {
		const hit = addresses[new URL(url).searchParams.get("q") ?? ""];
		return Response.json({ features: hit ? [hit] : [] });
	}
	return new Response("not found", { status: 404, statusText: "Not Found" });
}

let dir: string;
let db: Db;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-pipeline-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (u: string | URL | Request) => fakeFetch(u)),
	);
	calls.length = 0;
	fileStatus = 200;
	addresses = {};

	db.insert(t.areas)
		.values({
			id: "lyo",
			name: "Lyon",
			def: "relation",
			rel: "120965",
			bbox: [45.7, 4.77, 45.81, 4.9],
			centerLat: 45.76,
			centerLon: 4.83,
			sqkm: 48,
		})
		.run();
	db.insert(t.sources)
		.values({
			id: "irve",
			name: "IRVE",
			kind: "registry",
			health: "ok",
			floor: 0.5,
			endpoint: DATASET,
			matching: "amenity=charging_station",
			preset: "irve",
		})
		.run();
	db.insert(t.areaSources).values({ areaId: "lyo", sourceId: "irve" }).run();

	csv = [
		HEADER,
		row("FRS1", "FR*S1*E1", 4.83, 45.76),
		row("FRS2", "FR*S2*E1", 4.84, 45.77),
		row("FRFAR", "FR*F*E1", 2.35, 48.85),
	].join("\n");
	osm = {
		elements: [
			{
				type: "node",
				id: 100,
				lat: 45.76,
				lon: 4.83,
				version: 5,
				user: "alice",
				tags: { amenity: "charging_station", "ref:EU:EVSE": "FR*S1*E1" },
			},
		],
	};
});

afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(dir, { recursive: true, force: true });
});

/** Seconds are the column's resolution, so a second run in the same test second needs its predecessors aged. */
const age = () =>
	db
		.update(t.candidates)
		.set({ seenAt: new Date(Date.now() - 60_000) })
		.run();
const source = () => db.select().from(t.sources).where(eq(t.sources.id, "irve")).get();
const cands = () => db.select().from(t.candidates).all();

describe("runSource (registry)", () => {
	it("reads the dataset through its API, keeps what is inside the area and matches OSM", async () => {
		await runSource(db, "irve");

		const run = db.select().from(t.runs).get();
		expect(run).toMatchObject({ result: "ok", fetched: 3, cands: 2, errors: 0 });

		const all = cands();
		expect(all.map((c) => c.sourceRecordKey).sort()).toEqual(["FRS1", "FRS2"]);
		const updated = all.find((c) => c.sourceRecordKey === "FRS1");
		const created = all.find((c) => c.sourceRecordKey === "FRS2");
		expect(updated).toMatchObject({
			type: "update",
			osmId: "node/100",
			version: 5,
			baseVersion: 5,
		});
		expect(created).toMatchObject({ type: "new", osmId: null, version: 0, baseVersion: null });
		expect(updated?.contentHash).toBeTruthy();

		const tags = db
			.select()
			.from(t.tags)
			.where(eq(t.tags.candidateId, updated?.id as string))
			.all();
		expect(tags.map((x) => x.k)).not.toContain("ref:EU:EVSE");
		expect(tags.find((x) => x.k === "capacity")).toMatchObject({ op: "add", v: "1" });
		const ev = db.select().from(t.evidence).all();
		expect(ev.length).toBeGreaterThan(0);
		expect(ev[0].url).toMatch(/^https:\/\/static\.data\.gouv\.fr\/irve-20260901\.csv#FRS/);
		expect(ev[0].kind).toContain("Licence Ouverte 2.0");

		expect(source()).toMatchObject({
			health: "ok",
			failing: false,
			licence: "Licence Ouverte 2.0",
			runningSince: null,
		});
		expect(source()?.nextRunAt?.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
		expect(db.select().from(t.areas).get()?.lastRunAt).not.toBeNull();
	});

	it("writes no site counts onto one part of a station mapped as several objects", async () => {
		osm.elements.push({
			type: "node",
			id: 101,
			lat: 45.76005,
			lon: 4.83,
			version: 1,
			tags: { amenity: "charging_station" },
		});
		await runSource(db, "irve");

		const split = cands().find((c) => c.sourceRecordKey === "FRS1");
		const keys = db
			.select()
			.from(t.tags)
			.where(eq(t.tags.candidateId, split?.id as string))
			.all()
			.map((x) => x.k);
		expect(keys.filter((k) => k === "capacity" || k.startsWith("socket:"))).toEqual([]);
		expect(split?.warning).toContain("Capacity and sockets are left out");
	});

	it("writes no station's counts onto an object several records matched, and names the other", async () => {
		csv = [
			HEADER,
			row("FRS1", "FR*S1*E1", 4.83, 45.76),
			row("FRS3", "FR*S3*E1", 4.8302, 45.76),
		].join("\n");
		(osm.elements[0] as { tags: Record<string, string> }).tags["ref:EU:EVSE"] = "FR*S1*E1;FR*S3*E1";
		await runSource(db, "irve");

		const one = cands().find((c) => c.sourceRecordKey === "FRS1");
		const keys = db
			.select()
			.from(t.tags)
			.where(eq(t.tags.candidateId, one?.id as string))
			.all()
			.map((x) => x.k);
		expect(keys).not.toContain("capacity");
		expect(keys.filter((k) => k.startsWith("socket:") && !k.endsWith(":output"))).toEqual([]);
		expect(one?.warning).toContain("several records were matched to this object");
		expect(one?.warning).toContain("Also matched by “Station FRS3” (FRS3)");
	});

	it("checks a new station against charge points without ever matching one", async () => {
		osm.elements.push({
			type: "node",
			id: 102,
			lat: 45.77,
			lon: 4.8401,
			version: 1,
			tags: { man_made: "charge_point", "ref:EU:EVSE": "FR*S2*E1" },
		});
		await runSource(db, "irve");

		const created = cands().find((c) => c.sourceRecordKey === "FRS2");
		expect(created).toMatchObject({ type: "new", osmId: null });
		expect(created?.warning).toMatch(/Possible duplicate: man_made=charge_point .*node\/102/);
	});

	it("leaves unchanged records alone and sweeps a record that left the file", async () => {
		await runSource(db, "irve");
		const before = new Map(cands().map((c) => [c.sourceRecordKey, c.id]));
		age();

		csv = [HEADER, row("FRS1", "FR*S1*E1", 4.83, 45.76)].join("\n");
		await runSource(db, "irve");

		const after = cands();
		expect(after.map((c) => c.sourceRecordKey)).toEqual(["FRS1"]);
		expect(after[0].id).toBe(before.get("FRS1"));
	});

	it("sweeps nothing when the whole dataset comes back empty, and says so", async () => {
		await runSource(db, "irve");
		age();
		csv = HEADER;
		await runSource(db, "irve");
		expect(
			cands()
				.map((c) => c.sourceRecordKey)
				.sort(),
		).toEqual(["FRS1", "FRS2"]);
		expect(db.select().from(t.runs).all().at(-1)?.message).toBe(
			"the source returned no rows, so nothing was swept",
		);
	});

	it("refreshes an undecided candidate when the mapping changes but the data does not", async () => {
		await runSource(db, "irve");
		const irve = shippedExtractor(renamingFor("fr/irve"));
		const extract = irve.extract.bind(irve);
		const spy = vi.spyOn(irve, "extract").mockImplementation((rows, url) => {
			const x = extract(rows, url);
			return x && { ...x, tags: x.tags.filter((tag) => tag.k !== "opening_hours") };
		});
		try {
			await runSource(db, "irve");
		} finally {
			spy.mockRestore();
		}
		const c = cands().find((x) => x.sourceRecordKey === "FRS1");
		const keys = db
			.select({ k: t.tags.k })
			.from(t.tags)
			.where(eq(t.tags.candidateId, c?.id ?? ""))
			.all()
			.map((r) => r.k);
		expect(keys).not.toContain("opening_hours");
	});

	it("refreshes an undecided candidate when only how it applies to OSM changes", async () => {
		await runSource(db, "irve");
		const stale = () => cands().find((x) => x.sourceRecordKey === "FRS1");
		const proposal = stale()?.contentHash?.split(":")[0];
		db.update(t.candidates)
			.set({ contentHash: `${proposal}:older-matching` })
			.where(eq(t.candidates.id, stale()?.id as string))
			.run();
		await runSource(db, "irve");
		expect(stale()?.contentHash).not.toBe(`${proposal}:older-matching`);

		db.update(t.candidates)
			.set({ contentHash: `${proposal}:older-matching` })
			.where(eq(t.candidates.id, stale()?.id as string))
			.run();
		(osm.elements[0] as { version: number }).version = 6;
		await runSource(db, "irve");
		expect(stale()).toMatchObject({ contentHash: `${proposal}:older-matching`, headVersion: 6 });
	});

	it("never sweeps or rewrites a candidate a reviewer has decided", async () => {
		await runSource(db, "irve");
		age();
		const gone = cands().find((c) => c.sourceRecordKey === "FRS2");
		db.insert(t.users)
			.values({ id: "u1", name: "R", email: "r@x.test", role: "reviewer", initials: "R" })
			.run();
		db.insert(t.decisions)
			.values({
				candidateId: gone?.id as string,
				kind: "rejected",
				userId: "u1",
				decidedAt: new Date(),
			})
			.run();

		csv = [HEADER, row("FRS1", "FR*S1*E1", 4.83, 45.76)].join("\n");
		await runSource(db, "irve");
		expect(
			cands()
				.map((c) => c.sourceRecordKey)
				.sort(),
		).toEqual(["FRS1", "FRS2"]);
	});

	it("leaves alone a candidate a reviewer decided while the run was matching", async () => {
		await runSource(db, "irve");
		const before = cands().find((c) => c.sourceRecordKey === "FRS2");
		db.insert(t.users)
			.values({ id: "u1", name: "R", email: "r@x.test", role: "reviewer", initials: "R" })
			.run();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string | URL | Request) => {
				if (String(u).includes("overpass"))
					db.insert(t.decisions)
						.values({
							candidateId: before?.id as string,
							kind: "accepted",
							userId: "u1",
							decidedAt: new Date(),
						})
						.onConflictDoNothing()
						.run();
				return fakeFetch(u);
			}),
		);
		osm.elements.push({
			type: "node",
			id: 200,
			lat: 45.77,
			lon: 4.84,
			version: 3,
			tags: { amenity: "charging_station", "ref:EU:EVSE": "FR*S2*E1" },
		});
		await runSource(db, "irve");
		expect(cands().find((c) => c.sourceRecordKey === "FRS2")).toMatchObject({
			type: "new",
			osmId: null,
			baseVersion: null,
		});
	});

	it("flags a queued candidate whose OSM object moved on", async () => {
		await runSource(db, "irve");
		const el = osm.elements[0] as { version: number; tags: Record<string, string> };
		el.version = 7;
		el.tags.operator = "Someone";
		await runSource(db, "irve");

		const c = cands().find((x) => x.sourceRecordKey === "FRS1");
		expect(c).toMatchObject({ headVersion: 7, conflictWho: "alice", baseVersion: 5 });
		const side = db.select().from(t.candidateConflictTags).all();
		expect(side.some((r) => r.side === "ours")).toBe(true);
	});

	it("flags rather than recomputes a candidate whose object moved on with a key its warning quotes", async () => {
		const el = osm.elements[0] as { version: number; tags: Record<string, string> };
		el.tags.fee = "yes";
		await runSource(db, "irve");
		const before = cands().find((x) => x.sourceRecordKey === "FRS1");
		expect(before?.warning).toContain("fee=yes");

		el.version = 7;
		el.tags.fee = "donation";
		await runSource(db, "irve");
		const c = cands().find((x) => x.sourceRecordKey === "FRS1");
		expect(c).toMatchObject({
			headVersion: 7,
			baseVersion: 5,
			warning: before?.warning,
			contentHash: before?.contentHash,
		});
	});

	it("moves a station to its own address, and drops one that lands outside the area", async () => {
		const at = (q: string, lon: number, lat: number) => {
			addresses[q] = {
				geometry: { coordinates: [lon, lat] },
				properties: { label: q, name: q, postcode: "", city: "", score: 0.95, type: "housenumber" },
			};
		};
		at("2 rue Proche", 4.8355, 45.762);
		at("3 rue Lointaine", 2.35, 48.85);
		csv = [
			HEADER,
			"FRNEAR,FR*N*E1,Station N,Operateur,2 rue Proche,4.83,45.76,true,1,22,true,true,24/7",
			"FRAWAY,FR*A*E1,Station A,Operateur,3 rue Lointaine,4.84,45.77,true,1,22,true,true,24/7",
		].join("\n");
		await runSource(db, "irve");

		const all = cands();
		expect(all.map((c) => c.sourceRecordKey)).toEqual(["FRNEAR"]);
		expect(all[0]).toMatchObject({ lat: 45.762, lon: 4.8355 });
		expect(all[0].warning).toMatch(/^Moved \d+ m to its address, 2 rue Proche/m);
		expect(db.select().from(t.runs).get()?.message).toBe(
			"1 record placed outside the area by its own address",
		);
	});

	it("counts and lists a match left with nothing to write, far from where the record is", async () => {
		osm = {
			elements: [
				{ type: "node", id: 100, lat: 45.77, lon: 4.83, tags: { "ref:EU:EVSE": "FR*S1*E1" } },
			],
		};
		await runSource(db, "irve");
		expect(cands().map((c) => c.sourceRecordKey)).toEqual(["FRS2"]);
		expect(db.select().from(t.runs).get()?.message).toBe(
			"1 match far from its address left out: the place may have moved or its id may be stale",
		);
		expect(source()?.syncState?.farFromAddress).toEqual([
			{ area: "lyo", record: "FRS1", object: "node/100", metres: 1112 },
		]);
	});

	it("re-reads an unchanged dataset for a newly linked area or an explicit request", async () => {
		const conditional: boolean[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
				if (String(u) !== FILE) return fakeFetch(u);
				const tag = new Headers(init?.headers).get("if-none-match");
				conditional.push(!!tag);
				if (tag === '"v1"') return new Response(null, { status: 304 });
				return new Response(csv, { headers: { etag: '"v1"' } });
			}),
		);
		const lastMessage = () =>
			db
				.select()
				.from(t.runs)
				.all()
				.map((r) => r.message)
				.at(-1);

		await runSource(db, "irve");
		await runSource(db, "irve");
		expect(lastMessage()).toBe("dataset unchanged");

		db.insert(t.areas)
			.values({
				id: "par",
				name: "Paris",
				def: "relation",
				rel: "7444",
				bbox: [48.8, 2.3, 48.9, 2.4],
				centerLat: 48.85,
				centerLon: 2.35,
				sqkm: 105,
				lastRunAt: new Date(Date.now() - 3_600_000),
			})
			.run();
		db.insert(t.areaSources).values({ areaId: "par", sourceId: "irve" }).run();
		await runSource(db, "irve");
		expect(cands().map((c) => `${c.areaId}:${c.sourceRecordKey}`)).toContain("par:FRFAR");

		db.update(t.sources).set({ runRequestedAt: new Date() }).where(eq(t.sources.id, "irve")).run();
		await runSource(db, "irve");
		expect(conditional).toEqual([false, true, false, false]);
	});

	it("hands a record that moved to another area over to it in the same run, whichever area runs first", async () => {
		db.insert(t.areas)
			.values({
				id: "par",
				name: "Paris",
				def: "relation",
				rel: "7444",
				bbox: [48.8, 2.3, 48.9, 2.4],
				centerLat: 48.85,
				centerLon: 2.35,
				sqkm: 105,
			})
			.run();
		db.insert(t.areaSources).values({ areaId: "par", sourceId: "irve" }).run();
		csv += `\n${row("FRDONE", "FR*D*E1", 2.34, 48.84)}`;
		await runSource(db, "irve");
		const placed = () =>
			Object.fromEntries(cands().map((c) => [c.sourceRecordKey, c.areaId as string]));
		expect(placed()).toEqual({ FRS1: "lyo", FRS2: "lyo", FRFAR: "par", FRDONE: "par" });
		const ids = new Map(cands().map((c) => [c.sourceRecordKey, c.id]));
		db.insert(t.users)
			.values({ id: "u1", name: "R", email: "r@x.test", role: "reviewer", initials: "R" })
			.run();
		db.insert(t.decisions)
			.values({
				candidateId: ids.get("FRDONE") as string,
				kind: "rejected",
				userId: "u1",
				decidedAt: new Date(),
			})
			.run();
		age();

		csv = [
			HEADER,
			row("FRS1", "FR*S1*E1", 4.83, 45.76),
			row("FRS2", "FR*S2*E1", 2.36, 48.86),
			row("FRFAR", "FR*F*E1", 4.85, 45.78),
			row("FRDONE", "FR*D*E1", 4.86, 45.79),
		].join("\n");
		await runSource(db, "irve");
		expect(placed()).toEqual({ FRS1: "lyo", FRS2: "par", FRFAR: "lyo", FRDONE: "par" });
		expect(cands().find((c) => c.sourceRecordKey === "FRS1")?.id).toBe(ids.get("FRS1"));
	});

	it("writes a failed run, retries soon, and holds the source after three in a row", async () => {
		fileStatus = 500;
		await runSource(db, "irve");
		expect(db.select().from(t.runs).get()).toMatchObject({ result: "failed", cands: 0 });
		expect(source()).toMatchObject({ health: "error", failing: false });
		expect(source()?.nextRunAt?.getTime()).toBeLessThan(Date.now() + 2 * 3_600_000);
		expect(cands()).toHaveLength(0);

		await runSource(db, "irve");
		await runSource(db, "irve");
		expect(source()?.failing).toBe(true);
		expect(pickDue(db)).toBeNull();
	});

	it("fails with a clear message when no shipped source has the columns", async () => {
		db.update(t.sources).set({ preset: null }).where(eq(t.sources.id, "irve")).run();
		csv = "x,y\n1,2";
		await runSource(db, "irve");
		const run = db.select().from(t.runs).get();
		expect(run?.result).toBe("failed");
		expect(run?.message).toMatch(/no shipped source has these fields/);
	});

	it("fails a model source that has no model configured", async () => {
		db.update(t.sources).set({ extractor: "model" }).where(eq(t.sources.id, "irve")).run();
		await runSource(db, "irve");
		expect(db.select().from(t.runs).get()?.message).toMatch(/no model configured/);
	});

	it("does not start a second run while one holds the claim", async () => {
		db.update(t.sources).set({ runningSince: new Date() }).where(eq(t.sources.id, "irve")).run();
		await runSource(db, "irve");
		expect(db.select().from(t.runs).all()).toHaveLength(0);
	});
});

describe("scheduling", () => {
	it("picks an enabled source with no next run, but not a disabled one or one in the future", () => {
		expect(pickDue(db)).toBe("irve");
		db.update(t.sources)
			.set({ nextRunAt: new Date(Date.now() + 3_600_000) })
			.run();
		expect(pickDue(db)).toBeNull();
		db.update(t.sources).set({ nextRunAt: null, enabled: false }).run();
		expect(pickDue(db)).toBeNull();
	});

	it("an explicit request wins over everything but a live claim", () => {
		db.update(t.sources)
			.set({ enabled: false, nextRunAt: new Date(Date.now() + 9e8) })
			.run();
		db.update(t.sources).set({ runRequestedAt: new Date() }).run();
		expect(pickDue(db)).toBe("irve");
		db.update(t.sources).set({ runningSince: new Date() }).run();
		expect(pickDue(db)).toBeNull();
		expect(requestRuns(db, ["irve"])).toBe(0);
	});
});
