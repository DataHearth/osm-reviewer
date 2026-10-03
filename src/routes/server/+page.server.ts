import { fail } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import {
	areaDraftSchema,
	areaIdSchema,
	areaPausedSchema,
	areaRadiusSchema,
} from "$lib/schemas/area";
import {
	newUserSchema,
	notifSchema,
	userDisabledSchema,
	userIdSchema,
	userRoleSchema,
} from "$lib/schemas/settings";
import {
	sourceDraftSchema,
	sourceEnabledSchema,
	sourceFloorSchema,
	sourceLinkSchema,
} from "$lib/schemas/source";
import { sso } from "$lib/server/config";
import { db } from "$lib/server/db";
import { health, instanceFacts, release } from "$lib/server/instance";
import {
	applyAreaDraft,
	applySourceDraft,
	removeArea,
	setAreaPaused,
	setAreaRadius,
	setLink,
	setSourceEnabled,
	setSourceFloor,
} from "$lib/server/mutations";
import { loadAreas, loadRels, loadSources } from "$lib/server/queries";
import { loadNotif, saveNotif } from "$lib/server/settings";
import { requireAdmin, requireUser } from "$lib/server/user";
import {
	createUser,
	deleteUser,
	emailTaken,
	listUsers,
	setDisabled,
	setRole,
} from "$lib/server/users";
import type { Actions, PageServerLoad } from "./$types";

/** Everything instance-wide: shared by every account, behind the gear in the top bar. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	const admin = user.role === "admin";
	const [sources, areas, rels, sourceForm, areaForm, notif, newUser] = await Promise.all([
		loadSources(db),
		loadAreas(db),
		loadRels(db),
		superValidate(zod4(sourceDraftSchema)),
		superValidate(zod4(areaDraftSchema)),
		loadNotif(db).then((v) => superValidate(v, zod4(notifSchema))),
		superValidate(zod4(newUserSchema)),
	]);

	return {
		sources,
		areas: areas.areas,
		yields: areas.yields,
		rels,
		forms: { source: sourceForm, area: areaForm, notif, newUser },
		release: release(url.host),
		users: admin ? listUsers(db) : [],
		user,
		instance: admin ? instanceFacts(db) : null,
		health: admin ? await health(db) : [],
		sso: {
			enabled: sso.enabled,
			provider: sso.provider,
			host: sso.host,
			clientId: sso.clientId,
			scopes: sso.scopes,
		},
	};
};

export const actions: Actions = {
	sourceSave: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(sourceDraftSchema));
		if (!form.valid) return fail(400, { form });
		const id = applySourceDraft(db, form.data);
		return { form, id };
	},

	enabled: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(sourceEnabledSchema));
		if (!form.valid) return fail(400, { form });
		setSourceEnabled(db, form.data.id, form.data.enabled);
		return { form };
	},

	floor: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(sourceFloorSchema));
		if (!form.valid) return fail(400, { form });
		setSourceFloor(db, form.data.id, form.data.floor);
		return { form };
	},

	link: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(sourceLinkSchema));
		if (!form.valid) return fail(400, { form });
		setLink(db, form.data.sourceId, form.data.areaId, form.data.on);
		return { form };
	},

	areaSave: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(areaDraftSchema));
		if (!form.valid) return fail(400, { form });
		const id = applyAreaDraft(db, form.data);
		return { form, id };
	},

	paused: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(areaPausedSchema));
		if (!form.valid) return fail(400, { form });
		setAreaPaused(db, form.data.id, form.data.paused);
		return { form };
	},

	radius: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(areaRadiusSchema));
		if (!form.valid) return fail(400, { form });
		setAreaRadius(db, form.data.id, form.data.radius);
		return { form };
	},

	remove: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(areaIdSchema));
		if (!form.valid) return fail(400, { form });
		removeArea(db, form.data.id);
		return { form };
	},

	notif: async ({ request, locals }) => {
		requireUser(locals);
		const form = await superValidate(request, zod4(notifSchema));
		if (!form.valid) return fail(400, { form });
		await saveNotif(db, form.data);
		return { form };
	},

	/**
	 * The four account actions refuse to touch the acting admin's own row. That one rule is
	 * also what keeps an admin on the instance: the last one can never be the one acted on.
	 */
	userCreate: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(newUserSchema));
		if (!form.valid) return fail(400, { form });
		if (emailTaken(db, form.data.email))
			return message(form, "That address is already in use.", { status: 409 });
		if (!form.data.password && !sso.enabled)
			return message(form, "SSO is off here, so the account needs a password.", { status: 400 });
		await createUser(db, form.data);
		return message(form, `added ${form.data.email}`);
	},

	userRole: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await superValidate(request, zod4(userRoleSchema));
		if (!form.valid) return fail(400, { form });
		if (form.data.id === admin.id)
			return message(form, "You cannot change your own role.", { status: 409 });
		setRole(db, form.data.id, form.data.role);
		return { form };
	},

	userDisabled: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await superValidate(request, zod4(userDisabledSchema));
		if (!form.valid) return fail(400, { form });
		if (form.data.id === admin.id)
			return message(form, "You cannot disable yourself.", { status: 409 });
		setDisabled(db, form.data.id, form.data.disabled);
		return { form };
	},

	userDelete: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await superValidate(request, zod4(userIdSchema));
		if (!form.valid) return fail(400, { form });
		if (form.data.id === admin.id)
			return message(form, "You cannot delete yourself.", { status: 409 });
		if (!deleteUser(db, form.data.id))
			return message(form, "This account has decisions on record — disable it instead.", {
				status: 409,
			});
		return { form };
	},
};
