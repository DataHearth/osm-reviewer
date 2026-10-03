import { createHash, randomBytes } from "node:crypto";
import type { Cookies } from "@sveltejs/kit";
import { cookieOptions } from "$lib/server/auth/session";
import { osm } from "$lib/server/config";
import { OsmError, userAgent } from "./api";

export const OSM_SCOPES = "read_prefs write_api";

const PENDING_COOKIE = "osm-oauth";
const PENDING_SECONDS = 10 * 60;

/** Without a client id there is nothing to sign in with: the pane says so instead of offering the button. */
export const osmOAuthConfigured = () => !!osm.clientId;

interface Pending {
	verifier: string;
	state: string;
	userId: string;
}

const b64url = (b: Buffer) => b.toString("base64url");
const callbackUrl = (url: URL) => new URL("/settings/osm/callback", url.origin).href;

/** The pending cookie carries the acting user, so a callback finished by someone else is refused. */
export function beginConnect(cookies: Cookies, url: URL, userId: string): URL {
	const pending: Pending = {
		verifier: b64url(randomBytes(48)),
		state: b64url(randomBytes(24)),
		userId,
	};
	cookies.set(PENDING_COOKIE, JSON.stringify(pending), {
		...cookieOptions(url),
		maxAge: PENDING_SECONDS,
	});
	const authorize = new URL("/oauth2/authorize", osm.url + "/");
	authorize.search = new URLSearchParams({
		response_type: "code",
		client_id: osm.clientId ?? "",
		redirect_uri: callbackUrl(url),
		scope: OSM_SCOPES,
		state: pending.state,
		code_challenge: b64url(createHash("sha256").update(pending.verifier).digest()),
		code_challenge_method: "S256",
	}).toString();
	return authorize;
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

export async function exchangeCode(url: URL, code: string, verifier: string): Promise<string> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: callbackUrl(url),
		client_id: osm.clientId ?? "",
		code_verifier: verifier,
		...(osm.clientSecret ? { client_secret: osm.clientSecret } : {}),
	});
	let res: Response;
	try {
		res = await fetch(osm.url + "/oauth2/token", {
			method: "POST",
			body,
			headers: { "User-Agent": userAgent(), Accept: "application/json" },
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new OsmError(`${osm.url} is unreachable`, null);
	}
	if (!res.ok) throw new OsmError(`token exchange answered ${res.status}`, res.status);
	const token = ((await res.json()) as { access_token?: string }).access_token;
	if (!token) throw new OsmError("token response carried no access_token", null);
	return token;
}
