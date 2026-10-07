import { createHash } from "node:crypto";
import { type Extractor, extractorOf, shippedExtractor, type Table } from "./extractor";
import { ID_FIELDS } from "./fr/words";
import { shippedCovering, shippedNamed } from "./mapping/files";
import { findCoords, str } from "./row";
import { PipelineError, type Row } from "./types";

/** How a source's rows become records: the extractor's own key and position, or the generic guess for the model extractor. */
export interface Reader {
	extractor: Extractor | null;
	key(row: Row): string | null;
	position(row: Row): [number, number] | null;
	/** Rows the mapping says are not places, dropped from the read. */
	skip(row: Row): boolean;
	/** The extractor's key column, if any, so a record can be looked up again. */
	keyField: string | null;
}

export const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

const genericReader: Reader = {
	extractor: null,
	keyField: null,
	key: (r) => str(r, "id", "recordid", "record_id", ...ID_FIELDS) || `h:${hash(JSON.stringify(r))}`,
	position: findCoords,
	skip: () => false,
};

export function extractorReader(x: Extractor): Reader {
	return {
		extractor: x,
		key: (r) => x.key(r),
		position: (r) => x.position(r),
		skip: (r) => x.skip(r),
		keyField: x.keyField,
	};
}

/** The reader for rows read through a table. */
export const readerOf = (table: Table): Reader => extractorReader(extractorOf(table));

/**
 * The shipped source the operator's mapping names, else the one whose columns hold every one the
 * data carries. Neither is a failed run, not a guess.
 */
export function shippedFor(source: { preset: string | null }, columns: string[]) {
	const found = shippedNamed(source.preset) ?? shippedCovering(columns);
	if (found) return found;
	throw new PipelineError(
		"no shipped source has these fields (" +
			columns.slice(0, 6).join(", ") +
			(columns.length > 6 ? ", …" : "") +
			"): name the mapping to read the source through, or use the model extractor",
	);
}

/** The deterministic extractor needs a mapping; the model extractor reads whatever it is given. */
export function readerFor(
	source: { extractor: "deterministic" | "model"; preset: string | null },
	columns: string[],
): Reader {
	return source.extractor === "model"
		? genericReader
		: extractorReader(shippedExtractor(shippedFor(source, columns)));
}
