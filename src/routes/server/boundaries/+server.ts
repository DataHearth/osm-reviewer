import { json } from "@sveltejs/kit";
import { NominatimError, searchBoundaries } from "$lib/server/nominatim";
import { requireAdmin } from "$lib/server/user";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
	requireAdmin(locals);
	const q = url.searchParams.get("q")?.trim() ?? "";
	if (q.length < 2) return json({ rels: [] });
	try {
		return json({ rels: await searchBoundaries(q) });
	} catch (e) {
		if (e instanceof NominatimError) return json({ error: e.message }, { status: 502 });
		throw e;
	}
};
