import { expect, type Page, test } from "@playwright/test";
import { ADMIN, SSO_ONLY } from "./helpers";
import { startIdp } from "./idp";

let idp: Awaited<ReturnType<typeof startIdp>>;
test.beforeAll(async () => {
	idp = await startIdp();
});
test.afterAll(() => idp.stop());

const GROUPS = ["osm-reviewers"];
// A retry runs against the accounts the failed attempt already created.
const fresh = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const continueWithSso = (page: Page) =>
	page.getByRole("button", { name: /continue with Authelia/ }).click();

test("a group member with no account gets one and lands where they were going", async ({
	page,
}) => {
	const id = fresh();
	idp.as({
		sub: `new-${id}`,
		email: `new-${id}@example.test`,
		email_verified: true,
		name: "Nora Newcomer",
		groups: GROUPS,
	});

	await page.goto("/history");
	await expect(page).toHaveURL("/login?redirectTo=%2Fhistory");
	await continueWithSso(page);
	await expect(page).toHaveURL("/history");

	await page.goto("/settings");
	await expect(page.getByText("via Authelia")).toBeVisible();
	await expect(page.getByText(/^reviewer/)).toBeVisible();
});

test("an account outside the group is refused", async ({ page }) => {
	const id = fresh();
	idp.as({
		sub: `out-${id}`,
		email: `out-${id}@example.test`,
		email_verified: true,
		groups: ["staff"],
	});

	await page.goto("/login");
	await continueWithSso(page);

	await expect(page).toHaveURL("/login?sso=group");
	await expect(
		page.getByText("Your Authelia account is not in the osm-reviewers group."),
	).toBeVisible();
});

test("an SSO-only account is linked by its verified address", async ({ page }) => {
	idp.as({ sub: "theo-at-idp", email: SSO_ONLY.email, email_verified: true, groups: GROUPS });

	await page.goto("/login");
	await continueWithSso(page);

	await expect(page).toHaveURL("/");
	await page.goto("/settings");
	await expect(page.locator('input[name="email"]')).toHaveValue(SSO_ONLY.email);
});

test("an unverified address never takes over an existing account", async ({ page }) => {
	idp.as({ sub: `squatter-${fresh()}`, email: ADMIN.email, email_verified: false, groups: GROUPS });

	await page.goto("/login");
	await continueWithSso(page);

	await expect(page).toHaveURL("/login?sso=taken");
	await expect(
		page.getByText("Another account on this instance already uses your Authelia address."),
	).toBeVisible();
});
