import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "$lib/server/db/client";
import { users } from "$lib/server/db/schema";
import { clearAttempts, lockoutState, recordAttempt } from "./lockout";
import { hashPassword, verifyPassword } from "./password";

export type PasswordSignIn =
	| { ok: true; user: typeof users.$inferSelect }
	| { ok: false; refused: "locked" | "disabled" | "sso-only" }
	| { ok: false; refused: "wrong"; triesLeft: number };

let decoy: Promise<string> | undefined;

/**
 * The attempt is counted before the password is checked, with no await between the lock
 * check and the count: counted after, every post sent while scrypt runs would pass the
 * check, and N parallel posts would be N guesses.
 *
 * An address with no account is answered as a wrong password, after the same scrypt
 * against a decoy hash, so neither the reply nor its timing says which addresses exist.
 */
export async function passwordSignIn(
	db: Db,
	email: string,
	password: string,
): Promise<PasswordSignIn> {
	if (lockoutState(email).locked) return { ok: false, refused: "locked" };
	const attempt = recordAttempt(email);

	const user = db
		.select()
		.from(users)
		.where(eq(sql`lower(${users.email})`, email))
		.get();
	if (user?.disabled) return { ok: false, refused: "disabled" };
	if (user && user.passwordHash === null) return { ok: false, refused: "sso-only" };

	decoy ??= hashPassword(randomBytes(16).toString("hex"));
	const ok = await verifyPassword(password, user?.passwordHash ?? (await decoy));
	if (user && ok) {
		clearAttempts(email);
		return { ok: true, user };
	}
	if (attempt.locked) return { ok: false, refused: "locked" };
	return { ok: false, refused: "wrong", triesLeft: attempt.triesLeft };
}
