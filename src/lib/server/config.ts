import { loadEnvFiles } from "./env";

/**
 * `process.env` rather than `$env/dynamic/private`: the seed script imports this and runs
 * outside SvelteKit, where that module does not exist. Loading the files here as well is
 * what makes the two agree — `loadEnvFile` sets nothing that is already set, so a second
 * call costs four `existsSync` and changes nothing.
 */
loadEnvFiles();

/**
 * The identity provider a deployment points at. Still only quoted, never contacted: the
 * SSO action in `src/routes/login/+page.server.ts` is a stub, so `issuer` and `clientId`
 * reach the diagnostics pane and nothing else. A real exchange also needs a client secret,
 * which is why none is read here — it would be a variable nothing consumes.
 */
export const sso = {
	/** Off hides the button and refuses the action; the remaining fields stay readable. */
	enabled: process.env.SSO_ENABLED !== "false",
	provider: process.env.SSO_PROVIDER || "Authelia",
	host: process.env.SSO_HOST || "auth.lan",
	issuer: process.env.SSO_ISSUER || "https://auth.lan/.well-known/openid-configuration",
	clientId: process.env.SSO_CLIENT_ID || "candidate-review",
	scopes: process.env.SSO_SCOPES || "openid profile email groups",
	group: process.env.SSO_GROUP || "osm-reviewers",
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
