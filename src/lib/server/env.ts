import { existsSync } from "node:fs";

/**
 * Vite reads the `.env` files for `vite dev` and hands them to `$env/dynamic/private`, but
 * drizzle-kit runs outside Vite and would otherwise see only the shell. `loadEnvFile` never
 * overwrites a variable that is already set, so the order here is first-wins: the shell
 * beats every file — which is what keeps the e2e server, whose database path is handed to it
 * through the environment, pointed at its temporary directory — and a mode-specific file
 * beats the shared one.
 */
export function loadEnvFiles(mode = process.env.NODE_ENV || "development"): void {
	for (const file of [`.env.${mode}.local`, `.env.${mode}`, ".env.local", ".env"]) {
		if (existsSync(file)) process.loadEnvFile(file);
	}
}
