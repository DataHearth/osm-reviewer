import * as config from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import { health, instanceFacts } from "$lib/server/instance";
import { loadNotif } from "$lib/server/settings";

const REDACTED = "[redacted]";
const SECRET_KEY = /secret|key|token|password|credential/i;

/** `smtp://user:pass@host` keeps its host and loses the credentials. */
export const stripCredentials = (value: string) =>
	value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, `$1${REDACTED}@`);

/** Redacts by key name, so a secret added to the config later is covered without a list to update. */
export function redact(value: unknown, key = ""): unknown {
	if (SECRET_KEY.test(key)) return value == null || value === "" ? value : REDACTED;
	if (typeof value === "string") return stripCredentials(value);
	if (Array.isArray(value)) return value.map((v) => redact(v));
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
	return value;
}

export async function diagnosticsBundle(db: Db) {
	return redact({
		generatedAt: new Date().toISOString(),
		instance: instanceFacts(db),
		health: await health(db),
		config: {
			sso: config.sso,
			seedAdmin: config.seedAdmin,
			llm: config.llm,
			osm: config.osm,
			overpass: config.overpass,
			nominatim: config.nominatim,
			pipeline: config.pipeline,
			backup: config.backup,
			notifications: await loadNotif(db),
		},
	});
}
