import { error, fail, redirect } from "@sveltejs/kit";
import { eq, sql } from "drizzle-orm";
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
import { beginSignIn } from "$lib/server/auth/oidc";
import { verifyPassword } from "$lib/server/auth/password";
import {
	clearSessionCookie,
	createSession,
	deleteSession,
	SESSION_COOKIE,
	safePath,
	setSessionCookie,
} from "$lib/server/auth/session";
import { sso } from "$lib/server/config";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { release } from "$lib/server/instance";
import type { Actions, PageServerLoad } from "./$types";

const adapter = zod4(loginSchema);

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

/** The callback bounces a refused sign-in back here with one of these as `?sso=`. */
const ssoRefusals: Record<string, string> = {
	expired: "That sign-in expired or was started in another tab. Try again.",
	failed: `${sso.provider} did not complete the sign-in.`,
	group: `Your ${sso.provider} account is not in the ${sso.group} group.`,
	email: `${sso.provider} did not share an email address for your account.`,
	taken: `Another account on this instance already uses your ${sso.provider} address.`,
	disabled: "This account is disabled. Ask an admin to re-enable it.",
};

export const load: PageServerLoad = async ({ url }) => {
	const form = await superValidate<LoginData, LoginMessage>(
		{ redirectTo: safePath(url.searchParams.get("redirectTo")) },
		adapter,
		{ errors: false },
	);
	const refusal = ssoRefusals[url.searchParams.get("sso") ?? ""];
	if (refusal) form.message = { text: refusal, tone: "bad" };

	return {
		adminEmail: demoAdminEmail(),
		instance: release(url.host),
		sso: { enabled: sso.enabled, provider: sso.provider, host: sso.host, group: sso.group },
		form,
	};
};

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
		if (user.disabled) {
			return message(form, { text: ssoRefusals.disabled, tone: "bad" }, { status: 403 });
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
	 * Leaves for the provider; `/login/callback` is where it comes back. Validation is
	 * skipped because this path ignores the password field, which the schema requires for
	 * the credentials action — the email, if typed, only travels as a login hint.
	 */
	sso: async ({ request, cookies, url }) => {
		if (!sso.enabled) error(404);
		const form = await superValidate<LoginData, LoginMessage>(request, adapter, { errors: false });

		let destination: URL;
		try {
			destination = await beginSignIn(
				cookies,
				url,
				safePath(form.data.redirectTo),
				normalizeEmail(form.data.email),
			);
		} catch (err) {
			console.error(`SSO discovery against ${sso.issuer} failed:`, err);
			return message(
				form,
				{
					text: `${sso.provider} at ${sso.host} did not answer as an OpenID provider.`,
					tone: "bad",
				},
				{ status: 502 },
			);
		}
		redirect(303, destination);
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
