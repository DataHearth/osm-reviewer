import { db } from "$lib/server/db";
import { loadChangesets, loadCounts } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const [changesets, counts] = await Promise.all([loadChangesets(db), loadCounts(db)]);
	return { changesets, counts };
};
