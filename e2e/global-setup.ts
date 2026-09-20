import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { chromium } from "@playwright/test";
import { E2E_DATABASE_DIR, E2E_DATABASE_PATH } from "./db";

/**
 * Chromium with no font installed measures every glyph as zero wide, so anything
 * sized by its own text collapses to an empty box — and an empty box is how
 * Playwright spells "hidden". A fontless environment therefore presents itself
 * as a dozen assertions that find the element, read the right text off it and
 * time out anyway, with nothing in the message pointing at fonts. Nix build
 * sandboxes are fontless unless the derivation says otherwise, so the second
 * spent proving there is a font buys back several minutes of that.
 */
async function requireAFont() {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const width = await page.evaluate(() => {
			const ctx = document.createElement("canvas").getContext("2d");
			if (!ctx) return -1;
			ctx.font = "13px monospace";
			return ctx.measureText("osm-reviewer").width;
		});
		if (width > 0) return;
		throw new Error(
			`no usable font here: Chromium measures 13px monospace as ${width}px wide, so every ` +
				"assertion on rendered text will fail as hidden. Install a font, or point the " +
				"environment's FONTCONFIG_FILE at one.",
		);
	} finally {
		await browser.close();
	}
}

/**
 * Playwright runs its `webServer` plugin before this hook, so the app has already
 * created the file and applied its migrations by the time the seed runs. The
 * fixtures therefore go in by seeding and never by replacing the file: unlinking
 * it here would leave the running server writing to an inode nothing else can
 * see, and every assertion would read an empty database.
 *
 * `db:seed` deletes and reinserts every table, so a run always starts from the
 * same rows even though the server got there first.
 */
export default async function globalSetup() {
	await requireAFont();

	execFileSync("pnpm", ["db:seed"], {
		env: { ...process.env, DATABASE_PATH: E2E_DATABASE_PATH },
		stdio: "inherit",
	});

	return () => rmSync(E2E_DATABASE_DIR, { recursive: true, force: true });
}
