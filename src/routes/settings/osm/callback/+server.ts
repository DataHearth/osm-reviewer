import { error, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { userDetails } from "$lib/server/osm/api";
import { exchangeCode, OSM_SCOPES, osmOAuthConfigured, takePending } from "$lib/server/osm/oauth";
import { saveOsmAccount } from "$lib/server/settings";
import type { RequestHandler } from "./$types";

const back = (reason?: string) => `/settings?s=osm${reason ? `&osm=${reason}` : ""}`;

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!osmOAuthConfigured()) error(404);
	if (!locals.user) redirect(303, "/login");

	const pending = takePending(cookies, url);
	if (!pending || pending.userId !== locals.user.id) redirect(303, back("expired"));
	if (url.searchParams.get("state") !== pending.state) redirect(303, back("failed"));

	const code = url.searchParams.get("code");
	if (!code)
		redirect(303, back(url.searchParams.get("error") === "access_denied" ? "denied" : "failed"));

	try {
		const token = await exchangeCode(url, code, pending.verifier);
		const user = await userDetails(token);
		await saveOsmAccount(db, locals.user.id, {
			token,
			name: user.name,
			id: user.id,
			scopes: OSM_SCOPES,
		});
	} catch (err) {
		console.error("OSM sign-in failed:", err);
		redirect(303, back("failed"));
	}
	redirect(303, back());
};
