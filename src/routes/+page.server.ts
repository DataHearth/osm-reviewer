import { parseQueueQuery } from "$lib/schemas/queue";
import { db } from "$lib/server/db";
import { loadQueue } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url }) => {
	const { counts } = await parent();
	return loadQueue(db, counts?.scope ?? null, parseQueueQuery(url.searchParams));
};
