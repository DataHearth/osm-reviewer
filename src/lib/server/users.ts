import { randomUUID } from "node:crypto";
import { and, count, eq, ne, sql, TransactionRollbackError } from "drizzle-orm";
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

/** Whether another account holds the address, in any case; `except` is the account asking. */
/**
 * An SSO sign-in is linked to the local account holding its address, so while SSO is on an
 * account naming its own address could wait for someone else's first sign-in and share their
 * account. An admin can create an account under any address anyway.
 */
export const emailLocked = (user: { role: Role }, ssoOn: boolean) => ssoOn && user.role !== "admin";

export const emailTaken = (db: Db, email: string, except?: string) =>
	!!db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(sql`lower(${users.email})`, email.toLowerCase()),
				except ? ne(users.id, except) : undefined,
			),
		)
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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Applies `write` only if an enabled admin is left after it; false when it was undone.
 * Refusing an admin their own row is not enough on its own: two admins demoting each
 * other were each checked as admins before either write landed.
 */
function keepingAnAdmin(db: Db, write: (tx: Tx) => void): boolean {
	try {
		db.transaction((tx) => {
			write(tx);
			const admins = tx
				.select({ n: count() })
				.from(users)
				.where(and(eq(users.role, "admin"), eq(users.disabled, false)))
				.get();
			if (!admins?.n) tx.rollback();
		});
		return true;
	} catch (err) {
		if (err instanceof TransactionRollbackError) return false;
		throw err;
	}
}

export function setRole(db: Db, id: string, role: Role): boolean {
	return keepingAnAdmin(db, (tx) => tx.update(users).set({ role }).where(eq(users.id, id)).run());
}

/** Disabling also ends every live session, or the account would stay in until they expired. */
export function setDisabled(db: Db, id: string, disabled: boolean): boolean {
	return keepingAnAdmin(db, (tx) => {
		tx.update(users).set({ disabled }).where(eq(users.id, id)).run();
		if (disabled) tx.delete(sessions).where(eq(sessions.userId, id)).run();
	});
}

/**
 * Decisions keep pointing at their reviewer for the audit trail, so an account that has
 * decided anything cannot be deleted — only disabled. Returns why it was refused, if it was.
 */
export function deleteUser(db: Db, id: string): "decisions" | "last admin" | null {
	const decided = db.select({ n: count() }).from(decisions).where(eq(decisions.userId, id)).get();
	if (decided && decided.n > 0) return "decisions";
	return keepingAnAdmin(db, (tx) => tx.delete(users).where(eq(users.id, id)).run())
		? null
		: "last admin";
}
