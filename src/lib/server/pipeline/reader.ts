import { createHash } from "node:crypto";
import { ID_FIELDS } from "./fr/words";
import type { Preset } from "./preset";
import { detectPreset, presetById } from "./presets";
import { findCoords, str } from "./row";
import { PipelineError, type Row } from "./types";

/** How a source's rows become records: the preset's own key and position, or the generic guess for the model extractor. */
export interface Reader {
	preset: Preset | null;
	key(row: Row): string | null;
	position(row: Row): [number, number] | null;
	/** Rows the mapping says are not places, dropped from the read. */
	skip(row: Row): boolean;
	/** The preset's key column, if any, so a record can be looked up again. */
	keyField: string | null;
}

export const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

const genericReader: Reader = {
	preset: null,
	keyField: null,
	key: (r) => str(r, "id", "recordid", "record_id", ...ID_FIELDS) || `h:${hash(JSON.stringify(r))}`,
	position: findCoords,
	skip: () => false,
};

export function presetReader(p: Preset): Reader {
	return {
		preset: p,
		key: (r) => p.key(r),
		position: (r) => p.position(r),
		skip: (r) => p.skip(r),
		keyField: p.keyField,
	};
}

/**
 * The preset the operator named, by its id or its mapping's, else the one whose columns the
 * data carries. Neither is a failed run, not a guess.
 */
export function presetFor(source: { preset: string | null }, columns: string[]): Preset {
	const found = presetById(source.preset) ?? detectPreset(columns);
	if (found) return found;
	throw new PipelineError(
		"no preset matches these fields (" +
			columns.slice(0, 6).join(", ") +
			(columns.length > 6 ? ", …" : "") +
			"): point the source at a mapping or use the model extractor",
	);
}

/** The deterministic extractor needs a preset; the model extractor reads whatever it is given. */
export function readerFor(
	source: { extractor: "deterministic" | "model"; preset: string | null },
	columns: string[],
): Reader {
	return source.extractor === "model" ? genericReader : presetReader(presetFor(source, columns));
}
