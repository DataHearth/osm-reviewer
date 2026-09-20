import { invalidateAll } from "$app/navigation";
import { page } from "$app/state";
import type { Session, User } from "$lib/types";

/**
 * A read-only view of the session the server resolved, which the root layout load
 * puts on `page.data`. Nothing here is authoritative: the session is a cookie and
 * a row, and every guard that matters runs before a page load does.
 */
class AuthView {
	get user(): User | null {
		return page.data.user ?? null;
	}

	get session(): Session | null {
		return page.data.session ?? null;
	}

	get signedIn() {
		return this.user !== null;
	}

	get initials() {
		return this.user?.initials ?? "··";
	}

	async signOut() {
		await fetch("/login?/signout", {
			method: "POST",
			headers: { "x-sveltekit-action": "true" },
			body: new FormData(),
		});
		await invalidateAll();
	}
}

export const auth = new AuthView();
