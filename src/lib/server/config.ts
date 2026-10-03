import { loadEnvFiles } from "./env";

/**
 * `process.env` rather than `$env/dynamic/private`: the seed script imports this and runs
 * outside SvelteKit, where that module does not exist. Loading the files here as well is
 * what makes the two agree — `loadEnvFile` sets nothing that is already set, so a second
 * call costs four `existsSync` and changes nothing.
 */
loadEnvFiles();

const issuer = process.env.SSO_ISSUER ?? "";

/** The OpenID Connect provider. Off unless an issuer is configured. */
export const sso = {
	enabled: issuer !== "" && process.env.SSO_ENABLED !== "false",
	provider: process.env.SSO_PROVIDER || "SSO",
	host: issuer ? new URL(issuer).host : "",
	issuer,
	clientId: process.env.SSO_CLIENT_ID || "osm-reviewer",
	/** Unset makes this a public client, which PKCE alone protects. */
	clientSecret: process.env.SSO_CLIENT_SECRET || undefined,
	scopes: process.env.SSO_SCOPES || "openid profile email groups",
	/** Required in the `groups` claim on every SSO sign-in. Set it empty to let any account at the provider in. */
	group: process.env.SSO_GROUP ?? "osm-reviewers",
};

/**
 * The first admin. The seed applies these to the one fixture account a demo instance signs
 * in as — the other fixture users stay demo data, passwords and all. A production build has
 * no seed, so `bootstrapAdmin` creates this account at boot when the users table is empty.
 */
export const seedAdmin = {
	name: process.env.SEED_ADMIN_NAME,
	email: process.env.SEED_ADMIN_EMAIL,
	password: process.env.SEED_ADMIN_PASSWORD,
};
