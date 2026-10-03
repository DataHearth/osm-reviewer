import { expect, test } from "@playwright/test";
import { ADMIN, signIn } from "./helpers";

/**
 * The OSM pane writes the account's `user_settings` row and the notifications pane
 * the instance's own, from two screens; a save that wrote either whole from the
 * wrong form would quietly revert the other. The test edits both in turn and
 * checks both survive a reload.
 *
 * Values are derived from what is on screen rather than written as literals: a
 * retry re-runs against the row the previous attempt already changed.
 */
test("saving one pane leaves the fields of the others alone", async ({ page }) => {
	await signIn(page, ADMIN.email, "/server");

	const save = page.getByRole("button", { name: "save", exact: true });
	const saved = page.getByText(/^saved \d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
	const notifications = page.getByRole("button", { name: /^notifications/ });
	const osmAccount = page.getByRole("button", { name: /^OSM account/ });

	await notifications.click();
	const threshold = page.getByRole("spinbutton");
	const raised = String(Number(await threshold.inputValue()) + 10);
	await threshold.fill(raised);
	await save.click();
	await expect(saved).toBeVisible();

	await page.goto("/settings");
	await osmAccount.click();
	const comment = page.locator("textarea");
	const marker = `reviewed by e2e ${Date.now()}`;
	await comment.fill(marker);
	await save.click();
	await expect(saved).toBeVisible();

	await page.reload();

	await expect(page.locator('input[name="name"]')).toHaveValue(ADMIN.name);
	await expect(page.locator('input[name="email"]')).toHaveValue(ADMIN.email);

	await osmAccount.click();
	await expect(page.locator("textarea")).toHaveValue(marker);

	await page.goto("/server");
	await notifications.click();
	await expect(page.getByRole("spinbutton")).toHaveValue(raised);
	// The channel summaries: ntfy still addressed, the webhook still the one
	// channel that is off. Neither save had any business touching them.
	await expect(page.getByText("osm-review", { exact: true })).toBeVisible();
	await expect(page.getByText("off", { exact: true })).toBeVisible();
});
