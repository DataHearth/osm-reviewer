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

test("the queue lists every seeded candidate with the pipeline's counts", async ({ page }) => {
	await expect(page.getByText("10 shown · 243 pending")).toBeVisible();
	await expect(page.getByText("Rows 1–10 of 243")).toBeVisible();
	// The same count again, in the top bar's scope button, which every screen shows.
	await expect(page.getByRole("button", { name: "Area: Toulouse" })).toContainText("243 pending");

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

	await expect(page.getByRole("button", { name: "Area: Bordeaux" })).toContainText("88 pending");
	await expect(page.getByText("No candidates loaded for Bordeaux yet.")).toBeVisible();
	await page.reload();
	await expect(page.getByRole("button", { name: "Area: Bordeaux" })).toBeVisible();

	await page.goto("/review");
	await expect(
		page.getByText("No candidates loaded for Bordeaux yet — 88 pending there."),
	).toBeVisible();
	await page.goto("/");

	await page.getByRole("button", { name: "Show all areas" }).click();
	await expect(page.getByRole("button", { name: "Area: All areas" })).toContainText("343 pending");
	await expect(page.getByText("10 shown · 343 pending")).toBeVisible();
});
