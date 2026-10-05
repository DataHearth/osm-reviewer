import { expect, test } from "@playwright/test";
import { ADMIN, LOCKOUT_VICTIM, PASSWORD, SSO_ONLY, signIn, submitCredentials } from "./helpers";

test("a guarded route bounces to the login and comes back after signing in", async ({ page }) => {
	await page.goto("/settings");
	await expect(page).toHaveURL("/login?redirectTo=%2Fsettings");

	await submitCredentials(page, ADMIN.email, PASSWORD);

	await expect(page).toHaveURL("/settings");
	await expect(page.locator('input[name="email"]')).toHaveValue(ADMIN.email);
});

test("a wrong password is refused and counts the attempts down", async ({ page }) => {
	await page.goto("/login");
	const error = page.getByText("Incorrect password.");

	await submitCredentials(page, LOCKOUT_VICTIM.email, "not-the-password");
	await expect(error).toBeVisible();

	// Read the count rather than hard-coding 4: the lock is process memory, so a
	// retried run of this test starts partway through the same account's budget.
	const left = Number(/(\d+) attempts? left/.exec((await error.textContent()) ?? "")?.[1]);
	expect(left).toBeGreaterThan(1);

	await submitCredentials(page, LOCKOUT_VICTIM.email, "still-not-the-password");
	await expect(page.getByText(`Incorrect password. ${left - 1} attempt`)).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});

test("an SSO-only account refuses a password and points at the provider", async ({ page }) => {
	await page.goto("/login");
	await submitCredentials(page, SSO_ONLY.email, PASSWORD);

	await expect(
		page.getByText("That account is provisioned through Authelia — sign in with SSO instead."),
	).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});

test("an address with no account on the instance is refused", async ({ page }) => {
	await page.goto("/login");
	await submitCredentials(page, "nobody@antoine-langlois.net", PASSWORD);

	await expect(page.getByText("No account on this instance uses that address.")).toBeVisible();
});

test("signing out clears the session and a guarded route bounces again", async ({ page }) => {
	await signIn(page, ADMIN.email, "/settings");

	await page.getByRole("button", { name: "Account", exact: true }).click();
	await page.getByRole("button", { name: "sign out" }).click();
	await expect(page).toHaveURL(/\/login/);

	await page.goto("/settings");
	await expect(page).toHaveURL("/login?redirectTo=%2Fsettings");
});

test("a signed-out post to a review action is refused, whichever action it names", async ({
	request,
	baseURL,
}) => {
	for (const action of ["accept", "reject", "undo", "rebase"]) {
		const res = await request.post(`/review?/${action}`, {
			headers: { origin: baseURL as string },
			form: { id: "c1" },
		});
		expect(res.status(), action).toBe(401);
	}
});
