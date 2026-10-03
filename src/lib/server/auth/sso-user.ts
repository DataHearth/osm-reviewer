import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { sso } from "$lib/server/config";
import { initialsOf } from "$lib/server/db/bootstrap";
import type { Db } from "$lib/server/db/client";
import { users } from "$lib/server/db/schema";

/** Why an SSO sign-in that the provider completed is still refused here. */
export type Refusal = "group" | "email" | "taken" | "disabled";

export interface Claims {
	sub: string;
	[claim: string]: unknown;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Matches on `sub`, which the provider never reassigns. An existing row is linked by
 * address once, and only when the provider says it verified that address: otherwise
 * anyone able to set their own email there could take over the local account that owns
 * it. Nobody matched means a new reviewer — the group gate is what decides who may.
 */
export function ssoUser(
	db: Db,
	claims: Claims,
	group = sso.group,
): { id: string } | { refused: Refusal } {
	if (group && !(Array.isArray(claims.groups) && claims.groups.includes(group))) {
		return { refused: "group" };
	}

	const linked = db.select().from(users).where(eq(users.ssoSubject, claims.sub)).get();
	if (linked) return linked.disabled ? { refused: "disabled" } : linked;

	const email = text(claims.email);
	if (!email) return { refused: "email" };

	const existing = db
		.select()
		.from(users)
		.where(eq(sql`lower(${users.email})`, email.toLowerCase()))
		.get();
	if (existing) {
		if (existing.ssoSubject !== null || claims.email_verified !== true) return { refused: "taken" };
		if (existing.disabled) return { refused: "disabled" };
		db.update(users).set({ ssoSubject: claims.sub }).where(eq(users.id, existing.id)).run();
		return existing;
	}

	const name = text(claims.name) || text(claims.preferred_username) || email.split("@")[0];
	const id = randomUUID();
	db.insert(users)
		.values({
			id,
			name,
			email,
			role: "reviewer",
			initials: initialsOf(name),
			ssoSubject: claims.sub,
		})
		.run();
	return { id };
}
