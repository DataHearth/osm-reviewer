import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { compile, type Program } from "./compile";
import { mappingSchema, renamingSchema } from "./schema";

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

const programs = new Map<string, Program>();

/** A source's column renaming over its mapping, compiled once; a file that does not check throws. */
export function programFor(source: string): Program {
	const known = programs.get(source);
	if (known) return known;
	const renaming = renamingSchema.parse(read(`sources/${source}.yaml`));
	const [country, kind] = renaming.mapping.toLowerCase().split(":");
	const mapping = mappingSchema.parse(read(`mappings/${country}/${kind}.yaml`));
	const { program, problems } = compile(mapping, renaming);
	if (!program) throw new Error(`${source}: ${problems.join("; ")}`);
	programs.set(source, program);
	return program;
}
