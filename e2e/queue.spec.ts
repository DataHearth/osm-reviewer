import { expect, test } from "@playwright/test";
import { onScreen, signIn } from "./helpers";

/** The ten candidates `db:seed` puts in Toulouse, in the order the queue sorts them. */
const SEEDED = [
	"Fleuriste des Minimes",
	"Café Sept",
	"Le Bibent",
	"Ombres Blanches",
	"Tabac des Carmes",
	"Boulangerie Gaubert",
	"Boucherie Cazes",
	"Pharmacie du Capitole",
	"Coiffure Saint-Cyprien",
	"Épicerie Compans",
];

test.beforeEach(async ({ page }) => {
	await signIn(page);
});

test("the queue lists every seeded candidate with the derived counts", async ({ page }) => {
	await expect(page.getByText("10 matching · 10 pending")).toBeVisible();
	await expect(onScreen(page.getByText("Rows 1–10 of 10"))).toBeVisible();
	// The same count again, in the top bar's scope button, which every screen shows.
	await expect(page.getByRole("button", { name: "Area: Toulouse" })).toContainText("10 pending");

	for (const name of SEEDED) {
		await expect(onScreen(page.getByText(name, { exact: true }))).toHaveCount(1);
	}
});

test("the flags column names why each troubled candidate is troubled", async ({ page }) => {
	for (const flag of ["Conflict", "Invalid", "Quarantined", "1 unevidenced", "Stale 92d"]) {
		await expect(onScreen(page.getByText(flag, { exact: true }))).toHaveCount(1);
	}
});

test("the area picker scopes the queue and the choice outlives a reload", async ({ page }) => {
	await page.getByRole("button", { name: "Area: Toulouse" }).click();
	await onScreen(page.getByRole("button", { name: /^Bordeaux/ })).click();

	await expect(page.getByRole("button", { name: "Area: Bordeaux" })).toContainText("0 pending");
	await expect(
		page.getByText("Every queued candidate in Bordeaux has been reviewed."),
	).toBeVisible();
	await page.reload();
	await expect(page.getByRole("button", { name: "Area: Bordeaux" })).toBeVisible();

	await page.goto("/review");
	await expect(page.getByText("Nothing to review")).toBeVisible();
	await page.goto("/");

	await page.getByRole("button", { name: "Show all areas" }).click();
	await expect(page.getByRole("button", { name: "Area: All areas" })).toContainText("10 pending");
	await expect(page.getByText("10 matching · 10 pending")).toBeVisible();
});

test("a filter reaches every area's candidates, not just a loaded page, and lives in the URL", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Area: Toulouse" }).click();
	await onScreen(page.getByRole("button", { name: /^All areas/ })).click();
	await expect(page.getByRole("button", { name: "Area: All areas" })).toBeVisible();

	await page.getByRole("button", { name: "Closure", exact: true }).click();
	await expect(page).toHaveURL("/?type=closure");
	await expect(page.getByText("2 matching · 10 pending")).toBeVisible();
	await expect(onScreen(page.getByText("Rows 1–2 of 2"))).toBeVisible();
	for (const name of ["Pharmacie du Capitole", "Coiffure Saint-Cyprien"]) {
		await expect(onScreen(page.getByText(name, { exact: true }))).toHaveCount(1);
	}
	await expect(onScreen(page.getByText("Fleuriste des Minimes", { exact: true }))).toHaveCount(0);
	await expect(onScreen(page.getByRole("button", { name: "Previous page" }))).toBeDisabled();
	await expect(onScreen(page.getByRole("button", { name: "Next page" }))).toBeDisabled();

	await page.goBack();
	await expect(page).toHaveURL("/");
	await expect(page.getByText("10 matching · 10 pending")).toBeVisible();
});

test("a candidate opened from a filtered queue steps through that view and back to it", async ({
	page,
}) => {
	await page.goto("/?type=closure");
	await onScreen(page.getByText("Pharmacie du Capitole", { exact: true })).click();
	await expect(page).toHaveURL("/review?type=closure");
	await expect(onScreen(page.getByText("1 / 2", { exact: true }))).toBeVisible();

	await page.getByRole("button", { name: /^Skip/ }).click();
	await expect(onScreen(page.getByText("2 / 2", { exact: true }))).toBeVisible();
	await expect(onScreen(page.getByText("Coiffure Saint-Cyprien", { exact: true }))).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page).toHaveURL("/?type=closure");
});

test("the list scrolls with the keyboard selection, two rows ahead", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 420 });
	await expect(onScreen(page.getByText(SEEDED[0], { exact: true }))).toBeInViewport();
	for (let i = 0; i < 7; i++) await page.keyboard.press("j");
	// Row 7 is selected; the one two below it is already on screen.
	await expect(onScreen(page.getByText(SEEDED[9], { exact: true }))).toBeInViewport();
	await expect(onScreen(page.getByText(SEEDED[0], { exact: true }))).not.toBeInViewport();
});
