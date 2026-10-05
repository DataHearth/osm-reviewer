import { error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { loadChangeset } from "$lib/server/queries";
import { requireUser } from "$lib/server/user";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
	requireUser(locals);
	const changeset = await loadChangeset(db, params.id);
	if (!changeset) error(404, "no such changeset");
	return { changeset };
};
