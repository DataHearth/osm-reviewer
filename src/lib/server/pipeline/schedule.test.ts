import { describe, expect, it } from "vitest";
import { nextRunAt } from "./schedule";

describe("nextRunAt", () => {
	const from = new Date("2026-09-14T06:00:00Z");
	it.each([
		["every 12 h", "2026-09-14T18:00:00.000Z"],
		["daily", "2026-09-15T06:00:00.000Z"],
		["weekly", "2026-09-21T06:00:00.000Z"],
		["monthly", "2026-10-14T06:00:00.000Z"],
	] as const)("%s", (schedule, want) => {
		expect(nextRunAt(schedule, from).toISOString()).toBe(want);
	});
});
