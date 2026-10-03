import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";

import { parseQueueQuery } from "$lib/schemas/queue";
import { acceptSchema, candidateSchema } from "$lib/schemas/review";
import { db } from "$lib/server/db";
import { rebase } from "$lib/server/mutations";
import { loadQueue } from "$lib/server/queries";
import { accept, RefusedError, reject, undo } from "$lib/server/review";
import { requireUser } from "$lib/server/user";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, url }) => {
	const { counts } = await parent();
	const [queue, acceptForm, rejectForm] = await Promise.all([
		loadQueue(db, counts?.scope ?? null, parseQueueQuery(url.searchParams)),
		superValidate(zod4(acceptSchema), { id: "accept" }),
		superValidate(zod4(candidateSchema), { id: "reject" }),
	]);
	return { ...queue, acceptForm, rejectForm };
};

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(acceptSchema), { id: "accept" });
		if (!form.valid) return fail(400, { form });
		try {
			accept(db, user.id, form.data.id, form.data.tags);
		} catch (e) {
			if (e instanceof RefusedError) return message(form, e.message, { status: 409 });
			throw e;
		}
		return { form };
	},

	reject: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(candidateSchema), { id: "reject" });
		if (!form.valid) return fail(400, { form });
		try {
			reject(db, user.id, form.data.id);
		} catch (e) {
			if (e instanceof RefusedError) return message(form, e.message, { status: 409 });
			throw e;
		}
		return { form };
	},

	undo: async ({ request }) => {
		const form = await superValidate(request, zod4(candidateSchema));
		if (!form.valid) return fail(400, { form });
		try {
			undo(db, form.data.id);
		} catch (e) {
			if (e instanceof RefusedError) return message(form, e.message, { status: 409 });
			throw e;
		}
		return { form };
	},

	rebase: async ({ request }) => {
		const form = await superValidate(request, zod4(candidateSchema));
		if (!form.valid) return fail(400, { form });
		rebase(db, form.data.id);
		return { form };
	},
};
