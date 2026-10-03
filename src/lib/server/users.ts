import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { stamp } from "$lib/format";
import type { NewUserForm } from "$lib/schemas/settings";
import { hashPassword } from "$lib/server/auth/password";
import { initialsOf } from "$lib/server/db/bootstrap";
import type { Db } from "$lib/server/db/client";
import { decisions, sessions, users } from "$lib/server/db/schema";
import type { ManagedUser, Role } from "$lib/types";

export function listUsers(db: Db): ManagedUser[] {
	const decided = db
		.select({ userId: decisions.userId, n: count().as("n") })
		.from(decisions)
		.groupBy(decisions.userId)
		.as("decided");

	return db
		.select({ user: users, n: decided.n })
		.from(users)
		.leftJoin(decided, eq(decided.userId, users.id))
		.orderBy(users.name)
		.all()
		.map(({ user, n }) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			initials: user.initials,
			password: user.passwordHash !== null,
			sso: user.ssoSubject !== null,
			disabled: user.disabled,
			lastSeen: user.lastSeen ? stamp(user.lastSeen) : "never",
			decisions: n ?? 0,
		}));
}

export const emailTaken = (db: Db, email: string) =>
	!!db
		.select({ id: users.id })
		.from(users)
		.where(eq(sql`lower(${users.email})`, email.toLowerCase()))
		.get();

/** An empty password makes an SSO-only account, which links on its first sign-in by address. */
export async function createUser(db: Db, v: NewUserForm) {
	db.insert(users)
		.values({
			id: randomUUID(),
			name: v.name,
			email: v.email,
			role: v.role,
			initials: initialsOf(v.name),
			passwordHash: v.password ? await hashPassword(v.password) : null,
		})
		.run();
}

export function setRole(db: Db, id: string, role: Role) {
	db.update(users).set({ role }).where(eq(users.id, id)).run();
}

/** Disabling also ends every live session, or the account would stay in until they expired. */
export function setDisabled(db: Db, id: string, disabled: boolean) {
	db.transaction((tx) => {
		tx.update(users).set({ disabled }).where(eq(users.id, id)).run();
		if (disabled) tx.delete(sessions).where(eq(sessions.userId, id)).run();
	});
}

/**
 * Decisions keep pointing at their reviewer for the audit trail, so an account that has
 * decided anything cannot be deleted — only disabled. Returns false when that refusal applies.
 */
export function deleteUser(db: Db, id: string): boolean {
	const decided = db.select({ n: count() }).from(decisions).where(eq(decisions.userId, id)).get();
	if (decided && decided.n > 0) return false;
	db.delete(users).where(eq(users.id, id)).run();
	return true;
}
