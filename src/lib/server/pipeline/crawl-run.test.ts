import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "$lib/server/db/client";
import { runMigrations } from "$lib/server/db/migrate";
import * as t from "$lib/server/db/schema";

const ask = vi.hoisted(() => vi.fn());
vi.mock("./llm", async (orig) => ({
	...(await orig<typeof import("./llm")>()),
	askModel: ask,
	modelLabel: () => "test · model",
}));
vi.mock("node:dns/promises", () => ({
	lookup: async () => [{ address: "203.0.113.7", family: 4 }],
}));
vi.mock("./http", async (orig) => ({
	...(await orig<typeof import("./http")>()),
	sleep: async () => {},
}));

import { runSource } from "./runner";

const PAGE = "<html><body><p>Ouvert du lundi au samedi de 9h à 19h</p></body></html>";
let db: Db;
let dir: string;
let osmVersion = 3;
const fetched: string[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-crawl-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	fetched.length = 0;
	ask.mockReset();
	ask.mockResolvedValue({
		tags: [
			{
				k: "opening_hours",
				v: "Mo-Sa 09:00-19:00",
				confidence: 0.85,
				quote: "Ouvert du lundi au samedi de 9h à 19h",
			},
			{ k: "wheelchair", v: "yes", confidence: 0.9, quote: "invented" },
		],
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			fetched.push(url);
			if (url.includes("overpass"))
				return Response.json({
					elements: [
						{
							type: "node",
							id: 7,
							lat: 45.76,
							lon: 4.83,
							version: osmVersion,
							user: "bob",
							tags: { amenity: "cafe", name: "Chez Paul", website: "https://paul.test/" },
						},
					],
				});
			if (url === "https://paul.test/robots.txt")
				return new Response("User-agent: *\nDisallow: /secret", {
					headers: { "content-type": "text/plain" },
				});
			if (url === "https://paul.test/")
				return new Response(PAGE, { headers: { "content-type": "text/html" } });
			return new Response("nope", { status: 404, statusText: "Not Found" });
		}),
	);

	db.insert(t.areas)
		.values({
			id: "a",
			name: "Zone",
			def: "radius",
			radius: 500,
			centerLat: 45.76,
			centerLon: 4.83,
			sqkm: 1,
		})
		.run();
	db.insert(t.sources)
		.values({
			id: "web",
			name: "Web",
			kind: "crawl",
			health: "ok",
			floor: 0.6,
			endpoint: "website=* on POIs inside the area",
			budget: "10 pages / run · 1 request / 1 s per host",
			extractor: "model",
		})
		.run();
	db.insert(t.sourceAllowedTags)
		.values({ sourceId: "web", position: 0, pattern: "opening_hours" })
		.run();
	db.insert(t.areaSources).values({ areaId: "a", sourceId: "web" }).run();
});

afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(dir, { recursive: true, force: true });
});

describe("runSource (crawl)", () => {
	it("crawls the sites OSM points at, asks the model and keeps only quoted tags", async () => {
		await runSource(db, "web");

		const run = db.select().from(t.runs).get();
		expect(run).toMatchObject({ result: "ok", fetched: 1, cands: 1 });
		expect(fetched).toContain("https://paul.test/robots.txt");

		const [c] = db.select().from(t.candidates).all();
		expect(c).toMatchObject({ type: "update", osmId: "node/7", version: 3, name: "Chez Paul" });
		const tags = db.select().from(t.tags).all();
		expect(tags.map((x) => [x.k, x.op, x.v])).toEqual([
			["opening_hours", "add", "Mo-Sa 09:00-19:00"],
		]);
		const parts = db.select().from(t.evidenceParts).all();
		expect(parts.find((p) => p.mark)?.text).toBe("Ouvert du lundi au samedi de 9h à 19h");
	});

	it("does not ask the model again about a page that reads the same", async () => {
		await runSource(db, "web");
		expect(ask).toHaveBeenCalledTimes(1);
		await runSource(db, "web");
		expect(ask).toHaveBeenCalledTimes(1);
		expect(db.select().from(t.candidates).all()).toHaveLength(1);
	});

	it("flags a queued candidate when the OSM object moved while its page did not", async () => {
		await runSource(db, "web");
		osmVersion = 4;
		await runSource(db, "web");
		osmVersion = 3;
		expect(db.select().from(t.candidates).get()).toMatchObject({
			headVersion: 4,
			conflictWho: "bob",
		});
	});

	it("honours robots.txt", async () => {
		const real = globalThis.fetch;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string | URL | Request, init?: RequestInit) =>
				String(u) === "https://paul.test/robots.txt"
					? new Response("User-agent: *\nDisallow: /", {
							headers: { "content-type": "text/plain" },
						})
					: real(u, init),
			),
		);
		await runSource(db, "web");
		expect(ask).not.toHaveBeenCalled();
		expect(db.select().from(t.candidates).all()).toHaveLength(0);
	});

	it("fails a crawl whose extractor is deterministic", async () => {
		db.update(t.sources).set({ extractor: "deterministic" }).where(eq(t.sources.id, "web")).run();
		await runSource(db, "web");
		expect(db.select().from(t.runs).get()?.message).toMatch(/needs the model extractor/);
	});
});
