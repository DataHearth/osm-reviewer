import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	return mkdtempSync(`${tmpdir()}/osm-reviewer-session-`);
});

vi.mock("$lib/server/db", async () => {
	const { createDb } = await import("../db/client");
	const { runMigrations } = await import("../db/migrate");
	const db = createDb(join(dir, "test.db"));
	runMigrations(db);
	return { db };
});

import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { sessions, users } from "../db/schema";
import { createSession, resolveSession, safePath } from "./session";

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveSession", () => {
	it("refuses a disabled account's session and deletes all of them", () => {
		db.insert(users)
			.values({ id: "u1", name: "Ada", email: "ada@x.test", role: "reviewer", initials: "A" })
			.run();
		const token = createSession("u1", "sso");
		createSession("u1", "password");
		expect(resolveSession(token)?.user.id).toBe("u1");

		db.update(users).set({ disabled: true }).where(eq(users.id, "u1")).run();
		expect(resolveSession(token)).toBeNull();
		expect(db.select().from(sessions).where(eq(sessions.userId, "u1")).all()).toEqual([]);
	});

	it("says when it pushed the expiry out, so the cookie can follow", () => {
		db.insert(users)
			.values({ id: "u2", name: "Bo", email: "bo@x.test", role: "reviewer", initials: "B" })
			.run();
		const token = createSession("u2", "password");
		expect(resolveSession(token)?.refreshed).toBe(false);

		const row = db.select().from(sessions).where(eq(sessions.token, token)).get();
		const aged = new Date(+(row?.expiresAt ?? 0) - 2 * 24 * 3_600_000);
		db.update(sessions).set({ expiresAt: aged }).where(eq(sessions.token, token)).run();
		expect(resolveSession(token)?.refreshed).toBe(true);
		expect(resolveSession(token)?.refreshed).toBe(false);
	});
});

describe("safePath", () => {
	it("keeps a same-site path with its query", () => {
		expect(safePath("/review?id=c1&sort=conf")).toBe("/review?id=c1&sort=conf");
	});

	it("refuses anything a browser would read as another host", () => {
		for (const value of [
			"//evil.com",
			"/\\evil.com",
			"/\t/evil.com",
			"/\n/evil.com",
			"/\r/evil.com",
			"/x\\..\\..\\/evil.com",
			"https://evil.com",
			"evil.com",
			"",
			null,
			undefined,
		]) {
			expect(safePath(value), JSON.stringify(value)).toBe("/");
		}
	});
});
