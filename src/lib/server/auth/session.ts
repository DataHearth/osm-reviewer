import { randomBytes } from "node:crypto";
import type { Cookies } from "@sveltejs/kit";
import { eq, lt } from "drizzle-orm";
import { dev } from "$app/environment";
import { stamp } from "$lib/format";
import { SESSION_DAYS } from "$lib/schemas/auth";
import { db } from "$lib/server/db";
import { sessions, users } from "$lib/server/db/schema";
import type { Session, User } from "$lib/types";

export const SESSION_COOKIE = "osm-session";

/** The value arrives from a query string or a cookie, so only same-site paths are honoured.
    Browsers drop tabs and newlines from a URL and read `\` as `/`, so `/\t/evil.com` and
    `/\evil.com` are both `//evil.com`: either kind of character refuses the value outright. */
export function safePath(value: string | null | undefined): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
	if (!value?.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(value)) return "/";
	return new URL(value, "http://x").origin === "http://x" ? value : "/";
}

/**
 * Sessions are long-lived on purpose: the instance sits on a trusted LAN and a
 * sign-in is meant to survive reloads and restarts. The row still carries a real
 * expiry so an abandoned browser eventually stops being a way in.
 */
const TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Extending on every request would turn each page load into a write. A session is
 * only pushed back out once it has burned a day of its life, which keeps reads
 * read-only for all but the first request of the day.
 */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

interface ResolvedSession {
	user: User;
	session: Session;
	/** The expiry was pushed out, so the cookie's has to follow. */
	refreshed: boolean;
}

export function createSession(userId: string, via: Session["via"]): string {
	const token = randomBytes(32).toString("base64url");
	const now = new Date();

	db.transaction((tx) => {
		tx.delete(sessions).where(lt(sessions.expiresAt, now)).run();
		tx.insert(sessions)
			.values({ token, userId, via, createdAt: now, expiresAt: new Date(+now + TTL_MS) })
			.run();
		tx.update(users).set({ lastSeen: now }).where(eq(users.id, userId)).run();
	});

	return token;
}

export function resolveSession(token: string): ResolvedSession | null {
	const row = db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.token, token))
		.get();
	if (!row) return null;

	// Disabling deletes the sessions, but a sign-in already past its own check can still
	// write one afterwards; this is where that session is refused.
	if (row.user.disabled) {
		db.delete(sessions).where(eq(sessions.userId, row.user.id)).run();
		return null;
	}

	const now = new Date();
	if (+row.session.expiresAt <= +now) {
		deleteSession(token);
		return null;
	}

	const refreshed = +row.session.expiresAt - +now < TTL_MS - REFRESH_AFTER_MS;
	if (refreshed) {
		db.transaction((tx) => {
			tx.update(sessions)
				.set({ expiresAt: new Date(+now + TTL_MS) })
				.where(eq(sessions.token, token))
				.run();
			tx.update(users).set({ lastSeen: now }).where(eq(users.id, row.user.id)).run();
		});
	}

	return {
		user: toUser(row.user),
		session: { email: row.user.email, via: row.session.via, at: stamp(row.session.createdAt) },
		refreshed,
	};
}

export function deleteSession(token: string): void {
	db.delete(sessions).where(eq(sessions.token, token)).run();
}

// `secure` follows the request scheme rather than just !dev: a browser silently drops a
// Secure cookie over plain http, so pinning it on would make sign-in fail with no error on
// an http:// LAN deployment. Behind a TLS-terminating proxy adapter-node only reports https
// here once PROTOCOL_HEADER is set, which the NixOS module passes through `environment`.
export const cookieOptions = (url: URL) =>
	({
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: !dev && url.protocol === "https:",
	}) as const;

export function setSessionCookie(cookies: Cookies, url: URL, token: string): void {
	cookies.set(SESSION_COOKIE, token, { ...cookieOptions(url), maxAge: TTL_MS / 1000 });
}

export function clearSessionCookie(cookies: Cookies, url: URL): void {
	cookies.delete(SESSION_COOKIE, cookieOptions(url));
}

function toUser(row: typeof users.$inferSelect): User {
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		role: row.role,
		initials: row.initials,
		ssoOnly: row.passwordHash === null,
		lastSeen: row.lastSeen ? stamp(row.lastSeen) : "never",
	};
}
