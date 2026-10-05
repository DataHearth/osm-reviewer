import { cpSync, existsSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * The node server runs migrations at boot and reads the mapping files, so `build/` has to
 * carry `drizzle/`, `mappings/` and `sources/`. Must stay after sveltekit() in the plugin
 * list: the adapter wipes and writes `build/` from its own closeBundle, and vite runs
 * closeBundle hooks in plugin order.
 */
const copyRuntimeFiles: Plugin = {
	name: "osm-reviewer:copy-runtime-files",
	apply: "build",
	closeBundle() {
		if (!existsSync("build")) return;
		for (const dir of ["drizzle", "mappings", "sources"]) {
			if (existsSync(dir)) cpSync(dir, `build/${dir}`, { recursive: true });
		}
	},
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), copyRuntimeFiles],
	// direnv keeps the flake inputs' sources under .direnv; every Nix build touches them
	// and Vite answers each touched tsconfig with a full page reload.
	server: { watch: { ignored: ["**/.direnv/**"] } },
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		globals: false,
	},
});
