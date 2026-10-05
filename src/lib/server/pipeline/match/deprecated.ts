import DEPRECATED from "./deprecated.json";
import type { TagOp } from "./ops";

/**
 * iD's list of deprecated tags (`data/deprecated.json` in openstreetmap/id-tagging-schema),
 * vendored as is. In `old`, `*` is any value; in `replace`, `$1`, `$2`… are those values in
 * order, and a bare `*` is a key the mapper has to give a value.
 */
type Tags = Record<string, string | undefined>;
const ENTRIES: { old: Tags; replace?: Tags }[] = DEPRECATED;

const tag = ([k, v]: [string, string]) => `${k}=${v}`;

/** A line for each deprecated tag the object would carry once `ops` are applied, where an op writes it. */
export function deprecatedWarnings(ops: TagOp[], current: Record<string, string> = {}): string[] {
	const after = { ...current };
	for (const o of ops) {
		if (o.op === "del") delete after[o.k];
		else after[o.k] = o.v;
	}
	const written = new Set(ops.filter((o) => o.op !== "del").map((o) => o.k));
	const lines: string[] = [];
	for (const { old, replace } of ENTRIES) {
		const keys = Object.keys(old);
		if (!keys.some((k) => written.has(k))) continue;
		if (!keys.every((k) => after[k] !== undefined && (old[k] === "*" || old[k] === after[k])))
			continue;
		const wild = keys.filter((k) => old[k] === "*").map((k) => after[k]);
		const was = keys.map((k) => tag([k, after[k] ?? ""])).join(" + ");
		const by = replace
			? Object.entries(replace)
					.map(([k, v = ""]) => tag([k, v.replace(/\$(\d)/g, (_, i) => wild[i - 1] ?? "")]))
					.join(" + ")
			: null;
		lines.push(
			by
				? `${was} is deprecated: iD writes ${by} instead`
				: `${was} is deprecated, with nothing to replace it`,
		);
	}
	return lines;
}
