import { fail } from "@sveltejs/kit";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { sourceDraftSchema, sourceEnabledSchema, sourceFloorSchema } from "$lib/schemas/source";
import { linkAction } from "$lib/server/actions";
import { db } from "$lib/server/db";
import { applySourceDraft, setSourceEnabled, setSourceFloor } from "$lib/server/mutations";
import { loadAreas, loadCounts, loadSources } from "$lib/server/queries";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const [sources, areas, counts, form] = await Promise.all([
		loadSources(db),
		loadAreas(db),
		loadCounts(db),
		superValidate(zod4(sourceDraftSchema)),
	]);
	return { sources, areas: areas.areas, yields: areas.yields, counts, form };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await superValidate(request, zod4(sourceDraftSchema));
		if (!form.valid) return fail(400, { form });
		const id = applySourceDraft(db, form.data);
		return { form, id };
	},

	enabled: async ({ request }) => {
		const form = await superValidate(request, zod4(sourceEnabledSchema));
		if (!form.valid) return fail(400, { form });
		setSourceEnabled(db, form.data.id, form.data.enabled);
		return { form };
	},

	floor: async ({ request }) => {
		const form = await superValidate(request, zod4(sourceFloorSchema));
		if (!form.valid) return fail(400, { form });
		setSourceFloor(db, form.data.id, form.data.floor);
		return { form };
	},

	link: linkAction,
};
