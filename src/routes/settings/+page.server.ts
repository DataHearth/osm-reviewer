import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { HEALTH, INSTANCE, KEYMAP, PIPELINE } from "$lib/data";
import {
	accountSchema,
	keysSchema,
	notifSchema,
	osmSchema,
	passwordSchema,
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
import { requireUser } from "$lib/server/user";
import type { Actions, PageServerLoad } from "./$types";

const connectionSchema = z.object({ connected: z.boolean() });

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const panes = await loadSettings(db, user.id);
	const [account, osm, notif, keys, password, counts] = await Promise.all([
		superValidate(panes.account, zod4(accountSchema)),
		superValidate(panes.osm, zod4(osmSchema)),
		superValidate(panes.notif, zod4(notifSchema)),
		superValidate(panes.keys, zod4(keysSchema)),
		superValidate(zod4(passwordSchema)),
		loadCounts(db),
	]);

	return {
		forms: { account, osm, notif, keys, password },
		identity: panes.identity,
		createdBy: PIPELINE.createdBy,
		session: { at: locals.session?.at ?? "—", via: locals.session?.via ?? "password" },
		user: { role: user.role, email: user.email, ssoOnly: user.ssoOnly === true },
		instance: INSTANCE,
		health: HEALTH,
		sso,
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
};
