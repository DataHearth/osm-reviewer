import { error } from "@sveltejs/kit";
import type { User } from "$lib/types";

/**
 * The root layout redirects a signed-out request before any page load runs, so
 * this only fires for a form action posted without a session — which is a 401,
 * not a redirect.
 */
export function requireUser(locals: App.Locals): User {
	if (!locals.user) error(401, "not signed in");
	return locals.user;
}
