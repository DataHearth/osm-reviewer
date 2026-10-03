import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_PATH } from "./e2e/db";
import { E2E_ENV } from "./e2e/env";

// The browsers come from this flake's nixpkgs and resolve their own libraries. A
// LD_LIBRARY_PATH inherited from a wrapper built on another nixpkgs (claude-code's
// prepends its alsa-lib) loads libraries linked against a newer glibc than the one
// Chromium starts with, and the launch dies on `GLIBC_2.xx not found`.
delete process.env.LD_LIBRARY_PATH;

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: "e2e",
	// One SQLite file behind one server: parallel workers would race each other's
	// decisions and settings rows, so the suite buys a fixture it can reason about
	// with wall time.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
	globalSetup: "./e2e/global-setup.ts",
	use: {
		baseURL: ORIGIN,
		trace: "on-first-retry",
		// The screens animate through the `m-*` classes, all of which a
		// prefers-reduced-motion block switches off. Asking for that is both
		// cheaper and truer than waiting for an animation to finish.
		reducedMotion: "reduce",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		// The adapter-node output rather than `vite preview`: it is what ships, and
		// it is the one that applies the migrations at boot.
		command: "pnpm build && node build/index.js",
		url: ORIGIN,
		// A server left over from an earlier run would be holding its own database,
		// which is the one thing the seeded fixture cannot survive.
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			DATABASE_PATH: E2E_DATABASE_PATH,
			HOST: "127.0.0.1",
			PORT: String(PORT),
			// Pinned so the origin SvelteKit checks a form POST against is the same
			// one the browser sends, however the host resolves.
			ORIGIN,
			...E2E_ENV,
		},
	},
});
