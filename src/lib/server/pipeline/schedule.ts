import type { SCHEDULES } from "$lib/schemas/source";

type Schedule = (typeof SCHEDULES)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const EVERY: Record<Schedule, number> = {
	"every 12 h": 12 * HOUR,
	daily: DAY,
	weekly: 7 * DAY,
	monthly: 30 * DAY,
};

/** Fixed intervals from the run's start: a weekly source drifts by its run time, which no one needs to see. */
export function nextRunAt(schedule: Schedule, from: Date): Date {
	return new Date(from.getTime() + EVERY[schedule]);
}

/** A failed run retries soon rather than waiting out a month. */
export const RETRY_AFTER_MS = HOUR;
/** This many failed runs in a row and the source is held until someone runs it by hand. */
export const HOLD_AFTER_FAILURES = 3;
