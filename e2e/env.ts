import { ADMIN, SEED_PASSWORD } from "./helpers";
import { IDP_ISSUER } from "./idp";

/**
 * Every variable the suite's assertions depend on, handed to both the server and the
 * seed. Both also load the developer's own `.env*` files (src/lib/server/env.ts), and only
 * a variable already set in the environment beats those — so anything left out here is
 * decided by whatever `.env.development` happens to hold: the admin's address, or SSO
 * switched off.
 */
export const E2E_ENV = {
	SEED_ADMIN_NAME: ADMIN.name,
	SEED_ADMIN_EMAIL: ADMIN.email,
	SEED_ADMIN_PASSWORD: SEED_PASSWORD,
	// e2e/sso.spec.ts runs the provider inside the test process, so each test can decide
	// which identity it hands back.
	SSO_ENABLED: "true",
	SSO_ISSUER: IDP_ISSUER,
	SSO_PROVIDER: "Authelia",
	SSO_CLIENT_ID: "osm-reviewer",
	SSO_CLIENT_SECRET: "e2e-secret",
	SSO_SCOPES: "openid profile email groups",
	SSO_GROUP: "osm-reviewers",
	// Nothing in the suite may leave the machine: no scheduler, no boot-time fetch.
	PIPELINE_ENABLED: "false",
	OSM_CLIENT_ID: "",
	OSM_URL: "http://127.0.0.1:9",
	OVERPASS_URL: "http://127.0.0.1:9",
	NOMINATIM_URL: "http://127.0.0.1:9",
};
