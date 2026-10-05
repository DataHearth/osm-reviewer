import type { NotifForm } from "$lib/schemas/settings";
import * as config from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { health, instanceFacts } from "$lib/server/instance";
import { loadNotif } from "$lib/server/settings";

const REDACTED = "[redacted]";
const SECRET_KEY = /secret|key|token|password|credential/i;

/**
 * `smtp://user:pass@host`, or a bare `user:pass@host:587`, keeps its host and loses the
 * credentials. Everything up to the authority's last `@` goes, since a user name may
 * itself be an address. Without a scheme only a userinfo with a `:` is one, so an email
 * address is left alone.
 */
export function stripCredentials(value: string) {
	const found = /^([a-z][a-z0-9+.-]*:\/\/)?([^/?#\s]*)@/i.exec(value);
	if (!found || (!found[1] && !found[2].includes(":"))) return value;
	return `${found[1] ?? ""}${REDACTED}@${value.slice(found[0].length)}`;
}

/** Redacts by key name, so a secret added to the config later is covered without a list to update. */
export function redact(value: unknown, key = ""): unknown {
	if (SECRET_KEY.test(key)) return value == null || value === "" ? value : REDACTED;
	if (typeof value === "string") return stripCredentials(value);
	if (Array.isArray(value)) return value.map((v) => redact(v));
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
	return value;
}

/**
 * The notification settings as an account that cannot save them sees them. A webhook's path
 * and an ntfy topic are what lets anyone post to the channel, so they go with the secrets.
 */
export function shownNotif(v: NotifForm): NotifForm {
	const shown = redact(v) as NotifForm;
	const origin = (url: string) => (URL.canParse(url) ? new URL(url).origin : REDACTED);
	return {
		...shown,
		ntfy: { ...shown.ntfy, topic: shown.ntfy.topic && REDACTED },
		webhook: { ...shown.webhook, url: shown.webhook.url && origin(shown.webhook.url) },
	};
}

export async function diagnosticsBundle(db: Db) {
	return redact({
		generatedAt: new Date().toISOString(),
		instance: instanceFacts(db),
		health: await health(db),
		// Matches the last run of each source left out whole as lying too far from the record.
		farFromAddress: Object.fromEntries(
			db
				.select({ id: t.sources.id, state: t.sources.syncState })
				.from(t.sources)
				.all()
				.map((s) => [s.id, s.state?.farFromAddress ?? []]),
		),
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
