import { expect, test } from "@playwright/test";
import { ADMIN, postAction, signIn, submitCredentials } from "./helpers";

test("an admin adds, disables and deletes a local account", async ({ page, browser }) => {
	const email = `local-${Date.now()}@example.test`;
	const password = "a-long-enough-password";

	await signIn(page, ADMIN.email, "/server");
	await page.getByRole("button", { name: /^users/ }).click();

	const own = page.getByRole("listitem").filter({ hasText: ADMIN.email });
	await expect(own.getByText("· you")).toBeVisible();
	await expect(own.getByRole("button")).toHaveCount(0);

	await page.locator('input[name="name"]').fill("Lou Local");
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole("button", { name: "add account" }).click();
	await expect(page.getByText(`added ${email}`)).toBeVisible();

	const row = page.getByRole("listitem").filter({ hasText: email });
	await expect(row.getByText("reviewer")).toBeVisible();

	// The new reviewer, in a browser of their own: no users pane, and its actions refuse them.
	const other = await (await browser.newContext()).newPage();
	await other.goto("/login");
	await submitCredentials(other, email, password);
	await expect(other).toHaveURL("/");
	await other.goto("/server");
	await expect(other.getByRole("button", { name: /^users/ })).toHaveCount(0);
	const refused = await postAction(other, "/server?/userRole", { id: "anyone", role: "admin" });
	expect(refused.status()).toBe(403);

	await row.getByRole("button", { name: "disable" }).click();
	await expect(row.getByText("disabled")).toBeVisible();

	await other.reload();
	await expect(other).toHaveURL(/\/login/);
	await submitCredentials(other, email, password);
	await expect(
		other.getByText("This account is disabled. Ask an admin to re-enable it."),
	).toBeVisible();

	await row.getByRole("button", { name: "delete" }).click();
	await row.getByRole("button", { name: "confirm delete" }).click();
	await expect(row).toHaveCount(0);
});
