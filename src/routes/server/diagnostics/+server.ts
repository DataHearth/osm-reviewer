import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { diagnosticsBundle } from "$lib/server/diagnostics";
import { requireAdmin } from "$lib/server/user";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
	return json(await diagnosticsBundle(db), {
		headers: {
			"Content-Disposition": `attachment; filename="osm-reviewer-diagnostics-${stamp}.json"`,
			"Cache-Control": "no-store",
		},
	});
};
