import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const PHONE = { width: 402, height: 874 };
const TABLET = { width: 834, height: 1112 };
const DESKTOP = { width: 1280, height: 800 };

// Every tier's markup is in the DOM at once and the breakpoints decide what is on
// screen, so these assert visibility rather than presence. They are also the tests
// that catch a missing stylesheet: with no CSS, all three tiers render together and
// every expectation here fails at once.

test.beforeEach(async ({ page }) => {
	await signIn(page);
});

test("the queue is cards on a phone and a table from md up", async ({ page }) => {
	const columnHeader = page.getByRole("button", { name: "OBJECT" });
	const phoneFilter = page.getByRole("button", { name: /^filter/ });

	await page.setViewportSize(PHONE);
	await expect(phoneFilter).toBeVisible();
	await expect(columnHeader).toBeHidden();

	await page.setViewportSize(TABLET);
	await expect(columnHeader).toBeVisible();
	await expect(phoneFilter).toBeHidden();

	await page.setViewportSize(DESKTOP);
	await expect(columnHeader).toBeVisible();
	await expect(phoneFilter).toBeHidden();
});

test("the evidence gutter is a column beside the tag only on desktop", async ({ page }) => {
	await page.goto("/review");

	// Below lg the quote stacks under its tag and needs a caption to say what it
	// is; at lg it becomes the gutter and the caption goes away.
	const caption = page.getByText("EVIDENCE", { exact: true }).first();
	const paneSwitch = page.getByRole("button", { name: /^tags \d+\// });
	const tag = page.getByRole("button", { name: "Deselect shop" });
	const quote = page.getByText("commerce de détail de fleurs", { exact: true });

	await page.setViewportSize(PHONE);
	await expect(caption).toBeVisible();
	await expect(paneSwitch).toBeVisible();

	await page.setViewportSize(TABLET);
	await expect(caption).toBeVisible();
	await expect(paneSwitch).toBeHidden();

	await page.setViewportSize(DESKTOP);
	await expect(caption).toBeHidden();
	await expect(paneSwitch).toBeHidden();

	const tagBox = await tag.boundingBox();
	const quoteBox = await quote.boundingBox();
	expect(quoteBox?.x).toBeGreaterThan((tagBox?.x ?? 0) + (tagBox?.width ?? 0));
});
