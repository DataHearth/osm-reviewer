import { error } from "@sveltejs/kit";
import type { User } from "$lib/types";

/**
 * `handle` refuses a signed-out request before any load or action runs; this narrows
 * the type for the caller and stays as a second line behind it.
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
