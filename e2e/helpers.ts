import { expect, type Locator, type Page } from "@playwright/test";

/** Every account in the e2e data that has a password shares this one, the admin included. */
export const PASSWORD = "review";

/**
 * Lockout counts wrong passwords per email address in the server's own memory,
 * and the button that clears one exists only in dev — which the suite runs a
 * production build of. The reviewer below is therefore reserved for the failure
 * cases and is never signed in successfully; every other test uses the admin,
 * whose counter nothing touches.
 */
export const ADMIN = { email: "antoine@antoine-langlois.net", name: "Antoine Langlois" };
export const LOCKOUT_VICTIM = { email: "camille@antoine-langlois.net" };
export const SSO_ONLY = { email: "theo@antoine-langlois.net" };

/**
 * The queue, the rails and the review pane render every tier's markup and let a
 * breakpoint pick one, so a name matches two nodes. Both carry the same data and
 * the same click, so tests about content take whichever is on screen — and the
 * first of them, because with the stylesheet missing (see responsive.spec.ts)
 * every tier's markup is on screen at once.
 */
export const onScreen = (locator: Locator) => locator.filter({ visible: true }).first();

export async function submitCredentials(page: Page, email: string, password: string) {
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole("button", { name: "sign in" }).click();
}

export async function signIn(page: Page, email = ADMIN.email, landing = "/") {
	await page.goto(`/login?redirectTo=${encodeURIComponent(landing)}`);
	await submitCredentials(page, email, PASSWORD);
	await expect(page).toHaveURL(landing);
}

/**
 * A form action posted the way a client that ignored its own validation would.
 * `origin` is explicit because SvelteKit refuses a form POST whose origin does
 * not match the request URL, and APIRequestContext sends none of its own.
 *
 * The answer is the ActionResult envelope — always HTTP 200, with the action's
 * own status and its devalue-encoded data inside — because that is what the
 * `x-sveltekit-action` header asks for. A post without it answers 200 and a
 * rendered page either way, which says less.
 */
export function postAction(page: Page, action: string, fields: Record<string, string>) {
	return page.request.post(action, {
		form: fields,
		headers: { origin: new URL(page.url()).origin, "x-sveltekit-action": "true" },
	});
}

/**
 * Decisions outlive the test that took them and the data goes in once per run, so
 * a test that decides hands the queue back the way it found it. Undoing nothing
 * is a refusal rather than an error, which is why the result is not checked.
 */
export const undoDecision = (page: Page, id: string) => postAction(page, "/review?/undo", { id });
