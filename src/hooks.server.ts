import type { Handle, ServerInit } from "@sveltejs/kit";
import { clearSessionCookie, resolveSession, SESSION_COOKIE } from "$lib/server/auth/session";
import { startBackups } from "$lib/server/backup";
import { pipeline } from "$lib/server/config";
import { db } from "$lib/server/db";
import { bootstrapAdmin } from "$lib/server/db/bootstrap";
import { runMigrations } from "$lib/server/db/migrate";

export const init: ServerInit = async () => {
	runMigrations(db);
	await bootstrapAdmin(db);
	if (pipeline.enabled) startBackups(db);
};

export const handle: Handle = ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const found = token ? resolveSession(token) : null;

	if (token && !found) clearSessionCookie(event.cookies, event.url);

	event.locals.user = found?.user ?? null;
	event.locals.session = found?.session ?? null;
	event.locals.sessionToken = found ? (token as string) : null;

	return resolve(event);
};
