// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queueQuerySchema, queueSearch } from "$lib/schemas/queue";
import { createDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import * as t from "./db/schema";
import { loadQueue } from "./queries";

interface Fixture {
	id: string;
	type: "new" | "update" | "closure";
	name: string;
	conf: number;
	source: string;
	days: number;
	tags: { ev: boolean; invalid?: boolean }[];
	area?: string;
	headVersion?: number;
	decided?: boolean;
}

/** Each of k1–k7 carries one flag, worst last, so every sort key orders them differently. */
const FIXTURES: Fixture[] = [
	{
		id: "k1",
		type: "new",
		name: "Alpha",
		conf: 0.95,
		source: "s1",
		days: 1,
		tags: [{ ev: true }, { ev: true }],
	},
	{
		id: "k2",
		type: "closure",
		name: "bravo",
		conf: 0.7,
		source: "s2",
		days: 10,
		tags: [{ ev: true }],
	},
	{
		id: "k3",
		type: "update",
		name: "Charlie",
		conf: 0.5,
		source: "s1",
		days: 90,
		tags: [{ ev: true }],
	},
	{
		id: "k4",
		type: "update",
		name: "delta",
		conf: 0.88,
		source: "s2",
		days: 5,
		tags: [{ ev: true }, { ev: false }],
	},
	{ id: "k5", type: "new", name: "Echo", conf: 0.6, source: "s1", days: 3, tags: [{ ev: false }] },
	{
		id: "k6",
		type: "update",
		name: "Foxtrot",
		conf: 0.85,
		source: "s2",
		days: 2,
		tags: [{ ev: true, invalid: true }, { ev: true }],
	},
	{
		id: "k7",
		type: "closure",
		name: "golf",
		conf: 0.3,
		source: "s1",
		days: 4,
		headVersion: 3,
		tags: [{ ev: true }],
	},
	{
		id: "k8",
		type: "closure",
		name: "Hotel",
		conf: 0.99,
		source: "s1",
		days: 1,
		area: "b",
		tags: [{ ev: true }],
	},
	{
		id: "k9",
		type: "new",
		name: "India",
		conf: 0.97,
		source: "s1",
		days: 1,
		decided: true,
		tags: [{ ev: true }],
	},
];

let dir: string;
let db: Db;

function seed() {
	db.insert(t.users)
		.values({ id: "u", name: "U", email: "u@example.test", role: "reviewer", initials: "U" })
		.run();
	db.insert(t.sources)
		.values(
			["s1", "s2"].map((id) => ({
				id,
				name: id,
				kind: "api" as const,
				health: "ok" as const,
				floor: 0.6,
			})),
		)
		.run();
	db.insert(t.areas)
		.values(
			["a", "b"].map((id) => ({
				id,
				name: id,
				def: "radius" as const,
				centerLat: 0,
				centerLon: 0,
				sqkm: 1,
			})),
		)
		.run();

	for (const f of FIXTURES) {
		db.insert(t.candidates)
			.values({
				id: f.id,
				osmId: null,
				sourceRecordKey: f.id,
				areaId: f.area ?? "a",
				sourceId: f.source,
				type: f.type,
				name: f.name,
				addr: "",
				lat: 0,
				lon: 0,
				conf: f.conf,
				version: 0,
				fetchedAt: new Date(Date.now() - f.days * 86_400_000),
				headVersion: f.headVersion,
			})
			.run();
		f.tags.forEach((tag, position) => {
			const [{ id }] = db
				.insert(t.tags)
				.values({
					candidateId: f.id,
					position,
					op: "add",
					k: `k${position}`,
					v: "v",
					conf: 0.9,
					invalid: !!tag.invalid,
				})
				.returning({ id: t.tags.id })
				.all();
			if (tag.ev)
				db.insert(t.evidence)
					.values({ tagId: id, path: "", url: "", when: "", kind: "", conf: 0.9 })
					.run();
		});
		if (f.decided)
			db.insert(t.decisions)
				.values({ candidateId: f.id, kind: "rejected", userId: "u", decidedAt: new Date() })
				.run();
	}
}

const q = (raw: Record<string, string> = {}) => queueQuerySchema.parse(raw);
const ids = async (raw: Record<string, string> = {}, scope: string | null = "a", size = 50) =>
	(await loadQueue(db, scope, q(raw), size)).candidates.map((c) => c.id);

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-queries-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	seed();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadQueue", () => {
	it("leaves decided candidates and other areas out", async () => {
		const page = await loadQueue(db, "a", q());
		expect(page.total).toBe(7);
		expect(page.candidates.map((c) => c.id)).not.toContain("k9");
		expect(page.candidates.map((c) => c.id)).not.toContain("k8");
		expect((await loadQueue(db, null, q())).total).toBe(8);
	});

	it("filters by type across every area when unscoped", async () => {
		expect(await ids({ type: "closure" }, null)).toEqual(["k8", "k2", "k7"]);
	});

	it("filters by confidence band, each lower bound inclusive", async () => {
		expect(await ids({ conf: "high", sort: "conf" })).toEqual(["k1", "k4", "k6"]);
		expect(await ids({ conf: "mid", sort: "conf" })).toEqual(["k2", "k5"]);
		expect(await ids({ conf: "low", sort: "conf" })).toEqual(["k3", "k7"]);
	});

	it.each([
		[{}, ["k1", "k5", "k2", "k7", "k4", "k6", "k3"]],
		[{ sort: "name" }, ["k1", "k2", "k3", "k4", "k5", "k6", "k7"]],
		[{ sort: "name", dir: "desc" }, ["k7", "k6", "k5", "k4", "k3", "k2", "k1"]],
		[{ sort: "tags" }, ["k1", "k4", "k6", "k2", "k5", "k3", "k7"]],
		[{ sort: "source" }, ["k1", "k5", "k3", "k7", "k4", "k6", "k2"]],
		[{ sort: "age" }, ["k3", "k2", "k4", "k7", "k5", "k6", "k1"]],
		[{ sort: "age", dir: "asc" }, ["k1", "k6", "k5", "k7", "k4", "k2", "k3"]],
		[{ sort: "flags" }, ["k7", "k6", "k5", "k4", "k3", "k1", "k2"]],
		[{ sort: "conf" }, ["k1", "k4", "k6", "k2", "k5", "k3", "k7"]],
	])("sorts by %o", async (raw, expected) => {
		expect(await ids(raw as Record<string, string>)).toEqual(expected);
	});

	it("pages the sorted rows and clamps a page past the end to the last", async () => {
		expect(await ids({ sort: "conf", page: "2" }, "a", 3)).toEqual(["k2", "k5", "k3"]);

		const last = await loadQueue(db, "a", q({ sort: "conf", page: "9" }), 3);
		expect(last).toMatchObject({ total: 7, page: 3, pages: 3, offset: 6, query: { page: 3 } });
		expect(last.candidates.map((c) => c.id)).toEqual(["k7"]);
	});

	it("answers one empty page when nothing matches", async () => {
		const none = await loadQueue(db, "b", q({ type: "update", page: "4" }), 3);
		expect(none).toMatchObject({ candidates: [], total: 0, page: 1, pages: 1, offset: 0 });
	});
});

describe("queueQuerySchema", () => {
	it("falls back to the defaults for values it does not know", () => {
		expect(q({ type: "bogus", conf: "x", sort: "nope", dir: "up", page: "-2" })).toEqual(q());
		expect(q()).toEqual({ type: "all", conf: "all", sort: "type", dir: "asc", page: 1 });
		expect(q({ sort: "conf" }).dir).toBe("desc");
	});

	it("writes only what differs from the defaults", () => {
		expect(queueSearch(q())).toBe("");
		expect(queueSearch(q({ sort: "conf", dir: "desc", page: "1" }))).toBe("sort=conf");
		expect(queueSearch(q({ type: "closure", sort: "name", dir: "desc", page: "3" }))).toBe(
			"type=closure&sort=name&dir=desc&page=3",
		);
	});
});
