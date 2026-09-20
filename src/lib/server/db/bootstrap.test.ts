import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../auth/password";
import { bootstrapAdmin } from "./bootstrap";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";
import { users } from "./schema";

const admin = { name: "Ada Admin", email: "ada@example.test", password: "correct horse" };

let dir: string;
let db: Db;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-bootstrap-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("bootstrapAdmin", () => {
	it("creates the admin on an empty users table", async () => {
		expect(await bootstrapAdmin(db, admin)).toBe(true);
		const [row] = db.select().from(users).all();
		expect(row).toMatchObject({ email: admin.email, role: "admin", initials: "AA" });
		expect(await verifyPassword(admin.password, row.passwordHash)).toBe(true);
	});

	it("does nothing once any user exists, so a changed password is never reset", async () => {
		await bootstrapAdmin(db, admin);
		expect(await bootstrapAdmin(db, { ...admin, email: "other@example.test" })).toBe(false);
		expect(db.select().from(users).all()).toHaveLength(1);
	});

	it("does nothing without both an email and a password", async () => {
		expect(await bootstrapAdmin(db, { ...admin, password: undefined })).toBe(false);
		expect(db.select().from(users).all()).toHaveLength(0);
	});
});
