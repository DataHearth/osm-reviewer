import { expect, test } from "@playwright/test";
import { onScreen, signIn, undoDecision } from "./helpers";

/** Highest confidence of the seeded ten, so the queue sorts it first and `/review` opens it. */
const CANDIDATE = { id: "c8", name: "Fleuriste des Minimes", fetched: "12-09-2026" };

test.beforeEach(async ({ page }) => {
	await signIn(page);
});

test.afterEach(async ({ page }) => {
	await undoDecision(page, CANDIDATE.id);
});

test("a candidate opens with its tags and evidence", async ({ page }) => {
	await onScreen(page.getByText(CANDIDATE.name, { exact: true })).click();
	await expect(page).toHaveURL("/review");

	await expect(page.getByRole("button", { name: "Deselect shop" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Deselect name" })).toBeVisible();
	await expect(page.getByText("florist", { exact: true })).toBeVisible();
	// Exact, because the default match is case-insensitive and the second quote
	// would otherwise also find the candidate's own name in the header.
	await expect(page.getByText("commerce de détail de fleurs", { exact: true })).toBeVisible();
	await expect(page.getByText("FLEURISTE DES MINIMES", { exact: true })).toBeVisible();

	await expect(page.getByText("all tags evidenced")).toBeVisible();
	await expect(page.getByText(CANDIDATE.fetched, { exact: true })).toBeVisible();
});

test("accepting a candidate outlives a reload and takes it out of the queue", async ({ page }) => {
	await onScreen(page.getByText(CANDIDATE.name, { exact: true })).click();
	await page.getByRole("button", { name: /^Accept 2/ }).click();
	await expect(page.getByText(`accepted ${CANDIDATE.name} · u to undo`)).toBeVisible();

	await page.goto("/");
	await page.reload();
	await expect(onScreen(page.getByText(CANDIDATE.name, { exact: true }))).toHaveCount(0);
	await expect(page.getByText("9 shown · 242 pending")).toBeVisible();

	// The two tags it was accepted with are what the composer would upload.
	await page.goto("/composer");
	await expect(page.getByText("1 candidates · 2 tag writes · 1 changeset")).toBeVisible();
});

test("a candidate in conflict cannot be accepted", async ({ page }) => {
	await onScreen(page.getByText("Le Bibent", { exact: true })).click();
	await expect(page).toHaveURL("/review");

	await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Accept/ })).toBeDisabled();
	await expect(page.getByText("accept blocked — version conflict unresolved")).toBeVisible();
});
