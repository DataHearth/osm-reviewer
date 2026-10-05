import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_TRIES } from "$lib/schemas/auth";
import { createDb, type Db } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { hashPassword } from "./password";
import { passwordSignIn } from "./sign-in";

let dir: string;
let db: Db;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-sign-in-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	db.insert(users)
		.values({
			id: "u1",
			name: "Ada",
			email: "ada@example.test",
			role: "reviewer",
			initials: "A",
			passwordHash: await hashPassword("right"),
		})
		.run();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("passwordSignIn", () => {
	it("gives parallel guesses no more than the allowance between them", async () => {
		const results = await Promise.all(
			Array.from({ length: MAX_TRIES + 3 }, () => passwordSignIn(db, "ada@example.test", "wrong")),
		);
		// The last allowed guess is answered as the lock it triggers.
		const refused = (why: string) => results.filter((r) => !r.ok && r.refused === why).length;
		expect(refused("wrong")).toBe(MAX_TRIES - 1);
		expect(refused("locked")).toBe(results.length - (MAX_TRIES - 1));
		expect(await passwordSignIn(db, "ada@example.test", "right")).toEqual({
			ok: false,
			refused: "locked",
		});
	});

	it("answers an unknown address exactly as a wrong password", async () => {
		expect(await passwordSignIn(db, "nobody@example.test", "x")).toEqual({
			ok: false,
			refused: "wrong",
			triesLeft: MAX_TRIES - 1,
		});
	});
});
