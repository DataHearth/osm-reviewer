import { error, fail, redirect } from "@sveltejs/kit";
import { eq, isNull, sql } from "drizzle-orm";
import { type Infer, message, type SuperValidated, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { dev } from "$app/environment";
import { LOCKOUT_MINUTES, type LoginMessage, loginSchema } from "$lib/schemas/auth";
import {
	clearFailures,
	lockoutState,
	normalizeEmail,
	recordFailure,
} from "$lib/server/auth/lockout";
import { verifyPassword } from "$lib/server/auth/password";
import {
	clearSessionCookie,
	createSession,
	deleteSession,
	SESSION_COOKIE,
	setSessionCookie,
} from "$lib/server/auth/session";
import { sso } from "$lib/server/config";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import type { Actions, PageServerLoad } from "./$types";

const adapter = zod4(loginSchema);

/** The value arrives from a query string, so only same-site paths are honoured. */
const safePath = (value: string | null | undefined) =>
	value?.startsWith("/") && !value.startsWith("//") ? value : "/";

const byEmail = (email: string) =>
	db
		.select()
		.from(users)
		.where(eq(sql`lower(${users.email})`, email))
		.get();

type LoginData = Infer<typeof loginSchema, "zod4">;
type Form = SuperValidated<LoginData, LoginMessage>;

const lockedMessage = (form: Form) =>
	message(
		form,
		{
			text: `Too many attempts. Sign-in is locked for ${LOCKOUT_MINUTES} minutes.`,
			tone: "bad",
			locked: true,
		},
		{ status: 429 },
	);

// The seeded-credentials hint is a demo affordance: it names an account and states the
// seed password, so it is built server-side and only in dev. Reading it from the database
// also keeps `data.ts` — whose fixture users carry cleartext passwords — out of the bundle.
const demoAdminEmail = () =>
	dev
		? (db.select({ email: users.email }).from(users).where(eq(users.role, "admin")).limit(1).get()
				?.email ?? null)
		: null;

export const load: PageServerLoad = async ({ url }) => ({
	adminEmail: demoAdminEmail(),
	sso: { enabled: sso.enabled, provider: sso.provider, host: sso.host, group: sso.group },
	form: await superValidate<LoginData, LoginMessage>(
		{ redirectTo: safePath(url.searchParams.get("redirectTo")) },
		adapter,
		{
			errors: false,
		},
	),
});

export const actions: Actions = {
	credentials: async ({ request, cookies, url }) => {
		const form = await superValidate<LoginData, LoginMessage>(request, adapter);
		if (!form.valid) return fail(400, { form });

		const email = normalizeEmail(form.data.email);
		if (lockoutState(email).locked) return lockedMessage(form);

		const user = byEmail(email);
		if (!user) {
			return message(
				form,
				{ text: "No account on this instance uses that address.", tone: "bad" },
				{ status: 401 },
			);
		}
		if (user.passwordHash === null) {
			return message(
				form,
				{
					text: sso.enabled
						? `That account is provisioned through ${sso.provider} — sign in with SSO instead.`
						: `That account is provisioned through ${sso.provider}, which is switched off on this instance.`,
					tone: "warn",
				},
				{ status: 401 },
			);
		}

		if (!(await verifyPassword(form.data.password, user.passwordHash))) {
			const state = recordFailure(email);
			if (state.locked) return lockedMessage(form);
			return message(
				form,
				{
					text: `Incorrect password. ${state.triesLeft}${state.triesLeft === 1 ? " attempt" : " attempts"} left before lockout.`,
					tone: state.triesLeft <= 2 ? "bad" : "warn",
				},
				{ status: 401 },
			);
		}

		clearFailures(email);
		setSessionCookie(cookies, url, createSession(user.id, "password"));
		redirect(303, safePath(form.data.redirectTo));
	},

	/**
	 * Stubbed provider round trip: no discovery, no authorization redirect, no code
	 * exchange. The real one leaves for sso.issuer here and comes back on a callback
	 * route that maps the claims onto a row in `users`; everything after that — the
	 * session row, the cookie, the bounce-back — is already what this does.
	 *
	 * Validation is skipped because this path ignores the password field, which the
	 * schema requires for the credentials action.
	 */
	sso: async ({ request, cookies, url }) => {
		if (!sso.enabled) error(404);
		const form = await superValidate<LoginData, LoginMessage>(request, adapter, { errors: false });

		const email = normalizeEmail(form.data.email);
		if (lockoutState(email).locked) return lockedMessage(form);

		const account =
			(email ? byEmail(email) : undefined) ??
			db.select().from(users).where(isNull(users.passwordHash)).orderBy(users.id).get();
		if (!account) {
			return message(
				form,
				{ text: `${sso.provider} returned no account for that address.`, tone: "bad" },
				{ status: 401 },
			);
		}

		setSessionCookie(cookies, url, createSession(account.id, "sso"));
		redirect(303, safePath(form.data.redirectTo));
	},

	signout: ({ cookies, url }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) deleteSession(token);
		clearSessionCookie(cookies, url);
		redirect(303, "/login");
	},

	// A lockout you can clear from the login screen is not a lockout, so this exists
	// only in dev, where waiting out fifteen minutes is pure friction.
	unlock: async ({ request }) => {
		if (!dev) error(404);
		const submitted = (await request.formData()).get("email");
		if (typeof submitted === "string") clearFailures(normalizeEmail(submitted));
	},
};
