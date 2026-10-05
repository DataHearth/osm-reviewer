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

import { safePath } from "./session";

afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
