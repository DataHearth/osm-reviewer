import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import * as t from "./db/schema";
import { rebase } from "./mutations";
import type { TagOp } from "./osm/osmchange";
import { unchangedTags, updateOps } from "./pipeline/match/ops";
import { saveCandidate } from "./pipeline/store";
import {
	accept,
	decisionOps,
	type Picks,
	type Proposal,
	RefusedError,
	undo,
	upload,
} from "./review";

const P = (
	position: number,
	op: Proposal["op"],
	k: string,
	v: string,
	was: string | null = null,
): Proposal => ({
	id: 100 + position,
	position,
	op,
	k,
	v,
	was,
	ev: true,
	invalid: false,
	group: null,
	pair: null,
});

const proposals = [
	P(0, "add", "phone", "+33 1"),
	P(1, "mod", "name", "New", "Old"),
	P(2, "del", "fax", "+33 2"),
];
const unchanged = [
	{ k: "amenity", v: "cafe" },
	{ k: "website", v: "https://a.example" },
];
const none: Picks = { tags: [], set: [], del: [] };

describe("decisionOps", () => {
	it("takes picked proposals as they are", () => {
		expect(decisionOps(proposals, unchanged, { ...none, tags: [0, 2] })).toEqual([
			{ tagId: 100, op: "add", k: "phone", v: "+33 1", was: null },
			{ tagId: 102, op: "del", k: "fax", v: "+33 2", was: null },
		]);
	});

	it("reads add or mod off the object's tags, not off what was posted", () => {
		const ops = decisionOps(proposals, unchanged, {
			...none,
			set: ["phone=+33 9", "name=Mine", "website=https://b.example", "cuisine=coffee_shop"],
		});
		expect(ops).toEqual([
			{ tagId: 100, op: "add", k: "phone", v: "+33 9", was: null },
			{ tagId: 101, op: "mod", k: "name", v: "Mine", was: "Old" },
			{ tagId: null, op: "mod", k: "website", v: "https://b.example", was: "https://a.example" },
			{ tagId: null, op: "add", k: "cuisine", v: "coffee_shop", was: null },
		]);
	});

	it("deletes only a key the object has, with its current value", () => {
		expect(decisionOps(proposals, unchanged, { ...none, del: ["amenity"] })).toEqual([
			{ tagId: null, op: "del", k: "amenity", v: "cafe", was: null },
		]);
		expect(() => decisionOps(proposals, unchanged, { ...none, del: ["cuisine"] })).toThrow(
			RefusedError,
		);
	});

	it("splits on the first = so values may carry one", () => {
		expect(decisionOps([], [], { ...none, set: ["note=a=b"] })[0]).toMatchObject({
			k: "note",
			v: "a=b",
		});
	});

	it("refuses what OSM would or what says nothing", () => {
		const refuse = (picks: Partial<Picks>) =>
			expect(() => decisionOps(proposals, unchanged, { ...none, ...picks })).toThrow(RefusedError);
		refuse({});
		refuse({ set: ["amenity=cafe"] });
		refuse({ set: ["=x"] });
		refuse({ set: ["k="] });
		refuse({ set: [`${"k".repeat(256)}=x`] });
		refuse({ tags: [0], set: ["phone=+33 9"] });
		refuse({ tags: [7] });
		expect(() =>
			decisionOps([{ ...P(0, "add", "phone", "x"), ev: false }], [], { ...none, tags: [0] }),
		).toThrow(RefusedError);
	});
});

describe("decisionOps on an address", () => {
	const address = [
		{ ...P(0, "add", "addr:street", "Rue X"), group: "addr", pair: "contact:street" },
		{ ...P(1, "del", "contact:street", "Rue X"), group: "addr", pair: "addr:street" },
		{ ...P(2, "add", "addr:postcode", "31000"), group: "addr" },
		P(3, "add", "phone", "+33 1"),
	];
	const refused = (picks: Partial<Picks>) => {
		try {
			decisionOps(address, [], { ...none, ...picks });
		} catch (e) {
			if (e instanceof RefusedError) return e.message;
			throw e;
		}
		return null;
	};

	it("takes all of it, or none of it", () => {
		expect(refused({ tags: [0, 1, 2, 3] })).toBeNull();
		expect(refused({ tags: [3] })).toBeNull();
		expect(refused({ tags: [2, 3] })).toBe(
			"addr:postcode is part of the address — accept all of it or none (left out: addr:street, contact:street).",
		);
	});

	it("refuses one half of a move", () => {
		expect(refused({ tags: [0, 2] })).toBe(
			"contact:street moves to addr:street — accept both or neither.",
		);
		expect(refused({ tags: [1, 2] })).toBe(
			"contact:street moves to addr:street — accept both or neither.",
		);
	});

	it("counts a part typed over as taken", () => {
		expect(refused({ tags: [1, 2], set: ["addr:street=Rue Y"] })).toBeNull();
	});

	it("refuses a move whose old key is rewritten rather than removed", () => {
		expect(refused({ tags: [0, 2], set: ["contact:street=Rue Y"] })).toBe(
			"contact:street moves to addr:street — it can only be removed, not rewritten.",
		);
	});
});

let dir: string;
let db: Db;

function openDb() {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-review-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	db.insert(t.users)
		.values({ id: "u", name: "U", email: "u@example.test", role: "reviewer", initials: "U" })
		.run();
	db.insert(t.sources)
		.values({ id: "s", name: "s", kind: "registry", health: "ok", floor: 0.5 })
		.run();
	db.insert(t.areas)
		.values({ id: "a", name: "a", def: "radius", centerLat: 0, centerLon: 0, sqkm: 1 })
		.run();
}

const closeDb = () => rmSync(dir, { recursive: true, force: true });

describe("accept", () => {
	beforeEach(openDb);
	afterEach(closeDb);

	/** An object holding its address as `contact:*`, and many more tags than the screen shows. */
	function candidate() {
		const current: Record<string, string> = {
			amenity: "school",
			name: "École",
			"contact:street": "Rue X",
			"contact:housenumber": "2",
			"ref:UAI": "0310001A",
			"school:FR": "primaire",
			operator: "Mairie",
			phone: "+33 5 00 00 00 00",
			website: "https://e.example",
			wheelchair: "no",
		};
		const proposed = ["addr:street", "addr:postcode"].map((k) => ({
			k,
			v: k === "addr:street" ? "Rue X" : "31000",
			conf: 0.9,
			path: k,
			parts: [{ text: "x", mark: true }],
			kind: "row",
			addOnly: true,
			group: "addr",
		}));
		const ops = updateOps(proposed, current);
		saveCandidate(
			db,
			{
				sourceId: "s",
				areaId: "a",
				key: "k",
				hash: "h",
				type: "update",
				osmId: "node/1",
				version: 1,
				name: "École",
				addr: "",
				lat: 0,
				lon: 0,
				conf: 0.9,
				url: "",
				licence: "",
				ops,
				nearby: [],
				unchanged: unchangedTags(current, new Set(ops.map((o) => o.k))),
				record: { rows: [] },
				warning: null,
				seenAt: new Date(),
			},
			undefined,
		);
		const id = db.select().from(t.candidates).get()?.id as string;
		const tags = db.select().from(t.tags).where(eq(t.tags.candidateId, id)).all();
		return { id, at: (k: string) => tags.find((x) => x.k === k)?.position as number };
	}

	it("refuses part of a stored address", () => {
		const { id, at } = candidate();
		expect(() =>
			accept(db, "u", id, { ...none, tags: [at("addr:street"), at("contact:street")] }),
		).toThrow(/is part of the address/);
		expect(() => accept(db, "u", id, { ...none, tags: [at("addr:street")] })).toThrow(
			"contact:street moves to addr:street — accept both or neither.",
		);
	});

	it("reads a write to a key the screen does not show as a change of it", () => {
		const { id } = candidate();
		accept(db, "u", id, { ...none, set: ["wheelchair=yes"] });
		expect(db.select().from(t.decisionTags).all()).toMatchObject([
			{ op: "mod", k: "wheelchair", v: "yes", was: "no" },
		]);
	});

	it("rebases only a candidate in conflict", () => {
		const { id } = candidate();
		expect(() => rebase(db, id)).toThrow(RefusedError);
		db.update(t.candidates).set({ headVersion: 4 }).where(eq(t.candidates.id, id)).run();
		rebase(db, id);
		expect(db.select().from(t.candidates).get()).toMatchObject({
			version: 4,
			baseVersion: 4,
			headVersion: null,
		});
	});
});

describe("upload", () => {
	beforeEach(() => {
		openDb();
		db.insert(t.userSettings)
			.values({ userId: "u", osmToken: "token", osmConnected: new Date() })
			.run();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		closeDb();
	});

	/** A staged candidate on `osmId` (a new POI when null), decided `at` seconds into 1970. */
	function stage(key: string, osmId: string | null, ops: TagOp[], at: number) {
		const id = `c-${key}`;
		db.insert(t.candidates)
			.values({
				id,
				osmId,
				sourceRecordKey: key,
				areaId: "a",
				sourceId: "s",
				type: osmId ? "update" : "new",
				name: key,
				addr: "",
				lat: 0,
				lon: 0,
				conf: 0.9,
				version: osmId ? 1 : 0,
				fetchedAt: new Date(),
			})
			.run();
		db.insert(t.decisions)
			.values({ candidateId: id, kind: "accepted", userId: "u", decidedAt: new Date(at * 1000) })
			.run();
		db.insert(t.decisionTags)
			.values(ops.map((o, position) => ({ candidateId: id, position, ...o })))
			.run();
		return id;
	}

	const add = (k: string, v: string): TagOp => ({ op: "add", k, v });

	/** OSM's API as far as an upload reaches it: every object at version 1, changeset 77. */
	function fakeOsm(
		nodes: Record<number, Record<string, string>>,
		answer: { upload?: () => Promise<Response>; read?: () => Promise<Response> } = {},
	) {
		const calls: { method: string; path: string; body: string }[] = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
			const { pathname } = new URL(url);
			const method = init.method ?? "GET";
			calls.push({ method, path: pathname, body: String(init.body ?? "") });
			if (pathname.endsWith("/nodes.json"))
				return Response.json({
					elements: Object.entries(nodes).map(([id, tags]) => ({
						type: "node",
						id: Number(id),
						version: 1,
						lat: 0,
						lon: 0,
						tags,
					})),
				});
			if (pathname.endsWith("/changeset/create")) return new Response("77");
			if (pathname.endsWith("/changeset/77/upload"))
				return answer.upload ? answer.upload() : new Response("<diffResult/>");
			if (pathname.endsWith("/changeset/77.json") && answer.read) return answer.read();
			if (pathname.endsWith("/changeset/77/close")) return new Response("");
			throw new Error(`unexpected ${method} ${pathname}`);
		});
		return calls;
	}

	const sent = (calls: { path: string; body: string }[]) =>
		calls.filter((c) => c.path.endsWith("/upload")).map((c) => c.body);

	it("refuses a second upload while one is running", async () => {
		stage("a", null, [add("shop", "bakery")], 1);
		let answer = (_: Response) => {};
		const calls = fakeOsm(
			{},
			{ upload: () => new Promise<Response>((resolve) => (answer = resolve)) },
		);
		const first = upload(db, "u", { comment: "c" });
		await expect(upload(db, "u", { comment: "c" })).rejects.toThrow("already running");
		await vi.waitFor(() => expect(sent(calls)).toHaveLength(1));
		answer(new Response("<diffResult/>"));
		await expect(first).resolves.toEqual({ changesetId: "77" });
		expect(sent(calls)).toHaveLength(1);
	});

	it("refuses an undo while an upload is running", async () => {
		const id = stage("a", null, [add("shop", "bakery")], 1);
		let answer = (_: Response) => {};
		const calls = fakeOsm(
			{},
			{ upload: () => new Promise<Response>((resolve) => (answer = resolve)) },
		);
		const running = upload(db, "u", { comment: "c" });
		await vi.waitFor(() => expect(sent(calls)).toHaveLength(1));
		expect(() => undo(db, id)).toThrow("an upload is running");
		answer(new Response("<diffResult/>"));
		await running;
		expect(db.select().from(t.decisions).get()).toMatchObject({
			candidateId: id,
			changesetId: "77",
		});
	});
});
