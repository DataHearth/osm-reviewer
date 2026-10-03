import { expect, test } from "@playwright/test";
import { onScreen, signIn, undoDecision } from "./helpers";

/** Highest confidence of the seeded ten, so the queue sorts it first and `/review` opens it. */
const CANDIDATE = { id: "c8", name: "Fleuriste des Minimes", ageDays: 2 };

/** The seed dates each candidate by its fixture age back from the moment it ran. */
const fetched = () =>
	new Date(Date.now() - CANDIDATE.ageDays * 86_400_000)
		.toLocaleDateString("fr-FR")
		.replaceAll("/", "-");

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
	await expect(page.getByRole("textbox", { name: "Value of shop" })).toHaveValue("florist");
	// Exact, because the default match is case-insensitive and the second quote
	// would otherwise also find the candidate's own name in the header.
	await expect(page.getByText("commerce de détail de fleurs", { exact: true })).toBeVisible();
	await expect(page.getByText("FLEURISTE DES MINIMES", { exact: true })).toBeVisible();

	await expect(page.getByText("all tags evidenced")).toBeVisible();
	await expect(page.getByText(fetched(), { exact: true })).toBeVisible();
});

test("accepting a candidate outlives a reload and takes it out of the queue", async ({ page }) => {
	await onScreen(page.getByText(CANDIDATE.name, { exact: true })).click();
	await page.getByRole("button", { name: /^Accept 2/ }).click();
	await expect(page.getByText(`accepted ${CANDIDATE.name} · u to undo`)).toBeVisible();

	await page.goto("/");
	await page.reload();
	await expect(onScreen(page.getByText(CANDIDATE.name, { exact: true }))).toHaveCount(0);
	await expect(page.getByText("9 matching · 9 pending")).toBeVisible();

	// The two tags it was accepted with are what the composer would upload.
	await page.goto("/composer");
	await expect(page.getByText("1 candidates · 2 tag writes · 1 changeset")).toBeVisible();
});

test("what the reviewer typed is what gets staged", async ({ page }) => {
	await onScreen(page.getByText(CANDIDATE.name, { exact: true })).click();
	await page.getByRole("textbox", { name: "Value of name" }).fill("Fleurs des Minimes");
	await expect(page.getByText("edited", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "+ add tag" }).click();
	await page.getByRole("textbox", { name: "New key" }).fill("phone");
	await page.getByRole("textbox", { name: "New value" }).fill("+33 5 61 00 00 00");
	await page.getByRole("button", { name: /^Accept 3/ }).click();
	await expect(page.getByText(`accepted ${CANDIDATE.name} · u to undo`)).toBeVisible();

	await page.goto("/composer");
	await expect(page.getByText("1 candidates · 3 tag writes · 1 changeset")).toBeVisible();
	await page.getByText(CANDIDATE.name, { exact: true }).click();
	await expect(page.getByText("Fleurs des Minimes")).toBeVisible();
	await expect(page.getByText("+33 5 61 00 00 00")).toBeVisible();
});

test("a candidate in conflict cannot be accepted", async ({ page }) => {
	await onScreen(page.getByText("Le Bibent", { exact: true })).click();
	await expect(page).toHaveURL("/review");

	await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Accept/ })).toBeDisabled();
	await expect(page.getByText("accept blocked — version conflict unresolved")).toBeVisible();
});
