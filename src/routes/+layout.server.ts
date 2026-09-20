import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

/**
 * Every screen but the login is behind the session, and the check runs here so a
 * signed-out request never reaches a page load. The attempted path travels to the
 * login screen so signing in lands there rather than on the queue.
 */
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user && url.pathname !== "/login") {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	return { user: locals.user, session: locals.session };
};
