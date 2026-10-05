import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, expect, it } from "vitest";
import { createDb } from "./client";
import { runMigrations } from "./migrate";

const DRIZZLE = fileURLToPath(new URL("../../../../drizzle", import.meta.url));
/** The last migration before 0005, whose table rebuilds cascaded through their children. */
const BEFORE_REBUILD = 4;

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The migrations folder as it stood at `last`, so a database can be built in that old shape. */
function migrationsUpTo(last: number): string {
	const out = join(dir, "drizzle");
	mkdirSync(join(out, "meta"), { recursive: true });
	const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8"));
	journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= last);
	writeFileSync(join(out, "meta", "_journal.json"), JSON.stringify(journal));
	for (const e of journal.entries as { tag: string }[])
		copyFileSync(join(DRIZZLE, `${e.tag}.sql`), join(out, `${e.tag}.sql`));
	return out;
}

it("keeps the rows that reference a rebuilt table", () => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-migrate-"));
	const db = createDb(join(dir, "test.db"));
	migrate(db, { migrationsFolder: migrationsUpTo(BEFORE_REBUILD) });

	const sqlite = db.$client;
	/** One row in the old shape: the named values, and a placeholder for every other required column. */
	const insert = (table: string, values: Record<string, unknown>) => {
		const cols = sqlite.prepare(`pragma table_info(${table})`).all() as {
			name: string;
			type: string;
			notnull: number;
			dflt_value: unknown;
			pk: number;
		}[];
		const row: Record<string, unknown> = {};
		for (const c of cols) {
			if (c.name in values) row[c.name] = values[c.name];
			else if (c.notnull && c.dflt_value === null && !c.pk)
				row[c.name] = /INT|REAL/.test(c.type) ? 1 : "x";
		}
		const keys = Object.keys(row);
		sqlite
			.prepare(`insert into ${table} (${keys.join(",")}) values (${keys.map(() => "?").join(",")})`)
			.run(...keys.map((k) => row[k]));
	};
	insert("users", { id: "u1", email: "a@example.test", role: "admin" });
	insert("sources", { id: "s1", kind: "api", health: "ok" });
	insert("areas", { id: "a1", def: "radius" });
	insert("area_sources", { area_id: "a1", source_id: "s1" });
	insert("candidates", { id: "c1", area_id: "a1", source_id: "s1", type: "update" });
	insert("candidate_tags", { candidate_id: "c1", op: "add" });
	insert("candidate_decisions", { candidate_id: "c1", kind: "accepted", user_id: "u1" });

	runMigrations(db);

	const count = (table: string) =>
		(sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
	for (const table of ["area_sources", "candidates", "candidate_tags", "candidate_decisions"])
		expect([table, count(table)]).toEqual([table, 1]);
	expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
});
