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
	await expect(page.getByText("10 shown · 243 pending · area: Toulouse")).toBeVisible();
	await expect(page.getByText("rows 1–10 of 243")).toBeVisible();
	// The same count again, from the top bar's own `loadCounts` on every screen.
	await expect(page.getByRole("button", { name: /^243 pending/ })).toBeVisible();

	for (const name of SEEDED) {
		await expect(onScreen(page.getByText(name, { exact: true }))).toHaveCount(1);
	}
});

test("the flags column names why each troubled candidate is troubled", async ({ page }) => {
	for (const flag of ["conflict", "invalid", "quarantined", "1 unevidenced", "stale 92d"]) {
		await expect(onScreen(page.getByText(flag, { exact: true }))).toHaveCount(1);
	}
});
