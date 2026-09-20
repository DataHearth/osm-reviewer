import { LOCKOUT_MINUTES, MAX_TRIES } from "$lib/schemas/auth";

const WINDOW_MS = LOCKOUT_MINUTES * 60 * 1000;

/**
 * Process memory rather than a table: `users` has nowhere to put an attempt
 * counter and the migration is not ours to write. The consequences are that a
 * restart clears every lock, and that behind more than one node each would count
 * its own attempts — both acceptable for a single-instance service on a LAN, and
 * both reasons this belongs in a column once the schema can carry one.
 */
const attempts = new Map<string, { tries: number; last: number }>();

interface LockoutState {
	locked: boolean;
	triesLeft: number;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function lockoutState(email: string): LockoutState {
	const entry = attempts.get(email);
	const tries = entry && Date.now() - entry.last < WINDOW_MS ? entry.tries : 0;
	return { locked: tries >= MAX_TRIES, triesLeft: Math.max(0, MAX_TRIES - tries) };
}

export function recordFailure(email: string): LockoutState {
	const now = Date.now();
	for (const [key, entry] of attempts) {
		if (now - entry.last >= WINDOW_MS) attempts.delete(key);
	}

	const tries = (attempts.get(email)?.tries ?? 0) + 1;
	attempts.set(email, { tries, last: now });
	return { locked: tries >= MAX_TRIES, triesLeft: Math.max(0, MAX_TRIES - tries) };
}

export function clearFailures(email: string): void {
	attempts.delete(email);
}
