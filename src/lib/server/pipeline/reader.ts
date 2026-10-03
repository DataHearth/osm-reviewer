import { createHash } from "node:crypto";
import { detectPreset, findCoords, type Preset, presetById, str } from "./presets";
import { PipelineError, type Row } from "./types";

/** How a source's rows become records: the preset's own key and position, or the generic guess for the model extractor. */
export interface Reader {
	preset: Preset | null;
	key(row: Row): string | null;
	position(row: Row): [number, number] | null;
	/** The preset's key column, if any, so a record can be looked up again. */
	keyField: string | null;
}

export const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

const genericReader: Reader = {
	preset: null,
	keyField: null,
	key: (r) =>
		str(r, "id", "recordid", "record_id", "identifiant", "uai") || "h:" + hash(JSON.stringify(r)),
	position: findCoords,
};

function presetReader(p: Preset): Reader {
	return { preset: p, key: (r) => p.key(r), position: (r) => p.position(r), keyField: p.keyField };
}

/**
 * The deterministic extractor needs a preset: the one the operator named, else the one
 * whose columns the data carries. Neither is a failed run, not a guess.
 */
export function readerFor(
	source: { extractor: "deterministic" | "model"; preset: string | null },
	columns: string[],
): Reader {
	if (source.extractor === "model") return genericReader;
	const named = presetById(source.preset);
	if (named) return presetReader(named);
	const found = detectPreset(columns);
	if (found) return presetReader(found);
	throw new PipelineError(
		"no preset matches these fields (" +
			columns.slice(0, 6).join(", ") +
			(columns.length > 6 ? ", …" : "") +
			"): name a preset or use the model extractor",
	);
}
