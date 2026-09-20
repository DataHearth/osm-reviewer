import { cpSync, existsSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * The node server runs migrations at boot, so `build/` has to carry them. Must stay
 * after sveltekit() in the plugin list: the adapter wipes and writes `build/` from its
 * own closeBundle, and vite runs closeBundle hooks in plugin order.
 */
const copyMigrations: Plugin = {
	name: "osm-reviewer:copy-migrations",
	apply: "build",
	closeBundle() {
		if (existsSync("drizzle") && existsSync("build")) {
			cpSync("drizzle", "build/drizzle", { recursive: true });
		}
	},
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), copyMigrations],
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
		globals: false,
	},
});
