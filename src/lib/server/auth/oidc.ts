import type { Cookies } from "@sveltejs/kit";
import * as client from "openid-client";
import { cookieOptions } from "$lib/server/auth/session";
import type { Claims } from "$lib/server/auth/sso-user";
import { sso } from "$lib/server/config";

/** What has to survive the round trip to the provider, held in a short-lived cookie. */
interface Pending {
	verifier: string;
	state: string;
	nonce: string;
	redirectTo: string;
}

const PENDING_COOKIE = "osm-oidc";
const PENDING_SECONDS = 10 * 60;

let discovered: Promise<client.Configuration> | undefined;

/**
 * Discovered on the first sign-in rather than at boot, so a provider that is down never
 * stops the server starting. A failed discovery is dropped, not cached, so the next
 * attempt retries it.
 */
function configuration() {
	const issuer = new URL(sso.issuer);
	discovered ??= client
		.discovery(
			issuer,
			sso.clientId,
			undefined,
			sso.clientSecret ? client.ClientSecretBasic(sso.clientSecret) : client.None(),
			// openid-client refuses plain http outright; an http:// issuer in the config is
			// the operator's explicit choice, and is what the e2e mock provider serves.
			issuer.protocol === "http:" ? { execute: [client.allowInsecureRequests] } : undefined,
		)
		.catch((err) => {
			discovered = undefined;
			throw err;
		});
	return discovered;
}

/** Resolves once discovery has succeeded; after the first success it answers from the cache. */
export const providerReachable = () => configuration().then(() => undefined);

const callbackUrl = (origin: string) => new URL("/login/callback", origin).href;

export async function beginSignIn(
	cookies: Cookies,
	url: URL,
	redirectTo: string,
	loginHint: string,
): Promise<URL> {
	const config = await configuration();
	const pending: Pending = {
		verifier: client.randomPKCECodeVerifier(),
		state: client.randomState(),
		nonce: client.randomNonce(),
		redirectTo,
	};
	cookies.set(PENDING_COOKIE, JSON.stringify(pending), {
		...cookieOptions(url),
		maxAge: PENDING_SECONDS,
	});

	return client.buildAuthorizationUrl(config, {
		redirect_uri: callbackUrl(url.origin),
		scope: sso.scopes,
		code_challenge: await client.calculatePKCECodeChallenge(pending.verifier),
		code_challenge_method: "S256",
		state: pending.state,
		nonce: pending.nonce,
		...(loginHint ? { login_hint: loginHint } : {}),
	});
}

/** Read once: a callback replayed with the same cookie has nothing left to match. */
export function takePending(cookies: Cookies, url: URL): Pending | null {
	const raw = cookies.get(PENDING_COOKIE);
	if (!raw) return null;
	cookies.delete(PENDING_COOKIE, cookieOptions(url));
	try {
		return JSON.parse(raw) as Pending;
	} catch {
		return null;
	}
}

export async function finishSignIn(currentUrl: URL, pending: Pending): Promise<Claims> {
	const config = await configuration();
	const tokens = await client.authorizationCodeGrant(config, currentUrl, {
		pkceCodeVerifier: pending.verifier,
		expectedState: pending.state,
		expectedNonce: pending.nonce,
		idTokenExpected: true,
	});
	const idToken = tokens.claims();
	if (!idToken) throw new Error("token response carried no ID token");

	// Providers differ on which claims ride in the ID token — Authelia, for one, returns
	// email and groups from userinfo only — so both are read and userinfo wins.
	const info = await client.fetchUserInfo(config, tokens.access_token, idToken.sub);
	return { ...idToken, ...info };
}
