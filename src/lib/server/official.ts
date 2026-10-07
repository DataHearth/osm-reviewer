import { sourceDraftSchema } from "$lib/schemas/source";
import type { OfficialSource, SourceOrigin } from "$lib/types";
import { mappingFor, renamingFor, shippedSources } from "./pipeline/mapping/files";
import type { OfficialRenaming } from "./pipeline/mapping/schema";
import { presetById } from "./pipeline/presets";
import { KIND_LABEL } from "./source-display";

interface Pointed {
	endpoint: string;
	preset: string | null;
	extractor: "deterministic" | "model";
}

const bare = (url: string) => url.replace(/\/+$/, "");

/**
 * The shipped source a row was made from and still reads: the same dataset address (or one the
 * dataset answered at before) and the same mapping. Derived on every read, so editing the
 * endpoint or the kind of place of a row takes the mark off it, and nothing is stored to disagree.
 */
export function officialFile(s: Pointed): OfficialRenaming | null {
	if (s.extractor !== "deterministic") return null;
	const mapping = presetById(s.preset)?.mapping ?? s.preset;
	return (
		shippedSources().find(
			(f) =>
				f.mapping === mapping &&
				[f.official.source.endpoint, ...(f.official.source.formerEndpoints ?? [])].some(
					(e) => bare(e) === bare(s.endpoint),
				),
		) ?? null
	);
}

export function officialView(f: OfficialRenaming): OfficialSource {
	const { source, ...checklist } = f.official;
	return {
		file: f.source,
		...checklist,
		kind: source.kind,
		kindLabel: KIND_LABEL[source.kind],
		endpoint: source.endpoint,
		schedule: source.schedule,
		matching: source.matching,
		mapping: f.mapping,
		mappingTitle: mappingFor(f.mapping).title,
		overrides: Object.keys(f.overrides?.tags ?? {}),
	};
}

/**
 * The tags a row's reads are overridden for: the shipped renaming's overrides apply to any
 * source read through it, official or not, and to none read through a renaming the model made.
 * Null where the source detects its preset from the columns: a run does not record which one.
 */
export function overridesOf(
	s: Pointed & { renamingUsed: "shipped" | "stored" | null },
): string[] | null {
	if (s.extractor !== "deterministic" || s.renamingUsed === "stored") return [];
	const preset = presetById(s.preset);
	if (!preset) return null;
	return Object.keys(renamingFor(preset.source).overrides?.tags ?? {});
}

export function originOf(
	s: Pointed & { renamingUsed: "shipped" | "stored" | null },
	stored: { mapping: string } | null,
): SourceOrigin {
	return {
		official: officialFile(s) !== null,
		mapping: presetById(s.preset)?.mapping ?? stored?.mapping ?? null,
		overrides: overridesOf(s),
	};
}

/** What a new row made from a shipped source starts with, as the source form would have sent it. */
export function officialDraft(f: OfficialRenaming, areas: Record<string, boolean>) {
	const { source } = f.official;
	return sourceDraftSchema.parse({
		name: f.official.title,
		kind: source.kind,
		endpoint: source.endpoint,
		schedule: source.schedule,
		floor: source.floor,
		allow: source.allow,
		matching: source.matching,
		extractor: "deterministic",
		preset: f.mapping,
		areas,
	});
}
