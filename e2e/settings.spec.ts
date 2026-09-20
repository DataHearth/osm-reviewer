import { expect, test } from "@playwright/test";
import { ADMIN, signIn } from "./helpers";

/**
 * Every pane but the account one writes the same `user_settings` row, so a save
 * that set the whole row from one pane's form would quietly revert the others.
 * The test therefore edits two panes in turn and checks both survive a reload.
 *
 * Values are derived from what is on screen rather than written as literals: a
 * retry re-runs against the row the previous attempt already changed.
 */
test("saving one pane leaves the fields of the others alone", async ({ page }) => {
	await signIn(page, ADMIN.email, "/settings");

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

	await notifications.click();
	await expect(page.getByRole("spinbutton")).toHaveValue(raised);
	// The channel summaries: ntfy still addressed, the webhook still the one
	// channel that is off. Neither save had any business touching them.
	await expect(page.getByText("osm-review", { exact: true })).toBeVisible();
	await expect(page.getByText("off", { exact: true })).toBeVisible();
});
