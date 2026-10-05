import type { Handle, ServerInit } from "@sveltejs/kit";
import { requireSession } from "$lib/server/auth/guard";
import { clearSessionCookie, resolveSession, SESSION_COOKIE } from "$lib/server/auth/session";
import { startBackups } from "$lib/server/backup";
import { pipeline } from "$lib/server/config";
import { db } from "$lib/server/db";
import { bootstrapAdmin } from "$lib/server/db/bootstrap";
import { runMigrations } from "$lib/server/db/migrate";
import { startPipeline } from "$lib/server/pipeline/runner";

export const init: ServerInit = async () => {
	runMigrations(db);
	await bootstrapAdmin(db);
	startPipeline(db);
	if (pipeline.enabled) startBackups(db);
};

export const handle: Handle = ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	const found = token ? resolveSession(token) : null;

	if (token && !found) clearSessionCookie(event.cookies, event.url);

	event.locals.user = found?.user ?? null;
	event.locals.session = found?.session ?? null;
	event.locals.sessionToken = found ? (token as string) : null;

	requireSession(event);
	return resolve(event);
};
