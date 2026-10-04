import { loadEnvFiles } from "./env";

/**
 * Read from `process.env` rather than `$env/dynamic/private`, so the `.env` files Vite would
 * hand only to that module are loaded here first. `loadEnvFile` sets nothing that is
 * already set, so a second call costs four `existsSync` and changes nothing.
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
 * The first admin, which `bootstrapAdmin` creates at boot while the users table is empty.
 */
export const seedAdmin = {
	name: process.env.SEED_ADMIN_NAME,
	email: process.env.SEED_ADMIN_EMAIL,
	password: process.env.SEED_ADMIN_PASSWORD,
};

const int = (v: string | undefined, fallback: number) => {
	const n = Number.parseInt(v ?? "", 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Trailing slashes off, so `${url}/path` never doubles one. */
const base = (v: string | undefined, fallback: string) => (v || fallback).replace(/\/+$/, "");

/**
 * The model that reads operator pages for sources whose extractor is `model`. `url` is the
 * API base: an OpenAI-compatible server (`/chat/completions`) or Anthropic's. With no
 * `provider` or `model`, a source that asks for one fails its run with that message
 * instead of quietly falling back to the deterministic map.
 */
export const llm = {
	provider: (process.env.LLM_PROVIDER === "anthropic" || process.env.LLM_PROVIDER === "openai"
		? process.env.LLM_PROVIDER
		: null) as "openai" | "anthropic" | null,
	url: process.env.LLM_URL || undefined,
	model: process.env.LLM_MODEL || undefined,
	apiKey: process.env.LLM_API_KEY || undefined,
};

/**
 * The OSM server changesets go to, and the OAuth2 application registered on it. The default
 * is the dev sandbox, which accepts the same API and throws the data away, so an instance
 * that forgot to configure this cannot write to the live map. `clientId` unset means OSM
 * sign-in is not configured.
 */
export const osm = {
	url: base(process.env.OSM_URL, "https://master.apis.dev.openstreetmap.org"),
	clientId: process.env.OSM_CLIENT_ID || undefined,
	clientSecret: process.env.OSM_CLIENT_SECRET || undefined,
};

export const overpass = {
	url: process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
};

export const nominatim = {
	url: base(process.env.NOMINATIM_URL, "https://nominatim.openstreetmap.org"),
};

/** The national address base, which gives a proposed address its postcode. */
export const ban = {
	url: base(process.env.BAN_URL, "https://api-adresse.data.gouv.fr"),
};

/**
 * `false` disables the scheduler and every fetch at boot. "Run now" still works, because
 * that is an operator asking. The e2e suite sets it so it stays offline.
 */
export const pipeline = {
	enabled: process.env.PIPELINE_ENABLED !== "false",
};

/** Unset `dir` means no periodic backup. `keep` is how many snapshots stay on disk. */
export const backup = {
	dir: process.env.BACKUP_DIR || undefined,
	intervalHours: int(process.env.BACKUP_INTERVAL_HOURS, 24),
	keep: int(process.env.BACKUP_KEEP, 7),
};
