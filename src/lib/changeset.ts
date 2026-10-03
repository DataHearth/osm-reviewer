/** Staged rows, in upload order, cut into the changesets they will be sent as. */
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
