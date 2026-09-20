import { PIPELINE } from "$lib/data";
import { db } from "$lib/server/db";
import { loadCounts, loadQueue } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const [queue, counts] = await Promise.all([loadQueue(db), loadCounts(db)]);
	return {
		candidates: queue.candidates,
		decided: queue.decided,
		area: queue.area,
		counts,
		pipeline: PIPELINE,
	};
};
