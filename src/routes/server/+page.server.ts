import { fail } from "@sveltejs/kit";
import { message, type SuperValidated, setError, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { areaDraftSchema, areaIdSchema, areaPausedSchema } from "$lib/schemas/area";
import {
	newUserSchema,
	notifSchema,
	userDisabledSchema,
	userIdSchema,
	userRoleSchema,
} from "$lib/schemas/settings";
import {
	officialAddSchema,
	sourceDraftSchema,
	sourceEnabledSchema,
	sourceIdSchema,
} from "$lib/schemas/source";
import { pipeline, sso, ssoShown } from "$lib/server/config";
import { db } from "$lib/server/db";
import { redact, shownNotif } from "$lib/server/diagnostics";
import { health, instanceFacts, release } from "$lib/server/instance";
import {
	addOfficialSource,
	applyAreaDraft,
	applySourceDraft,
	removeArea,
	requestRename,
	setAreaPaused,
	setSourceEnabled,
} from "$lib/server/mutations";
import { sendTest } from "$lib/server/notify";
import { modelLabel } from "$lib/server/pipeline/llm";
import { mappingOfPreset, shippedSources } from "$lib/server/pipeline/mapping/files";
import { kick, requestRuns, sourcesOfArea } from "$lib/server/pipeline/runner";
import { loadAreas, loadMappings, loadOffered, loadSources } from "$lib/server/queries";
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

const lastAdmin = <T extends Record<string, unknown>>(form: SuperValidated<T>) =>
	message(form, "That would leave the instance without an enabled admin.", { status: 409 });

/** Everything instance-wide: shared by every account, behind the gear in the top bar. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	const admin = user.role === "admin";
	const [sources, areas, sourceForm, officialForm, areaForm, notif, newUser] = await Promise.all([
		loadSources(db),
		loadAreas(db),
		superValidate(zod4(sourceDraftSchema)),
		superValidate(zod4(officialAddSchema)),
		superValidate(zod4(areaDraftSchema)),
		// Nobody but an admin can save the pane, so nobody else needs its secrets to fill it.
		loadNotif(db).then((v) =>
			superValidate(admin ? v : shownNotif(v), zod4(notifSchema), { errors: false }),
		),
		superValidate(zod4(newUserSchema)),
	]);

	return {
		// An endpoint may carry its credentials in the URL; only an admin edits it.
		sources: admin ? sources : (redact(sources) as typeof sources),
		areas: areas.areas,
		yields: areas.yields,
		mappings: loadMappings(),
		offered: loadOffered(sources),
		forms: { source: sourceForm, official: officialForm, area: areaForm, notif, newUser },
		release: release(url.host),
		users: admin ? listUsers(db) : [],
		user,
		instance: admin ? instanceFacts(db) : null,
		health: admin ? await health(db) : [],
		sso: ssoShown,
	};
};

export const actions: Actions = {
	sourceSave: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(sourceDraftSchema));
		if (!form.valid) return fail(400, { form });
		const { preset } = form.data;
		if (preset !== null && !mappingOfPreset(preset))
			return setError(form, "preset", "No shipped mapping reads that kind of place.");
		const id = applySourceDraft(db, form.data);
		if (!form.data.editId && pipeline.enabled) kick(db);
		return { form, id };
	},

	officialAdd: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(officialAddSchema));
		if (!form.valid) return fail(400, { form });
		const file = shippedSources().find((f) => f.source === form.data.file);
		if (!file) return message(form, "The app ships no such source.", { status: 404 });
		const id = addOfficialSource(db, file, form.data.areas);
		if (!id) return message(form, "This source is already switched on.", { status: 409 });
		if (pipeline.enabled) kick(db);
		return { form, id };
	},

	runNow: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(sourceIdSchema));
		if (!form.valid) return fail(400, { form });
		if (requestRuns(db, [form.data.id]) === 0)
			return message(form, "A run of this source is already in progress.", { status: 409 });
		return { form };
	},

	renameAgain: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(sourceIdSchema));
		if (!form.valid) return fail(400, { form });
		const refused = requestRename(db, form.data.id, modelLabel() !== null);
		if (refused) return message(form, refused, { status: 409 });
		if (requestRuns(db, [form.data.id]) === 0)
			return message(form, "A run of this source is in progress; the next one renames again.");
		return { form };
	},

	runArea: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(areaIdSchema));
		if (!form.valid) return fail(400, { form });
		if (requestRuns(db, sourcesOfArea(db, form.data.id)) === 0)
			return message(
				form,
				"The area is disabled, no enabled source is linked to it, or its runs are already going.",
				{
					status: 409,
				},
			);
		return { form };
	},

	enabled: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(sourceEnabledSchema));
		if (!form.valid) return fail(400, { form });
		setSourceEnabled(db, form.data.id, form.data.enabled);
		return { form };
	},

	areaSave: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(areaDraftSchema));
		if (!form.valid) return fail(400, { form });
		const id = applyAreaDraft(db, form.data);
		return { form, id };
	},

	paused: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(areaPausedSchema));
		if (!form.valid) return fail(400, { form });
		setAreaPaused(db, form.data.id, form.data.paused);
		return { form };
	},

	remove: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(areaIdSchema));
		if (!form.valid) return fail(400, { form });
		removeArea(db, form.data.id);
		return { form };
	},

	notif: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await superValidate(request, zod4(notifSchema));
		if (!form.valid) return fail(400, { form });
		await saveNotif(db, form.data);
		return { form };
	},

	notifTest: async ({ locals }) => {
		requireAdmin(locals);
		return { test: await sendTest(db) };
	},

	/**
	 * The four account actions refuse to touch the acting admin's own row, and the writes in
	 * `users.ts` refuse to leave no enabled admin, which two admins acting on each other at
	 * once would otherwise manage.
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
		if (!setRole(db, form.data.id, form.data.role)) return lastAdmin(form);
		return { form };
	},

	userDisabled: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await superValidate(request, zod4(userDisabledSchema));
		if (!form.valid) return fail(400, { form });
		if (form.data.id === admin.id)
			return message(form, "You cannot disable yourself.", { status: 409 });
		if (!setDisabled(db, form.data.id, form.data.disabled)) return lastAdmin(form);
		return { form };
	},

	userDelete: async ({ request, locals }) => {
		const admin = requireAdmin(locals);
		const form = await superValidate(request, zod4(userIdSchema));
		if (!form.valid) return fail(400, { form });
		if (form.data.id === admin.id)
			return message(form, "You cannot delete yourself.", { status: 409 });
		const refused = deleteUser(db, form.data.id);
		if (refused === "last admin") return lastAdmin(form);
		if (refused === "decisions")
			return message(form, "This account has decisions on record — disable it instead.", {
				status: 409,
			});
		return { form };
	},
};
