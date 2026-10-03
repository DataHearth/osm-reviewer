import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { runMigrations } from "../db/migrate";
import { users } from "../db/schema";
import { ssoUser } from "./sso-user";

const GROUP = "osm-reviewers";
const member = (claims: Record<string, unknown>) => ({ sub: "sub-1", groups: [GROUP], ...claims });

let dir: string;
let db: Db;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-sso-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	db.insert(users)
		.values({
			id: "u1",
			name: "Ada",
			email: "Ada@example.test",
			role: "admin",
			initials: "A",
			passwordHash: "x",
		})
		.run();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const row = (id: string) => db.select().from(users).where(eq(users.id, id)).get();

describe("ssoUser", () => {
	it("refuses an account outside the group, and anyone when the claim is missing", () => {
		expect(ssoUser(db, { sub: "s", groups: ["other"] }, GROUP)).toEqual({ refused: "group" });
		expect(ssoUser(db, { sub: "s", email: "x@example.test" }, GROUP)).toEqual({ refused: "group" });
	});

	it("skips the gate when no group is configured", () => {
		expect(ssoUser(db, { sub: "s", email: "new@example.test" }, "")).toHaveProperty("id");
	});

	it("creates a reviewer on first sign-in", () => {
		const found = ssoUser(db, member({ email: "new@example.test", name: "Grace Hopper" }), GROUP);
		if (!("id" in found)) throw new Error("refused");
		expect(row(found.id)).toMatchObject({
			email: "new@example.test",
			role: "reviewer",
			initials: "GH",
			ssoSubject: "sub-1",
			passwordHash: null,
		});
	});

	it("links an existing row by verified address, case-insensitively, then matches on sub", () => {
		expect(
			ssoUser(db, member({ email: "ada@example.test", email_verified: true }), GROUP),
		).toMatchObject({ id: "u1" });
		expect(row("u1")?.ssoSubject).toBe("sub-1");
		expect(ssoUser(db, member({ email: "renamed@example.test" }), GROUP)).toMatchObject({
			id: "u1",
		});
	});

	it("never links by an unverified address", () => {
		expect(ssoUser(db, member({ email: "ada@example.test" }), GROUP)).toEqual({ refused: "taken" });
		expect(row("u1")?.ssoSubject).toBeNull();
	});

	it("never relinks a row another subject already owns", () => {
		db.update(users).set({ ssoSubject: "someone-else" }).where(eq(users.id, "u1")).run();
		expect(ssoUser(db, member({ email: "ada@example.test", email_verified: true }), GROUP)).toEqual(
			{ refused: "taken" },
		);
	});

	it("refuses a disabled account, linked or not", () => {
		db.update(users).set({ disabled: true }).where(eq(users.id, "u1")).run();
		expect(ssoUser(db, member({ email: "ada@example.test", email_verified: true }), GROUP)).toEqual(
			{ refused: "disabled" },
		);
		db.update(users).set({ ssoSubject: "sub-1" }).where(eq(users.id, "u1")).run();
		expect(ssoUser(db, member({}), GROUP)).toEqual({ refused: "disabled" });
	});

	it("refuses when the provider shares no address", () => {
		expect(ssoUser(db, member({}), GROUP)).toEqual({ refused: "email" });
	});
});
