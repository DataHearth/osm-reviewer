import { expect, test } from "@playwright/test";
import { FAILED_CHANGESET } from "./fixture";
import { onScreen, signIn, undoDecision } from "./helpers";

/** Highest confidence of the ten candidates, so the queue sorts it first and `/review` opens it. */
const CANDIDATE = { id: "c8", name: "Fleuriste des Minimes", ageDays: 2 };

/** The fixture dates each candidate by its age back from the moment it went in. */
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
	await expect(page).toHaveURL(`/review?id=${CANDIDATE.id}`);

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

test("a link opens its candidate, decided or not, and follows the reviewer on", async ({
	page,
}) => {
	await page.goto("/review?id=c7");
	await expect(onScreen(page.getByText("Épicerie Compans", { exact: true }))).toBeVisible();
	await page.getByRole("button", { name: /^Skip/ }).click();
	await expect(page).not.toHaveURL(/id=c7/);

	await page.goto(`/review?id=${CANDIDATE.id}`);
	await page.getByRole("button", { name: /^Accept 2/ }).click();
	await expect(page.getByText(`accepted ${CANDIDATE.name} · u to undo`)).toBeVisible();
	await page.goto(`/review?id=${CANDIDATE.id}`);
	await expect(onScreen(page.getByText(CANDIDATE.name, { exact: true }))).toBeVisible();
	await expect(page.getByText("no longer in the queue")).toBeVisible();
});

test("a likely duplicate says what it may duplicate before anyone accepts it", async ({ page }) => {
	await page.goto("/review?id=c2");
	await expect(page.getByText("Check", { exact: true })).toBeVisible();
	await expect(
		page.getByText(/^Possible duplicate: amenity=cafe already mapped at node\/77/),
	).toBeVisible();
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

test("a deleted proposal is left out of the accept until it is restored", async ({ page }) => {
	await onScreen(page.getByText(CANDIDATE.name, { exact: true })).click();
	await page.getByRole("button", { name: "Delete shop" }).click();
	await expect(page.getByText("shop=florist")).toBeVisible();
	await expect(page.getByRole("button", { name: /^Accept 1/ })).toBeVisible();

	await page.getByRole("button", { name: "restore" }).click();
	await expect(page.getByRole("button", { name: /^Accept 2/ })).toBeVisible();

	await page.getByRole("button", { name: "Delete shop" }).click();
	await page.getByRole("button", { name: /^Accept 1/ }).click();
	await expect(page.getByText(`accepted ${CANDIDATE.name} · u to undo`)).toBeVisible();
	await page.goto("/composer");
	await expect(page.getByText("1 candidates · 1 tag writes · 1 changeset")).toBeVisible();
});

test("a candidate in conflict cannot be accepted", async ({ page }) => {
	await onScreen(page.getByText("Le Bibent", { exact: true })).click();
	await expect(page).toHaveURL(/\/review\?id=/);

	await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Accept/ })).toBeDisabled();
	await expect(page.getByText("accept blocked — version conflict unresolved")).toBeVisible();
});

test("a failed changeset opens with what went wrong", async ({ page }) => {
	await page.goto("/history");
	await page.getByText(FAILED_CHANGESET.comment).click();
	await expect(page).toHaveURL(`/history/${FAILED_CHANGESET.id}`);
	await expect(page.getByText(FAILED_CHANGESET.error)).toBeVisible();
	await expect(page.getByText("No objects recorded — its candidates stayed staged.")).toBeVisible();
});

test("the source line says whether it is official, and which tags its shipped renaming overrides", async ({
	page,
}) => {
	await page.goto("/review?id=c9");
	await expect(onScreen(page.getByText("official · 1 override", { exact: true }))).toBeVisible();
	await expect(onScreen(page.getByText("start_date", { exact: true }))).toBeVisible();
	await expect(onScreen(page.getByText("FR:school", { exact: true }))).toBeVisible();

	await page.goto("/review?id=c7");
	await expect(
		onScreen(page.getByText("custom · overrides not known", { exact: true })),
	).toBeVisible();
	await expect(onScreen(page.getByText("not known", { exact: true }))).toBeVisible();
});
