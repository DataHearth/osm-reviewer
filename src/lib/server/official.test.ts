import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import * as t from "./db/schema";
import { addOfficialSource } from "./mutations";
import { officialFile, originOf } from "./official";
import { renamingFor, shippedSources } from "./pipeline/mapping/files";
import type { OfficialRenaming } from "./pipeline/mapping/schema";
import { presetById } from "./pipeline/presets";
import { loadOffered, loadSources } from "./queries";

vi.mock("./pipeline/mapping/files", async (original) => {
	const files = await original<typeof import("./pipeline/mapping/files")>();
	return { ...files, shippedSources: vi.fn(files.shippedSources) };
});

const education = shippedSources().find(
	(f) => f.source === "fr/annuaire-education",
) as OfficialRenaming;
const irve = renamingFor("fr/irve");
const row = (file: OfficialRenaming, extra = {}) => ({
	endpoint: file.official.source.endpoint,
	preset: file.mapping,
	extractor: "deterministic" as const,
	...extra,
});

describe("shipped sources", () => {
	it.each(shippedSources().map((f) => [f.source, f] as const))(
		"%s can be named by a row: a preset reads its mapping and was written for it",
		(_, file) => {
			expect(presetById(file.mapping)?.source).toBe(file.source);
		},
	);
});

describe("officialFile", () => {
	it("knows a row made from a file, however its endpoint or kind of place is spelled", () => {
		expect(officialFile(row(education))?.source).toBe("fr/annuaire-education");
		expect(officialFile(row(education, { preset: "annuaire-education" }))?.source).toBe(
			"fr/annuaire-education",
		);
		expect(
			officialFile(row(education, { endpoint: `${education.official.source.endpoint}/` }))?.source,
		).toBe("fr/annuaire-education");
	});

	it("knows a row made under an address the dataset answered at before", () => {
		const former = "https://example.invalid/former";
		const moved = {
			...education,
			official: {
				...education.official,
				source: { ...education.official.source, formerEndpoints: [former] },
			},
		};
		vi.mocked(shippedSources).mockReturnValueOnce([moved]);
		expect(officialFile(row(education, { endpoint: former }))?.source).toBe(
			"fr/annuaire-education",
		);
	});

	it("does not mark a row read through a shipped source that has no official block", () => {
		expect(irve.official).toBeUndefined();
		expect(
			officialFile({
				endpoint: "https://www.data.gouv.fr/api/1/datasets/5448d3e0c751df01f85d0572/",
				preset: irve.mapping,
				extractor: "deterministic",
			}),
		).toBeNull();
	});

	it("drops the mark when the endpoint, the kind of place or the extractor is changed", () => {
		expect(
			officialFile(row(education, { endpoint: "https://example.invalid/records" })),
		).toBeNull();
		expect(officialFile(row(education, { preset: irve.mapping }))).toBeNull();
		expect(officialFile(row(education, { preset: null }))).toBeNull();
		expect(officialFile(row(education, { extractor: "model" }))).toBeNull();
	});
});

describe("originOf", () => {
	it("lists the shipped renaming's overrides, and none under a renaming the model made", () => {
		const shipped = originOf({ ...row(education), renamingUsed: "shipped" }, null);
		expect(shipped).toEqual({ official: true, mapping: "FR:school", overrides: ["start_date"] });
		const stored = originOf(
			{ ...row(education, { endpoint: "https://example.invalid/a" }), renamingUsed: "stored" },
			{ mapping: "FR:school" },
		);
		expect(stored).toEqual({ official: false, mapping: "FR:school", overrides: [] });
	});

	it("has no mapping to name for a source whose columns are not read yet", () => {
		const custom = originOf(
			{
				endpoint: "https://example.invalid/a",
				preset: null,
				extractor: "deterministic",
				renamingUsed: null,
			},
			null,
		);
		expect(custom).toEqual({ official: false, mapping: null, overrides: null });
	});

	it("does not claim no overrides for a source whose preset is detected from its columns", () => {
		const detected = originOf(
			{
				endpoint: "https://example.invalid/a",
				preset: null,
				extractor: "deterministic",
				renamingUsed: "shipped",
			},
			null,
		);
		expect(detected.overrides).toBeNull();
	});
});

describe("switching a shipped source on", () => {
	let dir: string;
	let db: Db;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "osm-reviewer-official-"));
		db = createDb(join(dir, "test.db"));
		runMigrations(db);
		db.insert(t.areas)
			.values({
				id: "a1",
				name: "Lyon",
				def: "radius",
				centerLat: 45.7,
				centerLon: 4.8,
				radius: 2500,
				sqkm: 20,
			})
			.run();
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("creates the row from the file, once, and then stops offering it", async () => {
		expect(loadOffered(await loadSources(db)).map((o) => o.file)).toEqual([
			"fr/annuaire-education",
		]);

		const id = addOfficialSource(db, education, { a1: true });
		expect(id).not.toBeNull();
		const made = db
			.select()
			.from(t.sources)
			.where(eq(t.sources.id, id as string))
			.get();
		expect(made).toMatchObject({
			name: education.official.title,
			kind: "api",
			endpoint: education.official.source.endpoint,
			matching: "amenity=school",
			schedule: "weekly",
			floor: 0.7,
			extractor: "deterministic",
			preset: "FR:school",
			licence: education.official.licence,
			enabled: true,
		});
		expect(
			db
				.select()
				.from(t.sourceAllowedTags)
				.where(eq(t.sourceAllowedTags.sourceId, made?.id ?? ""))
				.all()
				.map((r) => r.pattern),
		).toEqual(education.official.source.allow);
		expect(db.select().from(t.areaSources).all()).toEqual([{ areaId: "a1", sourceId: made?.id }]);

		const sources = await loadSources(db);
		expect(sources[0].official?.file).toBe("fr/annuaire-education");
		expect(loadOffered(sources)).toEqual([]);
		expect(addOfficialSource(db, education, {})).toBeNull();
	});
});
