import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { uploadSchema } from "$lib/schemas/review";
import { osm } from "$lib/server/config";
import { db } from "$lib/server/db";
import { CREATED_BY } from "$lib/server/instance";
import { loadStaged } from "$lib/server/queries";
import { RefusedError, upload } from "$lib/server/review";
import { loadSettings } from "$lib/server/settings";
import { requireUser } from "$lib/server/user";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
	const settings = await loadSettings(db, requireUser(locals).id);
	const cs = z.coerce.number().int().min(1).catch(1).parse(url.searchParams.get("cs"));
	const [staged, form] = await Promise.all([
		loadStaged(db, cs, settings.osm.perChangeset),
		superValidate(
			{
				comment: settings.osm.comment,
			},
			zod4(uploadSchema),
			{ errors: false },
		),
	]);
	return {
		staged,
		form,
		createdBy: CREATED_BY,
		osmHost: new URL(osm.url).host,
	};
};

export const actions: Actions = {
	upload: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(uploadSchema));
		if (!form.valid) return fail(400, { form });
		try {
			const result = await upload(db, user.id, form.data);
			if ("conflict" in result) return fail(409, { form, conflict: result.conflict });
			return { form, changesetId: result.changesetId };
		} catch (e) {
			if (e instanceof RefusedError) return message(form, e.message, { status: 409 });
			throw e;
		}
	},
};
