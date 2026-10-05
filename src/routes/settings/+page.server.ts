import { fail, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import { accountSchema, keysSchema, osmSchema, passwordSchema } from "$lib/schemas/settings";
import { hashPassword, verifyPassword } from "$lib/server/auth/password";
import { osm as osmConfig, ssoShown } from "$lib/server/config";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { CREATED_BY } from "$lib/server/instance";
import { beginConnect, osmOAuthConfigured } from "$lib/server/osm/oauth";
import {
	loadSettings,
	saveAccount,
	saveKeys,
	saveOsm,
	setOsmConnected,
} from "$lib/server/settings";
import { requireUser } from "$lib/server/user";
import { emailTaken } from "$lib/server/users";
import type { Actions, PageServerLoad } from "./$types";

const disconnectSchema = z.object({ connected: z.literal(false) });

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	const panes = await loadSettings(db, user.id);
	const [account, osm, keys, password] = await Promise.all([
		superValidate(panes.account, zod4(accountSchema), { errors: false }),
		superValidate(panes.osm, zod4(osmSchema), { errors: false }),
		superValidate(panes.keys, zod4(keysSchema), { errors: false }),
		superValidate(zod4(passwordSchema)),
	]);

	return {
		forms: { account, osm, keys, password },
		identity: panes.identity,
		createdBy: CREATED_BY,
		osmTarget: new URL(osmConfig.url).host,
		osmConfigured: osmOAuthConfigured(),
		section: url.searchParams.get("s"),
		osmProblem: url.searchParams.get("osm"),
		session: { at: locals.session?.at ?? "—", via: locals.session?.via ?? "password" },
		user: { ...user, ssoOnly: user.ssoOnly === true },
		sso: ssoShown,
	};
};

export const actions: Actions = {
	account: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(accountSchema));
		if (!form.valid) return fail(400, { form });
		if (emailTaken(db, form.data.email, user.id))
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

	keys: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(keysSchema));
		if (!form.valid) return fail(400, { form });
		await saveKeys(db, user.id, form.data);
		return { form };
	},

	osmConnect: async ({ locals, cookies, url }) => {
		const user = requireUser(locals);
		if (!osmOAuthConfigured()) return fail(404, { message: "OSM sign-in is not configured." });
		redirect(303, beginConnect(cookies, url, user.id).href);
	},

	osmConnection: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await superValidate(request, zod4(disconnectSchema));
		if (!form.valid) return fail(400, { form });
		setOsmConnected(db, user.id, false);
		return { form };
	},
};
