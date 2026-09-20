import { fail } from "@sveltejs/kit";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import {
	areaDraftSchema,
	areaIdSchema,
	areaPausedSchema,
	areaRadiusSchema,
} from "$lib/schemas/area";
import { linkAction } from "$lib/server/actions";
import { db } from "$lib/server/db";
import { applyAreaDraft, removeArea, setAreaPaused, setAreaRadius } from "$lib/server/mutations";
import { loadAreas, loadCounts, loadRels, loadSources } from "$lib/server/queries";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
	const [areas, sources, rels, counts, form] = await Promise.all([
		loadAreas(db),
		loadSources(db),
		loadRels(db),
		loadCounts(db),
		superValidate(zod4(areaDraftSchema)),
	]);
	return { areas: areas.areas, yields: areas.yields, sources, rels, counts, form };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await superValidate(request, zod4(areaDraftSchema));
		if (!form.valid) return fail(400, { form });
		const id = applyAreaDraft(db, form.data);
		return { form, id };
	},

	paused: async ({ request }) => {
		const form = await superValidate(request, zod4(areaPausedSchema));
		if (!form.valid) return fail(400, { form });
		setAreaPaused(db, form.data.id, form.data.paused);
		return { form };
	},

	radius: async ({ request }) => {
		const form = await superValidate(request, zod4(areaRadiusSchema));
		if (!form.valid) return fail(400, { form });
		setAreaRadius(db, form.data.id, form.data.radius);
		return { form };
	},

	remove: async ({ request }) => {
		const form = await superValidate(request, zod4(areaIdSchema));
		if (!form.valid) return fail(400, { form });
		removeArea(db, form.data.id);
		return { form };
	},

	link: linkAction,
};
