import { expect, test } from "@playwright/test";
import { OFFICIAL_SOURCE, RENAMED_SOURCE, SOURCE_COUNT } from "./fixture";
import { ADMIN, postAction, signIn } from "./helpers";

test("a source with a blank name is refused by the server and never reaches the rail", async ({
	page,
}) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await expect(page.getByText(`SOURCES · ${SOURCE_COUNT}`)).toBeVisible();
	await expect(page.getByText(`${SOURCE_COUNT} sources · aggregate`)).toBeVisible();

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
	await expect(page.getByText(`SOURCES · ${SOURCE_COUNT}`)).toBeVisible();
	await expect(page.getByText(`${SOURCE_COUNT} sources · aggregate`)).toBeVisible();
});

test("the new-source form will not submit while the name is empty", async ({ page }) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await page.getByRole("button", { name: "+ new source" }).click();

	await expect(page.getByRole("button", { name: "create source" })).toBeDisabled();
	await expect(page.getByText("name and endpoint are required")).toBeVisible();
});

test("a source shows the column renaming the model stored, and cannot rename again without a model", async ({
	page,
}) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await page
		.getByRole("button", { name: new RegExp(RENAMED_SOURCE.name) })
		.first()
		.click();

	await expect(page.getByText("COLUMN MAPPING")).toBeVisible();
	await expect(page.getByText("renamed by qwen3-14b · 14-09-2026 06:12")).toBeVisible();
	await expect(page.getByText("code_uai", { exact: true })).toBeVisible();
	await expect(page.getByTitle("code_uai", { exact: true })).toBeVisible();
	await expect(page.getByText("step sites, as adresse_1")).toBeVisible();
	await expect(page.getByText("ignored — free text no rule reads").first()).toBeHidden();
	await page.getByText("6 ignored").click();
	await expect(page.getByText("ignored — free text no rule reads").first()).toBeVisible();
	await expect(page.getByRole("button", { name: "rename again · not configured" })).toBeDisabled();

	const refused = await postAction(page, "/server?/renameAgain", { id: RENAMED_SOURCE.id });
	const result = await refused.json();
	expect(result.type).toBe("failure");
	expect(result.status).toBe(409);
	expect(result.data).toContain("Set LLM_PROVIDER and LLM_MODEL to enable renaming.");
});

test("a source is pointed at a shipped mapping from the form, and the choice is not offered to the model extractor", async ({
	page,
}) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await page.getByRole("button", { name: "+ new source" }).click();

	const picker = page.getByRole("combobox");
	await expect(picker).toHaveValue("");
	await expect(picker.getByRole("option")).toHaveText([
		"detect from the columns",
		"Charging stations in France · FR:charging_station",
		"Schools in France · FR:school",
	]);

	await page.getByPlaceholder("e.g. data.bordeaux-metropole.fr").fill("Picked schools");
	await page.getByPlaceholder(/api\/explore/).fill("https://example.invalid/schools.csv");
	await picker.selectOption({ label: "Schools in France · FR:school" });

	await page.getByRole("button", { name: "language model" }).click();
	await expect(picker).toBeHidden();
	await page.getByRole("button", { name: "deterministic field map" }).click();
	await expect(picker).toHaveValue("FR:school");

	await page.getByRole("button", { name: "create source" }).click();
	await expect(page.getByText("deterministic field map · mapping FR:school")).toBeVisible();
});

test("a source made from a shipped file shows its checklist, and one that was edited away from it does not", async ({
	page,
}) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await page.getByRole("button", { name: new RegExp(`^${OFFICIAL_SOURCE.name}`) }).click();

	await expect(page.getByText("OFFICIAL SOURCE")).toBeVisible();
	await expect(page.getByText("official", { exact: true })).toBeVisible();
	await expect(page.getByText(/^Ministère de l'Éducation nationale/)).toBeVisible();
	await expect(page.getByText("Licence Ouverte 2.0", { exact: true }).first()).toBeVisible();
	await expect(
		page.getByRole("link", { name: /wiki\.openstreetmap\.org\/wiki\/France\/data\.gouv\.fr/ }),
	).toHaveAttribute("href", /^https:\/\/wiki\.openstreetmap\.org\//);
	await expect(
		page.getByRole("link", { name: /forum\.openstreetmap\.fr\/t\/school-fr-et-osmose/ }),
	).toHaveAttribute("href", "https://forum.openstreetmap.fr/t/school-fr-et-osmose/12801");
	await expect(page.getByText("start_date", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: new RegExp(`^${RENAMED_SOURCE.name}`) }).click();
	await expect(page.getByText("OFFICIAL SOURCE")).toBeHidden();
	await expect(page.getByText("official", { exact: true })).toBeHidden();
});

test("a shipped source no row is made from is offered, and switching it on creates it from the file", async ({
	page,
}) => {
	await signIn(page, ADMIN.email, "/server?s=sources");
	await expect(page.getByText("OFFICIAL · 1 TO SWITCH ON")).toBeVisible();

	await page.getByRole("button", { name: new RegExp(`^${OFFICIAL_SOURCE.name}`) }).click();
	await page.getByRole("button", { name: "edit", exact: true }).click();
	await page.getByPlaceholder("e.g. data.bordeaux-metropole.fr").fill("Annuaire, copie locale");
	await page.getByPlaceholder(/api\/explore/).fill("https://example.invalid/annuaire");
	await page.getByRole("button", { name: "save changes" }).click();
	await expect(page.getByText("OFFICIAL SOURCE")).toBeHidden();

	await expect(page.getByText("OFFICIAL · 2 TO SWITCH ON")).toBeVisible();
	await page.getByRole("button", { name: new RegExp(`^${OFFICIAL_SOURCE.name}`) }).click();

	await expect(page.getByText("CHECKLIST")).toBeVisible();
	await expect(page.getByText("Licence Ouverte 2.0", { exact: true })).toBeVisible();
	await expect(page.getByText("amenity=school", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "switch on" }).click();

	await expect(page.getByText("OFFICIAL · 1 TO SWITCH ON")).toBeVisible();
	await expect(page.getByText("OFFICIAL SOURCE")).toBeVisible();
	await expect(page.getByText("official", { exact: true })).toBeVisible();
	await expect(page.getByText("deterministic field map · mapping FR:school")).toBeVisible();
	await expect(page.getByText("Licence Ouverte 2.0").first()).toBeVisible();
});
