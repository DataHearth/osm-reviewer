import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCKOUT_MINUTES, MAX_TRIES } from "$lib/schemas/auth";
import { clearAttempts, lockoutState, normalizeEmail, recordAttempt } from "./lockout";

// The counter is module-level state shared across this file, so every test works on
// its own address and hands it back clean.
let seq = 0;
const freshEmail = () => `user${seq++}@example.test`;
const used: string[] = [];
const take = () => {
	const email = freshEmail();
	used.push(email);
	return email;
};

afterEach(() => {
	for (const email of used.splice(0)) clearAttempts(email);
	vi.useRealTimers();
});

describe("normalizeEmail", () => {
	it("trims and lowercases, so a lock cannot be dodged by changing case", () => {
		expect(normalizeEmail("  Antoine@Example.TEST ")).toBe("antoine@example.test");
	});
});

describe("lockoutState", () => {
	it("starts unlocked with the full allowance", () => {
		expect(lockoutState(take())).toEqual({ locked: false, triesLeft: MAX_TRIES });
	});
});

describe("recordAttempt", () => {
	it("counts down and locks on the last allowed attempt", () => {
		const email = take();
		for (let i = 1; i < MAX_TRIES; i++) {
			expect(recordAttempt(email)).toEqual({ locked: false, triesLeft: MAX_TRIES - i });
		}
		expect(recordAttempt(email)).toEqual({ locked: true, triesLeft: 0 });
	});

	it("never reports a negative allowance once past the limit", () => {
		const email = take();
		for (let i = 0; i < MAX_TRIES + 3; i++) recordAttempt(email);
		expect(lockoutState(email)).toEqual({ locked: true, triesLeft: 0 });
	});

	it("locks one address without touching another", () => {
		const locked = take();
		const other = take();
		for (let i = 0; i < MAX_TRIES; i++) recordAttempt(locked);
		expect(lockoutState(locked).locked).toBe(true);
		expect(lockoutState(other).locked).toBe(false);
	});
});

describe("the lockout window", () => {
	it("expires on its own after the window passes", () => {
		vi.useFakeTimers();
		const email = take();
		for (let i = 0; i < MAX_TRIES; i++) recordAttempt(email);
		expect(lockoutState(email).locked).toBe(true);

		vi.advanceTimersByTime(LOCKOUT_MINUTES * 60 * 1000);
		expect(lockoutState(email)).toEqual({ locked: false, triesLeft: MAX_TRIES });
	});

	it("is a rolling window — a fresh failure re-arms it", () => {
		vi.useFakeTimers();
		const email = take();
		for (let i = 0; i < MAX_TRIES - 1; i++) recordAttempt(email);

		vi.advanceTimersByTime(LOCKOUT_MINUTES * 60 * 1000 - 1000);
		expect(recordAttempt(email).locked).toBe(true);
	});
});

describe("clearAttempts", () => {
	it("returns the address to its full allowance", () => {
		const email = take();
		for (let i = 0; i < MAX_TRIES; i++) recordAttempt(email);
		clearAttempts(email);
		expect(lockoutState(email)).toEqual({ locked: false, triesLeft: MAX_TRIES });
	});

	it("clears only the address named", () => {
		const cleared = take();
		const kept = take();
		for (let i = 0; i < MAX_TRIES; i++) {
			recordAttempt(cleared);
			recordAttempt(kept);
		}
		clearAttempts(cleared);
		expect(lockoutState(cleared).locked).toBe(false);
		expect(lockoutState(kept).locked).toBe(true);
	});
});
