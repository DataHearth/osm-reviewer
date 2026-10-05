import { error, fail, redirect } from "@sveltejs/kit";
import { type Infer, message, type SuperValidated, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { LOCKOUT_MINUTES, type LoginMessage, loginSchema } from "$lib/schemas/auth";
import { normalizeEmail } from "$lib/server/auth/lockout";
import { beginSignIn } from "$lib/server/auth/oidc";
import {
	clearSessionCookie,
	createSession,
	deleteSession,
	SESSION_COOKIE,
	safePath,
	setSessionCookie,
} from "$lib/server/auth/session";
import { passwordSignIn } from "$lib/server/auth/sign-in";
import { sso } from "$lib/server/config";
import { db } from "$lib/server/db";
import { release } from "$lib/server/instance";
import type { Actions, PageServerLoad } from "./$types";

const adapter = zod4(loginSchema);

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
		instance: release(url.host),
		sso: { enabled: sso.enabled, provider: sso.provider, host: sso.host, group: sso.group },
		form,
	};
};

export const actions: Actions = {
	credentials: async ({ request, cookies, url }) => {
		const form = await superValidate<LoginData, LoginMessage>(request, adapter);
		if (!form.valid) return fail(400, { form });

		const result = await passwordSignIn(db, normalizeEmail(form.data.email), form.data.password);
		if (result.ok) {
			setSessionCookie(cookies, url, createSession(result.user.id, "password"));
			redirect(303, safePath(form.data.redirectTo));
		}

		switch (result.refused) {
			case "locked":
				return lockedMessage(form);
			case "disabled":
				return message(form, { text: ssoRefusals.disabled, tone: "bad" }, { status: 403 });
			case "sso-only":
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
			case "wrong":
				return message(
					form,
					{
						text: `Incorrect password. ${result.triesLeft}${result.triesLeft === 1 ? " attempt" : " attempts"} left before lockout.`,
						tone: result.triesLeft <= 2 ? "bad" : "warn",
					},
					{ status: 401 },
				);
		}
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
};
