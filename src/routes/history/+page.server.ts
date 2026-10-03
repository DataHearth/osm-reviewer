import { db } from "$lib/server/db";
import { loadChangesets } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	return { changesets: await loadChangesets(db) };
};
