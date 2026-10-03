import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { HEALTH, INSTANCE, KEYMAP, PIPELINE } from "$lib/data";
import {
	accountSchema,
	keysSchema,
	newUserSchema,
	notifSchema,
	osmSchema,
	passwordSchema,
	userDisabledSchema,
	userIdSchema,
	userRoleSchema,
} from "$lib/schemas/settings";
import { hashPassword, verifyPassword } from "$lib/server/auth/password";
import { sso } from "$lib/server/config";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { loadCounts } from "$lib/server/queries";
import {
	loadSettings,
	saveAccount,
	saveKeys,
	saveNotif,
	saveOsm,
	setOsmConnected,
} from "$lib/server/settings";
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

const connectionSchema = z.object({ connected: z.boolean() });

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const panes = await loadSettings(db, user.id);
	const [account, osm, notif, keys, password, newUser, counts] = await Promise.all([
		superValidate(panes.account, zod4(accountSchema)),
		superValidate(panes.osm, zod4(osmSchema)),
		superValidate(panes.notif, zod4(notifSchema)),
		superValidate(panes.keys, zod4(keysSchema)),
		superValidate(zod4(passwordSchema)),
		superValidate(zod4(newUserSchema)),
		loadCounts(db),
	]);

	return {
		forms: { account, osm, notif, keys, password, newUser },
		users: user.role === "admin" ? listUsers(db) : [],
		identity: panes.identity,
		createdBy: PIPELINE.createdBy,
		session: { at: locals.session?.at ?? "—", via: locals.session?.via ?? "password" },
		user: { id: user.id, role: user.role, email: user.email, ssoOnly: user.ssoOnly === true },
		instance: INSTANCE,
		health: HEALTH,
		sso: {
			enabled: sso.enabled,
			provider: sso.provider,
			host: sso.host,
			clientId: sso.clientId,
			scopes: sso.scopes,
		},
		keymap: KEYMAP,
		counts,
	};
};

export const actions: Actions = {
	account: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(accountSchema));
		if (!form.valid) return fail(400, { form });
		const clash = await db.query.users.findFirst({ where: (u) => eq(u.email, form.data.email) });
		if (clash && clash.id !== user.id)
			return message(form, "That address is already in use.", { status: 409 });
		saveAccount(db, user.id, form.data);
		return { form };
	},

	password: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(passwordSchema));
		if (!form.valid) return fail(400, { form });

		const row = await db.query.users.findFirst({ where: (u) => eq(u.id, user.id) });
		if (!row?.passwordHash)
			return message(form, "This account has no local password.", { status: 409 });
		if (!(await verifyPassword(form.data.cur, row.passwordHash)))
			return message(form, "Current password is wrong.", { status: 403 });

		db.update(users)
			.set({ passwordHash: await hashPassword(form.data.next) })
			.where(eq(users.id, user.id))
			.run();
		return message(form, "changed");
	},

	osm: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(osmSchema));
		if (!form.valid) return fail(400, { form });
		await saveOsm(db, user.id, form.data);
		return { form };
	},

	notif: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(notifSchema));
		if (!form.valid) return fail(400, { form });
		await saveNotif(db, user.id, form.data);
		return { form };
	},

	keys: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(keysSchema));
		if (!form.valid) return fail(400, { form });
		await saveKeys(db, user.id, form.data);
		return { form };
	},

	osmConnection: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(connectionSchema));
		if (!form.valid) return fail(400, { form });
		setOsmConnected(db, user.id, form.data.connected);
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
