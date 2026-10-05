import { db } from "$lib/server/db";
import { loadChangesets } from "$lib/server/queries";
import { requireUser } from "$lib/server/user";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals);
	return { changesets: await loadChangesets(db) };
};
