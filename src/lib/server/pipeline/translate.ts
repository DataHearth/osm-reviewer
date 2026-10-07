import type { Preset } from "./preset";
import type { Row } from "./types";

/**
 * A preset's code reads the columns of the source it was written for. For a source whose columns
 * a column renaming matched to the mapping's inputs, `native` says which of those columns each
 * of its own stands for; the preset then sees every row as if it had come from the shipped source.
 */
export function translated(base: Preset, native: ReadonlyMap<string, string>): Preset {
	const seen = new WeakMap<Row, Row>();
	const to = (row: Row): Row => {
		const known = seen.get(row);
		if (known) return known;
		const out: Row = {};
		for (const [column, as] of native) if (column in row) out[as] = row[column];
		seen.set(row, out);
		return out;
	};
	const back = new Map([...native].map(([column, as]) => [as, column]));

	return {
		...base,
		keyField: back.get(base.keyField) ?? base.keyField,
		key: (row) => base.key(to(row)),
		position: (row) => base.position(to(row)),
		skip: (row) => base.skip(to(row)),
		siteQuery: base.siteQuery && ((row) => base.siteQuery?.(to(row)) ?? null),
		site: base.site && ((row) => base.site?.(to(row)) ?? null),
		link: base.link && ((row, record) => base.link?.(to(row), record.map(to)) ?? []),
		extract(rows, url, gaps, rowsOf) {
			return base.extract(
				rows.map(to),
				url,
				gaps && new Map(rows.map((r) => [to(r), gaps.get(r) ?? Number.POSITIVE_INFINITY])),
				rowsOf && ((key) => rowsOf(key)?.map(to)),
			);
		},
	};
}
