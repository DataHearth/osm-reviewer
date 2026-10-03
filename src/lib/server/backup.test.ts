import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pruneSnapshots, snapshotName, snapshots } from "./backup";

describe("snapshots", () => {
	it("names sort chronologically and pruning keeps the newest", () => {
		const dir = mkdtempSync(join(tmpdir(), "backup-"));
		try {
			const names = [1, 2, 3, 4].map((d) => snapshotName(new Date(Date.UTC(2026, 0, d, 5, 6, 7))));
			expect(names[0]).toBe("osm-reviewer-20260101T050607Z.db");
			for (const n of [...names].reverse()) writeFileSync(join(dir, n), "x");
			writeFileSync(join(dir, "notes.txt"), "keep me");
			pruneSnapshots(dir, 2);
			expect(snapshots(dir)).toEqual(names.slice(2));
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
