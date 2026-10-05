/** OSM refuses a longer key or value, and the upload batch with it. */
export const OSM_MAX = 255;

/**
 * The result of a changeset whose diff got no answer and does not show as applied yet. Its
 * decisions point at it, so they are neither staged nor undoable until an upload reads the
 * changeset back and settles it as `ok` or releases them.
 */
export const PARKED = "unknown";

export const resultTone = (result: string) =>
	result === "ok" ? "text-ok" : result === PARKED ? "text-warn" : "text-bad";

/**
 * Staged rows, in upload order, grouped by the object they write, each object where its first
 * row falls. Several records can match one object (a campus), and its rows travel together as
 * one `<modify>`; a new POI is an object of its own.
 */
export function byObject<T extends { candidateId: string; osmId: string | null }>(rows: T[]) {
	const objects = new Map<string, T[]>();
	for (const row of rows) {
		const key = row.osmId ?? row.candidateId;
		objects.set(key, [...(objects.get(key) ?? []), row]);
	}
	return [...objects.values()];
}

/** Objects, in upload order, cut into the changesets they will be sent as, `size` to each. */
export function batches<T>(rows: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += Math.max(1, size))
		out.push(rows.slice(i, i + Math.max(1, size)));
	return out;
}

export const sourceLabel = (name: string, licence: string | null) =>
	licence ? `${name} (${licence})` : name;

/** A changeset's `source` tag: the sources of the candidates it carries, each once. */
export const sourceTag = (rows: { source: string }[]) =>
	[...new Set(rows.map((r) => r.source))].join("; ");
