import { error, type RequestEvent, redirect } from "@sveltejs/kit";

const PUBLIC = new Set(["/login", "/login/callback"]);

/**
 * Every route but the sign-in needs a session, and it is enforced here rather than in the
 * root layout load: a client-side invalidation fetches `__data.json` for the page node
 * alone, so a layout redirect never runs for it, and a `+server.ts` has no layout at all.
 *
 * What a signed-out request gets is whatever its caller can follow. A navigation, a data
 * request and an enhanced form post are redirected to the login (SvelteKit turns the last
 * two into the JSON redirect its client expects); a fetch or a plain form post gets a 401.
 */
export function requireSession(
	event: Pick<RequestEvent, "url" | "request" | "isDataRequest" | "locals">,
) {
	const { url, request } = event;
	if (event.locals.user || PUBLIC.has(url.pathname) || url.pathname.startsWith("/_app/")) return;

	const navigation =
		request.method === "GET" && !!request.headers.get("accept")?.includes("text/html");
	// Sent by `enhance` and by `post()`; an Accept header would not do, since `post()`
	// sends none and a fetch's default `*/*` cannot tell a script from a plain form.
	const enhancedPost =
		request.method === "POST" && request.headers.get("x-sveltekit-action") === "true";

	if (event.isDataRequest || navigation)
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	// The search of a post names the action, which a GET after signing in cannot replay.
	if (enhancedPost) redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	error(401, "not signed in");
}
