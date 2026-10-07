import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { compile, type Program } from "./compile";
import {
	type Mapping,
	mappingSchema,
	type OfficialRenaming,
	type Renaming,
	renamingSchema,
} from "./schema";

/**
 * Bundled to a different depth in dev than in the adapter-node output, so the folder is found
 * by walking up from this module, as the migrations are: the repository root in dev, `build/`
 * in production, where vite.config.ts copies `mappings/` and `sources/`.
 */
function root(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		if (existsSync(join(dir, "mappings"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`no mappings/ folder above ${import.meta.url}`);
		dir = parent;
	}
}

const read = (path: string) => parse(readFileSync(join(root(), path), "utf8"));

const renamings = new Map<string, Renaming>();
const mappings = new Map<string, Mapping>();

/** The column renaming the app ships for a source, such as `fr/irve`. */
export function renamingFor(source: string): Renaming {
	const known = renamings.get(source);
	if (known) return known;
	const renaming = renamingSchema.parse(read(`sources/${source}.yaml`));
	renamings.set(source, renaming);
	return renaming;
}

/** A mapping the app ships, by its id such as `FR:school`. */
export function mappingFor(id: string): Mapping {
	const known = mappings.get(id);
	if (known) return known;
	const [country, kind] = id.toLowerCase().split(":");
	const mapping = mappingSchema.parse(read(`mappings/${country}/${kind}.yaml`));
	mappings.set(id, mapping);
	return mapping;
}

/** Every mapping the app ships, read from `mappings/` so a new file is offered without a code change. */
export function shippedMappings(): { id: string; title: string }[] {
	const base = join(root(), "mappings");
	return readdirSync(base, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.flatMap((d) =>
			readdirSync(join(base, d.name))
				.filter((f) => f.endsWith(".yaml"))
				.map((f) => `${d.name}/${f}`),
		)
		.map((f) => {
			const { id, title } = mappingSchema.parse(read(`mappings/${f}`));
			return { id, title };
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

let shipped: OfficialRenaming[] | null = null;

/** Every shipped source that carries an `official:` block, read from `sources/` so a new file is offered without a code change. */
export function shippedSources(): OfficialRenaming[] {
	if (shipped) return shipped;
	const base = join(root(), "sources");
	shipped = readdirSync(base, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.flatMap((d) =>
			readdirSync(join(base, d.name))
				.filter((f) => f.endsWith(".yaml"))
				.map((f) => renamingFor(`${d.name}/${f.slice(0, -".yaml".length)}`)),
		)
		.filter((r): r is OfficialRenaming => r.official !== undefined)
		.sort((a, b) => a.source.localeCompare(b.source));
	return shipped;
}

const programs = new Map<string, Program>();

/**
 * A source's column renaming over its mapping, compiled once; a file that does not check throws.
 * Without overrides it is the mapping's own rules, which is what a source the app does not ship
 * is read by: the overrides state what one shipped source's data needs, not what any source needs.
 */
export function programFor(source: string, { overrides = true } = {}): Program {
	const id = overrides ? source : `${source}#plain`;
	const known = programs.get(id);
	if (known) return known;
	const renaming = renamingFor(source);
	const { program, problems } = compile(
		mappingFor(renaming.mapping),
		overrides ? renaming : { ...renaming, overrides: undefined },
	);
	if (!program) throw new Error(`${source}: ${problems.join("; ")}`);
	programs.set(id, program);
	return program;
}
