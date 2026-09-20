import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { PIPELINE } from "$lib/data";
import { uploadSchema } from "$lib/schemas/review";
import { db } from "$lib/server/db";
import { loadCounts, loadStaged } from "$lib/server/queries";
import { RefusedError, upload } from "$lib/server/review";
import { loadSettings } from "$lib/server/settings";
import { requireUser } from "$lib/server/user";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
	const settings = await loadSettings(db, requireUser(locals).id);
	const [staged, counts, form] = await Promise.all([
		loadStaged(db),
		loadCounts(db),
		superValidate(
			{
				comment: settings.osm.comment,
				source: settings.osm.sourceTag,
				retry: false,
			},
			zod4(uploadSchema),
		),
	]);
	return { staged, counts, form, createdBy: PIPELINE.createdBy };
};

export const actions: Actions = {
	upload: async ({ request }) => {
		const form = await superValidate(request, zod4(uploadSchema));
		if (!form.valid) return fail(400, { form });
		try {
			const result = upload(db, form.data);
			if ("conflict" in result) return fail(409, { form, conflict: result.conflict });
			return { form, changesetId: result.changesetId };
		} catch (e) {
			if (e instanceof RefusedError) return message(form, e.message, { status: 409 });
			throw e;
		}
	},
};
