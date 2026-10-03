import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { loadCounts } from "$lib/server/queries";
import type { LayoutServerLoad } from "./$types";

/**
 * Every screen but the login is behind the session, and the check runs here so a
 * signed-out request never reaches a page load. The attempted path travels to the
 * login screen so signing in lands there rather than on the queue.
 *
 * The counts are here because the top bar shows them on every screen. Reading
 * `url.pathname` also makes this load rerun on every navigation, so they stay current.
 */
export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user && url.pathname !== "/login") {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	return {
		user: locals.user,
		session: locals.session,
		counts: locals.user ? await loadCounts(db, cookies.get("scope")) : null,
	};
};
