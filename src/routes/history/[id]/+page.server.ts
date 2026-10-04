import { error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { loadChangeset } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
	const changeset = await loadChangeset(db, params.id);
	if (!changeset) error(404, "no such changeset");
	return { changeset };
};
