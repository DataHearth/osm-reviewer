import { error, redirect } from "@sveltejs/kit";
import { finishSignIn, takePending } from "$lib/server/auth/oidc";
import { createSession, safePath, setSessionCookie } from "$lib/server/auth/session";
import { type Claims, ssoUser } from "$lib/server/auth/sso-user";
import { sso } from "$lib/server/config";
import { db } from "$lib/server/db";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!sso.enabled) error(404);

	const pending = takePending(cookies, url);
	if (!pending) redirect(303, "/login?sso=expired");

	let claims: Claims;
	try {
		claims = await finishSignIn(url, pending);
	} catch (err) {
		console.error(`SSO sign-in against ${sso.issuer} failed:`, err);
		redirect(303, "/login?sso=failed");
	}

	const found = ssoUser(db, claims);
	if ("refused" in found) redirect(303, `/login?sso=${found.refused}`);

	setSessionCookie(cookies, url, createSession(found.id, "sso"));
	redirect(303, safePath(pending.redirectTo));
};
