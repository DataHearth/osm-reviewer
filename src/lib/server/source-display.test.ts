import { describe, expect, it } from "vitest";
import { configRows, metricRows, type RunFacts, runRow, type SourceFacts } from "./source-display";

const source: SourceFacts = {
	kind: "api",
	endpoint: "https://example.invalid/records",
	apiKey: null,
	schedule: "weekly",
	matching: "",
	budget: "",
	extractor: "deterministic",
	preset: null,
	licence: "",
	enabled: true,
	failing: false,
	nextRunAt: null,
	runRequestedAt: null,
};

const run: RunFacts = {
	startedAt: new Date(2026, 8, 1, 4, 12),
	durMs: 41 * 60_000,
	fetched: 34_200_000,
	cands: 186,
	errors: 0,
	result: "ok",
	message: null,
};

const row = (rows: [string, string, string?][], label: string) => rows.find((r) => r[0] === label);

describe("configRows", () => {
	it("masks the key to its last four characters and flags a missing one", () => {
		expect(
			row(configRows({ ...source, apiKey: "secret-3f71" }, undefined, null), "api key"),
		).toEqual(["api key", "••••••••••••3f71"]);
		expect(row(configRows(source, undefined, null), "api key")).toEqual([
			"api key",
			"not set",
			"warn",
		]);
	});

	it("says queued now until a run is scheduled, and not scheduled while disabled", () => {
		expect(row(configRows(source, undefined, null), "next run")).toEqual([
			"next run",
			"queued now",
		]);
		const when = new Date(2026, 9, 1, 4, 0);
		expect(row(configRows({ ...source, nextRunAt: when }, undefined, null), "next run")).toEqual([
			"next run",
			"01-10-2026 04:00",
		]);
		expect(row(configRows({ ...source, enabled: false }, undefined, null), "next run")?.[1]).toBe(
			"not scheduled",
		);
	});

	it("flags a model extractor with no model configured", () => {
		const rows = configRows({ ...source, extractor: "model" }, undefined, null);
		expect(row(rows, "extractor")).toEqual(["extractor", "no model configured", "warn"]);
		expect(
			row(configRows({ ...source, extractor: "model" }, undefined, "m · openai"), "extractor")?.[1],
		).toBe("m · openai");
	});

	it("shows the licence only when one is set", () => {
		expect(row(configRows(source, undefined, null), "licence")).toBeUndefined();
		expect(row(configRows({ ...source, licence: "ODbL" }, undefined, null), "licence")).toEqual([
			"licence",
			"ODbL",
		]);
	});
});

describe("runRow", () => {
	it("formats at the edge and counts pages for a crawl", () => {
		expect(runRow(run, "registry")).toMatchObject({
			when: "01-09-2026 04:12",
			dur: "41 min",
			fetched: "34.2M rows",
			result: "ok",
		});
		expect(runRow({ ...run, fetched: 392 }, "crawl").fetched).toBe("392 pages");
	});

	it("keeps the result's own word first so the screens can find the last ok run", () => {
		expect(runRow({ ...run, message: "2 rows skipped" }, "api").result).toBe("ok, 2 rows skipped");
		expect(runRow({ ...run, result: "failed", message: "401 unauthorized" }, "api").result).toBe(
			"401 unauthorized",
		);
	});
});

describe("metricRows", () => {
	const empty = { areas: 0, last: undefined, reviewed: 0, accepted: 0, tags: 0, unevidenced: 0 };

	it("reads as a first run when nothing has happened", () => {
		const rows = metricRows(empty);
		expect(rows.find((r) => r[0] === "last run")).toEqual([
			"last run",
			"never",
			"first run queued",
			"warn",
		]);
		expect(rows.find((r) => r[0] === "accept rate")?.[1]).toBe("—");
	});

	it("derives rates from decisions and evidence", () => {
		const rows = metricRows({
			areas: 2,
			last: run,
			reviewed: 100,
			accepted: 78,
			tags: 200,
			unevidenced: 4,
		});
		expect(rows.find((r) => r[0] === "accept rate")).toEqual([
			"accept rate",
			"78%",
			"of 100 reviewed",
			"ok",
		]);
		expect(rows.find((r) => r[0] === "unevidenced")).toEqual([
			"unevidenced",
			"2%",
			"tags without a source row",
			"ok",
		]);
		expect(rows.find((r) => r[0] === "candidates")).toEqual([
			"candidates",
			"186",
			"last run, 2 areas",
		]);
		expect(rows.find((r) => r[0] === "last run")).toEqual([
			"last run",
			"01-09-2026",
			"04:12 · 41 min",
		]);
	});

	it("marks a failed run's errors bad", () => {
		const rows = metricRows({
			...empty,
			last: { ...run, errors: 1, result: "failed", message: "401 unauthorized" },
		});
		expect(rows.find((r) => r[0] === "errors")).toEqual(["errors", "1", "401 unauthorized", "bad"]);
	});
});
