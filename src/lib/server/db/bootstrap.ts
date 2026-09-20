import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password";
import { seedAdmin } from "../config";
import type { Db } from "./client";
import { users } from "./schema";

export const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word[0] ?? "")
		.join("")
		.toUpperCase();

/**
 * A production build carries no seed — that script loads fixtures and wipes every table —
 * so without this a fresh deployment has no account and nobody can sign in. It only fills
 * an empty users table: once anyone exists the values are ignored, so leaving them set
 * cannot reset a password that was later changed in the app.
 */
export async function bootstrapAdmin(db: Db, admin = seedAdmin): Promise<boolean> {
	if (!admin.email || !admin.password) return false;
	if (db.select({ id: users.id }).from(users).limit(1).get()) return false;

	const name = admin.name || admin.email.split("@")[0];
	db.insert(users)
		.values({
			id: randomUUID(),
			name,
			email: admin.email,
			role: "admin",
			initials: initialsOf(name),
			passwordHash: await hashPassword(admin.password),
		})
		.run();
	return true;
}
