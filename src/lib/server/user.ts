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

export function requireAdmin(locals: App.Locals): User {
	const user = requireUser(locals);
	if (user.role !== "admin") error(403, "admins only");
	return user;
}
