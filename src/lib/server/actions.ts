import { fail, type RequestEvent } from "@sveltejs/kit";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { sourceLinkSchema } from "$lib/schemas/source";
import { db } from "./db";
import { setLink } from "./mutations";

/** The same source×area checkbox, reached from either screen. */
export async function linkAction({ request }: RequestEvent) {
	const form = await superValidate(request, zod4(sourceLinkSchema));
	if (!form.valid) return fail(400, { form });
	setLink(db, form.data.sourceId, form.data.areaId, form.data.on);
	return { form };
}
