import { comma, fmtCount, fmtDate, fmtDuration, stamp } from "$lib/format";
import type {
	ColumnMapping,
	ConfigRow,
	MetricRow,
	RenameRefusal,
	Run,
	SourceKind,
} from "$lib/types";
import { mappingFor, renamingFor } from "./pipeline/mapping/files";
import type { ColumnRenaming } from "./pipeline/mapping/rename";
import { presetById } from "./pipeline/presets";

const MAPPING_ID = /^[A-Z]{2}:/;

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

interface StoredFacts {
	mapping: string;
	columns: string[];
	renaming: ColumnRenaming;
	model: string;
	madeAt: Date;
}

type RenameFacts = Pick<SourceFacts, "extractor" | "preset"> & {
	renameRequestedAt: Date | null;
	renamingUsed: "shipped" | "stored" | null;
};

/** Why "rename again" is not offered; the button says the label, the action answers the reason. */
export function renameRefusal(
	s: Pick<RenameFacts, "extractor" | "renamingUsed">,
	modelConfigured: boolean,
): RenameRefusal | null {
	if (s.extractor === "model")
		return { label: "no columns", reason: "This source reads no columns to rename." };
	if (s.renamingUsed === "shipped")
		return {
			label: "shipped columns",
			reason:
				"The last read used the renaming shipped with the app, so there is nothing for the model to rename.",
		};
	if (!modelConfigured)
		return {
			label: "not configured",
			reason: "Set LLM_PROVIDER and LLM_MODEL to enable renaming.",
		};
	return null;
}

const titleOf = (id: string) => {
	try {
		return mappingFor(id).title;
	} catch {
		return null;
	}
};

/**
 * The mapping a source reads through: the one its preset names, else the one the model last
 * renamed its columns for. A source detected by its columns has neither until a run settles it.
 */
export function columnMapping(
	s: RenameFacts,
	stored: StoredFacts | null,
	modelConfigured: boolean,
): ColumnMapping | null {
	if (s.extractor === "model") return null;
	const preset = presetById(s.preset);
	const id = preset?.mapping ?? stored?.mapping;
	if (!id) return null;
	const own = s.renamingUsed === "stored" && stored?.mapping === id ? stored : null;
	return {
		mapping: id,
		title: titleOf(id),
		origin: s.renamingUsed === "shipped" ? "shipped" : own ? "stored" : null,
		shippedColumns: preset ? renamingFor(preset.source).columns.length : 0,
		stored: own && {
			madeAt: stamp(own.madeAt),
			model: own.model,
			columns: own.columns.length,
			renamed: Object.entries(own.renaming.rename),
			steps: Object.entries(own.renaming.steps).map(([column, step]) => [
				column,
				step.name.slice(step.name.indexOf("/") + 1),
				step.as,
			]),
			ignored: Object.entries(own.renaming.ignored),
		},
		renameRequested: s.renameRequestedAt !== null,
		refusal: renameRefusal(s, modelConfigured),
	};
}

const unit = (kind: SourceKind) => (kind === "crawl" ? "pages" : "rows");

export function runRow(r: RunFacts, kind: SourceKind): Run {
	return {
		when: stamp(r.startedAt),
		dur: fmtDuration(r.durMs),
		fetched: `${fmtCount(r.fetched)} ${unit(kind)}`,
		cands: String(r.cands),
		errors: String(r.errors),
		result: r.result === "ok" ? (r.message ? `ok, ${r.message}` : "ok") : (r.message ?? r.result),
	};
}

function nextRun(s: SourceFacts): ConfigRow {
	if (!s.enabled) return ["next run", "not scheduled", "warn"];
	if (s.runRequestedAt || !s.nextRunAt) return ["next run", "queued now"];
	return ["next run", stamp(s.nextRunAt)];
}

/** `model` is the configured LLM's label, or null when none is configured. */
export function configRows(s: SourceFacts, last: RunFacts | undefined, model: string | null) {
	const mapping = presetById(s.preset)?.mapping ?? s.preset;
	const extractor: ConfigRow =
		s.extractor === "model"
			? model
				? ["extractor", model, "code"]
				: ["extractor", "no model configured", "warn"]
			: [
					"extractor",
					`deterministic field map · ${mapping ? `${MAPPING_ID.test(mapping) ? "mapping" : "preset"} ${mapping}` : "no model"}`,
					"code",
				];
	const schedule: ConfigRow = s.failing
		? ["schedule", `${s.schedule} — held after failures`, "warn"]
		: ["schedule", s.schedule];
	const licence: ConfigRow[] = s.licence ? [["licence", s.licence]] : [];

	if (s.kind === "registry")
		return [
			["dataset", s.endpoint || "—", "code"],
			...licence,
			["volume", last ? `${fmtCount(last.fetched)} rows last run` : "unknown until first run"],
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
		key4 ? ["api key", `••••••••••••${key4}`] : ["api key", "not set", "warn"],
		...licence,
		["pagination", last ? `${fmtCount(last.fetched)} rows last run` : "detected on first run"],
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
					`${Math.round(rate * 100)}%`,
					`of ${comma(m.reviewed)} reviewed`,
					tier(rate, 0.75, 0.5),
				],
		gap === null
			? ["unevidenced", "—", "no tags yet"]
			: [
					"unevidenced",
					`${Math.round(gap * 100)}%`,
					"tags without a source row",
					gap <= 0.05 ? "ok" : gap <= 0.15 ? "warn" : "bad",
				],
		last
			? [
					"last run",
					fmtDate(last.startedAt),
					`${stamp(last.startedAt).slice(11)} · ${fmtDuration(last.durMs)}`,
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
