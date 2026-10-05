import { fail } from "@sveltejs/kit";
import { message, type SuperValidated, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import { parseQueueQuery } from "$lib/schemas/queue";
import { acceptSchema, candidateSchema } from "$lib/schemas/review";
import { osm } from "$lib/server/config";
import { db } from "$lib/server/db";
import { rebase } from "$lib/server/mutations";
import { loadCandidate, loadQueue } from "$lib/server/queries";
import { accept, RefusedError, reject, undo } from "$lib/server/review";
import { requireUser } from "$lib/server/user";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url }) => {
	const { counts } = await parent();
	const id = url.searchParams.get("id");
	const [queue, linked, acceptForm, rejectForm] = await Promise.all([
		loadQueue(db, counts?.scope ?? null, parseQueueQuery(url.searchParams)),
		id ? loadCandidate(db, id) : null,
		superValidate(zod4(acceptSchema), { id: "accept" }),
		superValidate(zod4(candidateSchema), { id: "reject" }),
	]);
	return { ...queue, linked, osmBase: osm.url, acceptForm, rejectForm };
};

/** A refusal is the reviewer's to read on the form; anything else is a fault. */
async function refusable<T extends Record<string, unknown>>(
	form: SuperValidated<T>,
	run: () => void | Promise<void>,
) {
	try {
		await run();
	} catch (e) {
		if (e instanceof RefusedError) return message(form, e.message, { status: 409 });
		throw e;
	}
	return { form };
}

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(acceptSchema), { id: "accept" });
		if (!form.valid) return fail(400, { form });
		return refusable(form, () => accept(db, user.id, form.data.id, form.data));
	},

	reject: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(candidateSchema), { id: "reject" });
		if (!form.valid) return fail(400, { form });
		return refusable(form, () => reject(db, user.id, form.data.id));
	},

	undo: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(candidateSchema));
		if (!form.valid) return fail(400, { form });
		return refusable(form, () => undo(db, form.data.id));
	},

	rebase: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(candidateSchema));
		if (!form.valid) return fail(400, { form });
		return refusable(form, () => rebase(db, form.data.id));
	},
};
