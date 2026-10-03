import { expect, test } from "@playwright/test";
import { ADMIN, postAction, signIn } from "./helpers";

test("a source with a blank name is refused by the server and never reaches the rail", async ({
	page,
}) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await expect(page.getByText("SOURCES · 4")).toBeVisible();
	await expect(page.getByText("4 sources · aggregate")).toBeVisible();

	// The create button stays disabled until the client's copy of the schema
	// passes, so the server's own check is only reachable by posting the way a
	// client that skipped it would.
	const refused = await postAction(page, "/server?/sourceSave", {
		name: "   ",
		endpoint: "https://example.invalid/records",
	});
	const result = await refused.json();
	expect(result.type).toBe("failure");
	expect(result.status).toBe(400);
	expect(result.data).toContain("A name is required.");

	await page.reload();
	await expect(page.getByText("SOURCES · 4")).toBeVisible();
	await expect(page.getByText("4 sources · aggregate")).toBeVisible();
});

test("the new-source form will not submit while the name is empty", async ({ page }) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await page.getByRole("button", { name: "+ new source" }).click();

	await expect(page.getByRole("button", { name: "create source" })).toBeDisabled();
	await expect(page.getByText("name and endpoint are required")).toBeVisible();
});
