import { comma, fmtCount, fmtDate, fmtDuration, stamp } from "$lib/format";
import type { ConfigRow, MetricRow, Run, SourceKind } from "$lib/types";

export const KIND_LABEL: Record<SourceKind, string> = {
	registry: "national registry dump",
	crawl: "operator website crawl",
	api: "government open-data API",
};

export interface SourceFacts {
	kind: SourceKind;
	endpoint: string;
	apiKey: string | null;
	schedule: string;
	matching: string;
	budget: string;
	extractor: "deterministic" | "model";
	preset: string | null;
	licence: string;
	enabled: boolean;
	failing: boolean;
	nextRunAt: Date | null;
	runRequestedAt: Date | null;
}

export interface RunFacts {
	startedAt: Date;
	durMs: number;
	fetched: number;
	cands: number;
	errors: number;
	result: "ok" | "partial" | "failed";
	message: string | null;
}

const unit = (kind: SourceKind) => (kind === "crawl" ? "pages" : "rows");

export function runRow(r: RunFacts, kind: SourceKind): Run {
	return {
		when: stamp(r.startedAt),
		dur: fmtDuration(r.durMs),
		fetched: fmtCount(r.fetched) + " " + unit(kind),
		cands: String(r.cands),
		errors: String(r.errors),
		result: r.result === "ok" ? (r.message ? "ok, " + r.message : "ok") : (r.message ?? r.result),
	};
}

function nextRun(s: SourceFacts): ConfigRow {
	if (!s.enabled) return ["next run", "not scheduled", "warn"];
	if (s.runRequestedAt || !s.nextRunAt) return ["next run", "queued now"];
	return ["next run", stamp(s.nextRunAt)];
}

/** `model` is the configured LLM's label, or null when none is configured. */
export function configRows(s: SourceFacts, last: RunFacts | undefined, model: string | null) {
	const extractor: ConfigRow =
		s.extractor === "model"
			? model
				? ["extractor", model, "code"]
				: ["extractor", "no model configured", "warn"]
			: [
					"extractor",
					"deterministic field map · " + (s.preset ? "preset " + s.preset : "no model"),
					"code",
				];
	const schedule: ConfigRow = s.failing
		? ["schedule", s.schedule + " — held after failures", "warn"]
		: ["schedule", s.schedule];
	const licence: ConfigRow[] = s.licence ? [["licence", s.licence]] : [];

	if (s.kind === "registry")
		return [
			["dataset", s.endpoint || "—", "code"],
			...licence,
			["volume", last ? fmtCount(last.fetched) + " rows last run" : "unknown until first run"],
			schedule,
			nextRun(s),
			["matching", s.matching || "—"],
			extractor,
		] satisfies ConfigRow[];

	if (s.kind === "crawl")
		return [
			["seed rule", s.endpoint || "—", "code"],
			["budget", s.budget || "—"],
			["robots.txt", "honoured"],
			schedule,
			nextRun(s),
			extractor,
		] satisfies ConfigRow[];

	const key4 = (s.apiKey ?? "").trim().slice(-4);
	return [
		["endpoint", s.endpoint || "—", "code"],
		key4 ? ["api key", "••••••••••••" + key4] : ["api key", "not set", "warn"],
		...licence,
		["pagination", last ? fmtCount(last.fetched) + " rows last run" : "detected on first run"],
		schedule,
		nextRun(s),
		extractor,
	] satisfies ConfigRow[];
}

export interface MetricFacts {
	areas: number;
	last: RunFacts | undefined;
	reviewed: number;
	accepted: number;
	tags: number;
	unevidenced: number;
}

const tier = (v: number, ok: number, warn: number): MetricRow[3] =>
	v >= ok ? "ok" : v >= warn ? "warn" : "bad";

export function metricRows(m: MetricFacts): MetricRow[] {
	const { last } = m;
	const rate = m.reviewed ? m.accepted / m.reviewed : null;
	const gap = m.tags ? m.unevidenced / m.tags : null;

	return [
		last
			? [
					"candidates",
					String(last.cands),
					`last run, ${m.areas} ${m.areas === 1 ? "area" : "areas"}`,
				]
			: ["candidates", "—", "no runs yet"],
		rate === null
			? ["accept rate", "—", "nothing reviewed"]
			: [
					"accept rate",
					Math.round(rate * 100) + "%",
					`of ${comma(m.reviewed)} reviewed`,
					tier(rate, 0.75, 0.5),
				],
		gap === null
			? ["unevidenced", "—", "no tags yet"]
			: [
					"unevidenced",
					Math.round(gap * 100) + "%",
					"tags without a source row",
					gap <= 0.05 ? "ok" : gap <= 0.15 ? "warn" : "bad",
				],
		last
			? [
					"last run",
					fmtDate(last.startedAt),
					stamp(last.startedAt).slice(11) + " · " + fmtDuration(last.durMs),
				]
			: ["last run", "never", "first run queued", "warn"],
		last
			? [
					"errors",
					String(last.errors),
					last.message ?? (last.errors ? "see the run" : "clean"),
					last.result === "failed" ? "bad" : last.errors ? "warn" : undefined,
				]
			: ["errors", "—", "no runs yet"],
	];
}
