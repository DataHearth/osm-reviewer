import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { users } from "./db/schema";
import { deleteUser, setDisabled, setRole } from "./users";

let dir: string;
let db: Db;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "osm-reviewer-users-"));
	db = createDb(join(dir, "test.db"));
	runMigrations(db);
	for (const id of ["a", "b"])
		db.insert(users)
			.values({ id, name: id, email: `${id}@x.test`, role: "admin", initials: id })
			.run();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const enabledAdmins = () =>
	db
		.select()
		.from(users)
		.all()
		.filter((u) => u.role === "admin" && !u.disabled)
		.map((u) => u.id);

describe("the last enabled admin", () => {
	it("survives two admins demoting each other", () => {
		expect(setRole(db, "b", "reviewer")).toBe(true);
		expect(setRole(db, "a", "reviewer")).toBe(false);
		expect(enabledAdmins()).toEqual(["a"]);
	});

	it("survives two admins disabling or deleting each other", () => {
		expect(setDisabled(db, "a", true)).toBe(true);
		expect(setDisabled(db, "b", true)).toBe(false);
		expect(deleteUser(db, "b")).toBe("last admin");
		expect(enabledAdmins()).toEqual(["b"]);
	});
});
