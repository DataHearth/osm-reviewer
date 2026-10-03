import { expect, test } from "@playwright/test";
import { ADMIN, onScreen, SEED_PASSWORD, submitCredentials, undoDecision } from "./helpers";

/**
 * The forms are progressively enhanced, so every one of them has to survive
 * losing its enhancement: sign-in is a plain POST to `?/credentials`, and accept
 * is a plain POST carrying the tag positions as hidden inputs. The controls that
 * are only ever buttons — the toggles, the sliders, the settings save bar — have
 * no such path and are deliberately not exercised here.
 */
test.use({ javaScriptEnabled: false });

const CANDIDATE = { id: "c8", name: "Fleuriste des Minimes" };

test.afterEach(async ({ page }) => {
	await undoDecision(page, CANDIDATE.id);
});

test("signing in and accepting a candidate work with JavaScript off", async ({ page }) => {
	await page.goto("/settings");
	await expect(page).toHaveURL("/login?redirectTo=%2Fsettings");

	await submitCredentials(page, ADMIN.email, SEED_PASSWORD);
	await expect(page).toHaveURL("/settings");
	await expect(page.locator('input[name="email"]')).toHaveValue(ADMIN.email);

	// `/review` opens on the highest-confidence candidate on its own, which is
	// as well: without JS there is no row to click through from the queue.
	await page.goto("/review");
	await expect(page.getByRole("button", { name: "Deselect shop" })).toBeVisible();
	await page.getByRole("button", { name: /^Accept 2/ }).click();

	await page.goto("/");
	await expect(onScreen(page.getByText(CANDIDATE.name, { exact: true }))).toHaveCount(0);
	await expect(page.getByText("9 shown · 9 pending")).toBeVisible();
});
