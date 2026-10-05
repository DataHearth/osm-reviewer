// Usage: pnpm validate
//
// Checks every mapping under mappings/ and every column renaming under sources/, and runs
// their examples. Exits 1 when anything is wrong.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({
	root,
	server: { middlewareMode: true, hmr: false, ws: false },
	appType: "custom",
	logLevel: "warn",
});
const { validate } = await vite.ssrLoadModule("/src/lib/server/pipeline/mapping/validate.ts");
const reports = validate(root);
await vite.close();

for (const { file, summary, problems } of reports) {
	console.log(
		`${file}: ${problems.length === 0 ? "ok" : "FAILED"}${summary ? `, ${summary}` : ""}`,
	);
	for (const p of problems) console.log(`  - ${p}`);
}
process.exit(reports.some((r) => r.problems.length > 0) ? 1 : 0);
