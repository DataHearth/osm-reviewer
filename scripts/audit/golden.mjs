// Usage: pnpm exec node scripts/audit/golden.mjs <workdir> <out.json>
//
// Rebuilds the queue of every enabled registry and api source on a copy of the database and
// writes it, ids and timestamps left out, to <out.json>. Every HTTP answer is kept under
// <workdir>/http and served from there afterwards, so two runs read the same world: run it
// before and after a change that must not alter what the pipeline proposes, and diff the two
// files. GOLDEN_OFFLINE=1 fails a request that was not recorded instead of making it.
// GOLDEN_NOW=<ISO date> pins Date.now, since a 365-day survey window or an opening date in the
// future can flip between two runs on different days.
import { createHash } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { createServer } from "vite";

const [work, out] = process.argv.slice(2);
if (!work || !out) throw new Error("usage: golden.mjs <workdir> <out.json>");
const http = path.join(work, "http");
mkdirSync(http, { recursive: true });

const base = path.join(work, "base.db");
if (!existsSync(base)) {
	const live = new Database(process.env.DATABASE_PATH ?? "data/osm-reviewer.db", {
		readonly: true,
	});
	await live.backup(base);
	live.close();
	const db = new Database(base);
	db.pragma("foreign_keys = ON");
	db.exec(`
		delete from candidates;
		delete from runs;
		update sources set sync_state = null, running_since = null, failing = 0;
		update instance_settings set ntfy_on = 0, webhook_on = 0, email_on = 0;
	`);
	db.close();
}
const run = path.join(work, "run.db");
const seed = new Database(base, { readonly: true });
await seed.backup(run);
seed.close();

if (process.env.GOLDEN_NOW) {
	const now = new Date(process.env.GOLDEN_NOW).getTime();
	if (Number.isNaN(now)) throw new Error(`GOLDEN_NOW is not a date: ${process.env.GOLDEN_NOW}`);
	Date.now = () => now;
}

const real = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
	const url = String(input instanceof Request ? input.url : input);
	const key = createHash("sha1")
		.update(`${init.method ?? "GET"} ${url}\n${init.body ?? ""}`)
		.digest("hex");
	const meta = path.join(http, `${key}.json`);
	const body = path.join(http, `${key}.body`);
	if (!existsSync(meta)) {
		if (process.env.GOLDEN_OFFLINE) throw new Error(`not recorded: ${url}`);
		const res = await real(input, init);
		// A failure is answered live, so the pipeline's own retry is what gets recorded.
		if (!res.ok) return res;
		if (res.body) await pipeline(Readable.fromWeb(res.body), createWriteStream(body));
		else writeFileSync(body, "");
		const headers = Object.fromEntries(res.headers);
		// The body on disk is already decoded.
		delete headers["content-encoding"];
		delete headers["content-length"];
		writeFileSync(meta, JSON.stringify({ url, status: res.status, headers }));
	}
	const { status, headers } = JSON.parse(readFileSync(meta, "utf8"));
	return new Response(Readable.toWeb(createReadStream(body)), { status, headers });
};

const vite = await createServer({
	server: { middlewareMode: true, hmr: false, ws: false },
	appType: "custom",
	logLevel: "warn",
});
const { createDb } = await vite.ssrLoadModule("/src/lib/server/db/client.ts");
const { runSource } = await vite.ssrLoadModule("/src/lib/server/pipeline/runner.ts");
const db = createDb(run);
const sql = new Database(run);
for (const { id } of sql
	.prepare("select id from sources where kind in ('registry', 'api') order by id")
	.all()) {
	console.log(`running ${id}`);
	await runSource(db, id);
	console.log(
		sql
			.prepare("select result, fetched, cands, errors, message from runs where source_id = ?")
			.get(id),
	);
}
await vite.close();

const cols = (table, drop) =>
	sql
		.prepare(`select name from pragma_table_info('${table}')`)
		.all()
		.map((c) => `"${c.name}"`)
		.filter((c) => !drop.includes(c.slice(1, -1)))
		.join(", ");
const tags = sql.prepare(
	`select id, ${cols("candidate_tags", ["id", "candidate_id"])} from candidate_tags where candidate_id = ? order by position`,
);
const evidence = sql.prepare(
	`select id, ${cols("evidence", ["id", "tag_id", "when"])} from evidence where tag_id = ? order by id`,
);
const parts = sql.prepare(
	"select text, mark from evidence_parts where evidence_id = ? order by position",
);
const nearby = sql.prepare(
	"select label from candidate_nearby where candidate_id = ? order by position",
);
const queue = sql
	.prepare(
		`select id, ${cols("candidates", ["id", "seen_at", "fetched_at"])} from candidates order by source_id, source_record_key`,
	)
	.all()
	.map(({ id, ...c }) => ({
		...c,
		nearby: nearby.all(id).map((n) => n.label),
		tags: tags.all(id).map(({ id: tag, ...t }) => ({
			...t,
			evidence: evidence.all(tag).map(({ id: ev, ...e }) => ({ ...e, parts: parts.all(ev) })),
		})),
	}));
const runs = sql
	.prepare("select source_id, result, fetched, cands, errors, message from runs order by source_id")
	.all();
const far = sql
	.prepare("select id, json_extract(sync_state, '$.farFromAddress') far from sources order by id")
	.all();
writeFileSync(out, JSON.stringify({ runs, far, queue }, null, 1));
console.log(`${queue.length} candidates written to ${out}`);
process.exit(0);
